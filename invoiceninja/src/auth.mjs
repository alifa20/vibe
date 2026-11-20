/**
 * Single-admin auth. The login form checks ADMIN_PASSWORD (sha256 on both
 * sides, then timingSafeEqual, so length does not leak), and issues a cookie
 * of the form `<expiry-ms>.<hmac>`. The HMAC key is the password itself, so
 * changing ADMIN_PASSWORD signs every existing session out. Failed logins are
 * counted per IP and lock that IP out for a while.
 */
import crypto from 'node:crypto';

export const COOKIE = 'inv_session';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

function hmac(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function safeEqualHex(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export function readCookie(req, name) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function createAuth({
  password,
  now = () => Date.now(),
  sessionMs = 12 * 60 * 60 * 1000,
  maxFails = 8,
  lockMs = 15 * 60 * 1000,
  secureCookies = false,
}) {
  if (!password) throw new Error('ADMIN_PASSWORD is required');
  const attempts = new Map();

  function passwordMatches(candidate) {
    return crypto.timingSafeEqual(sha256(typeof candidate === 'string' ? candidate : ''), sha256(password));
  }

  function sessionValue() {
    const expiry = now() + sessionMs;
    return `${expiry}.${hmac(password, `session:${expiry}`)}`;
  }

  function isAuthed(req) {
    const value = readCookie(req, COOKIE);
    if (!value) return false;
    const [expiry, sig] = value.split('.');
    if (!sig || !(Number(expiry) > now())) return false;
    return safeEqualHex(sig, hmac(password, `session:${expiry}`));
  }

  function cookieFlags(req, maxAgeSeconds) {
    const flags = [`Max-Age=${maxAgeSeconds}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (secureCookies || req.secure) flags.push('Secure');
    return flags.join('; ');
  }

  function login(req, res) {
    res.append('Set-Cookie', `${COOKIE}=${sessionValue()}; ${cookieFlags(req, Math.floor(sessionMs / 1000))}`);
  }

  function logout(req, res) {
    res.append('Set-Cookie', `${COOKIE}=; ${cookieFlags(req, 0)}`);
  }

  /** Seconds until this IP may try again, or 0 if it is not locked out. */
  function lockedFor(ip) {
    const rec = attempts.get(ip);
    if (!rec || rec.until <= now()) {
      if (rec) attempts.delete(ip);
      return 0;
    }
    return rec.n >= maxFails ? Math.ceil((rec.until - now()) / 1000) : 0;
  }

  function recordFailure(ip) {
    const rec = attempts.get(ip);
    const n = rec && rec.until > now() ? rec.n + 1 : 1;
    attempts.set(ip, { n, until: now() + lockMs });
    if (attempts.size > 10000) {
      for (const [k, v] of attempts) if (v.until <= now()) attempts.delete(k);
    }
  }

  const clearFailures = (ip) => attempts.delete(ip);

  function requireAuth(req, res, next) {
    if (isAuthed(req)) return next();
    if (req.method === 'GET' || req.method === 'HEAD') {
      return res.redirect(303, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    return res.status(401).type('text/plain').send('Sign in first.');
  }

  return { passwordMatches, isAuthed, login, logout, lockedFor, recordFailure, clearFailures, requireAuth };
}

/**
 * Rejects state-changing requests that a browser marks as coming from another
 * site, or whose Origin does not match the Host. Requests with neither header
 * (curl, old browsers) pass; SameSite=Lax on the cookie covers those.
 */
export function sameOriginOnly(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const blocked = () => res.status(403).type('text/plain').send('Cross-site request blocked.');

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return blocked();

  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return blocked();
    }
    if (host !== req.get('host')) return blocked();
  }
  return next();
}

/** Only allow redirects back into this app after login. */
export function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}
