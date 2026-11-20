import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'uptime_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

const sha256 = (s) => createHash('sha256').update(String(s)).digest();

function equalHex(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * One-password admin auth. The session cookie is `expiry.HMAC(password, expiry)`,
 * so changing ADMIN_PASSWORD signs everyone out. Failed logins are counted per
 * IP; five in a row lock that IP out for 15 minutes.
 */
export function createAuth({ password, clock = { now: () => Date.now() } }) {
  if (!password) throw new Error('ADMIN_PASSWORD must be set (see .env.example).');
  const failures = new Map();

  const sign = (expiry) => createHmac('sha256', password).update(`session:${expiry}`).digest('hex');

  function checkPassword(given) {
    return timingSafeEqual(sha256(given), sha256(password));
  }

  function hasSession(req) {
    const value = parseCookies(req.get('cookie'))[SESSION_COOKIE];
    if (!value) return false;
    const [expiry, signature] = value.split('.');
    if (!signature || !(Number(expiry) > clock.now())) return false;
    return equalHex(signature, sign(expiry));
  }

  function cookie(req, value, maxAgeSeconds) {
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}` +
      (req.secure ? '; Secure' : '');
  }

  function lockedFor(ip) {
    const rec = failures.get(ip);
    if (!rec || rec.n < MAX_FAILURES) return 0;
    const left = rec.until - clock.now();
    if (left <= 0) {
      failures.delete(ip);
      return 0;
    }
    return left;
  }

  return {
    hasSession,
    lockedFor,
    /** Returns { ok, cookie } on success, { ok: false, lockedMs } otherwise. */
    login(req, given) {
      const ip = req.ip || 'unknown';
      const locked = lockedFor(ip);
      if (locked) return { ok: false, lockedMs: locked };
      if (!checkPassword(given)) {
        const rec = failures.get(ip);
        const n = rec && rec.until > clock.now() ? rec.n + 1 : 1;
        failures.set(ip, { n, until: clock.now() + LOCK_MS });
        return { ok: false, lockedMs: lockedFor(ip) };
      }
      failures.delete(ip);
      const expiry = clock.now() + SESSION_TTL_MS;
      return { ok: true, cookie: cookie(req, `${expiry}.${sign(expiry)}`, SESSION_TTL_MS / 1000) };
    },
    logoutCookie(req) {
      return cookie(req, '', 0);
    },
    requireLogin(req, res, next) {
      if (hasSession(req)) return next();
      if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(303, '/login');
      return res.status(401).type('text/plain').send('Sign in first.');
    },
  };
}

/**
 * Cookies ride along on cross-site form posts, so writes must also show
 * same-origin intent through Sec-Fetch-Site or Origin.
 */
export function sameOriginOnly(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.status(403).type('text/plain').send('Cross-site request blocked.');
  }
  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return res.status(403).type('text/plain').send('Cross-site request blocked.');
    }
    if (host !== req.get('host')) return res.status(403).type('text/plain').send('Cross-site request blocked.');
  }
  return next();
}
