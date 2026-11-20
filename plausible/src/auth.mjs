/**
 * Dashboard sign-in: one ADMIN_PASSWORD, an HMAC-signed expiring cookie, a
 * per-IP lockout after repeated failures, and a same-origin check on writes.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { clientIp } from './collect.mjs';

export const SESSION_COOKIE = 'analytics_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

const sha256 = (value) => createHash('sha256').update(String(value)).digest();

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

export function createAuth({ password, clock, trustProxy = false }) {
  const enabled = Boolean(password);
  // The password is the signing key, so changing it ends every session.
  const sign = (expiry) => createHmac('sha256', String(password)).update(`session:${expiry}`).digest('hex');
  const failures = new Map(); // ip -> { n, until }

  function hasSession(req) {
    if (!enabled) return false;
    const value = readCookie(req, SESSION_COOKIE);
    const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(value || '');
    if (!match) return false;
    if (!(Number(match[1]) > clock.now())) return false;
    return safeEqualHex(match[2], sign(match[1]));
  }

  const cookie = (req, value, maxAgeSeconds) =>
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}` +
    (req.secure ? '; Secure' : '');

  function startSession(req, res) {
    const expiry = clock.now() + SESSION_TTL_MS;
    res.set('Set-Cookie', cookie(req, `${expiry}.${sign(expiry)}`, SESSION_TTL_MS / 1000));
  }

  function endSession(req, res) {
    res.set('Set-Cookie', cookie(req, '', 0));
  }

  const checkPassword = (given) => enabled && timingSafeEqual(sha256(given), sha256(password));

  /** Seconds until this IP may try again, or 0 when it is not locked out. */
  function lockedFor(req) {
    const entry = failures.get(clientIp(req, trustProxy));
    if (!entry || entry.n < MAX_FAILURES || entry.until <= clock.now()) return 0;
    return Math.ceil((entry.until - clock.now()) / 1000);
  }

  function recordFailure(req) {
    const ip = clientIp(req, trustProxy);
    const now = clock.now();
    const entry = failures.get(ip);
    if (!entry || entry.until <= now) failures.set(ip, { n: 1, until: now + LOCKOUT_MS });
    else failures.set(ip, { n: entry.n + 1, until: now + LOCKOUT_MS });
    if (failures.size > 10_000) {
      for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
    }
  }

  const recordSuccess = (req) => failures.delete(clientIp(req, trustProxy));

  function requireSession(req, res, next) {
    if (hasSession(req)) return next();
    res.set('Cache-Control', 'no-store');
    return res.redirect(303, '/login');
  }

  return { enabled, hasSession, startSession, endSession, checkPassword, lockedFor, recordFailure, recordSuccess, requireSession };
}

/**
 * The session cookie rides along on every request the browser makes, so a
 * form on another site could otherwise post here as you. Writes must come
 * from this origin.
 */
export function sameOriginOnly(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const blocked = () => res.status(403).type('text/plain').send('Cross-site request blocked.');

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return blocked();

  const origin = req.get('origin');
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      return blocked();
    }
    if (originHost !== req.get('host')) return blocked();
  }
  return next();
}
