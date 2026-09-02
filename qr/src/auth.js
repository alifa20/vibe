import { timingSafeEqual } from 'node:crypto';

const REALM = 'QR admin';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch, so compare a fixed-size digest of each.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function createBasicAuth({ user, pass }) {
  if (!user || !pass) {
    throw new Error('ADMIN_USER and ADMIN_PASS must be set (see .env.example).');
  }

  return function basicAuth(req, res, next) {
    const header = req.get('authorization') || '';
    const [scheme, encoded] = header.split(' ');

    if (scheme?.toLowerCase() === 'basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const gotUser = decoded.slice(0, sep === -1 ? 0 : sep);
      const gotPass = sep === -1 ? '' : decoded.slice(sep + 1);
      // Both comparisons always run so a wrong username costs the same as a wrong password.
      const okUser = safeEqual(gotUser, user);
      const okPass = safeEqual(gotPass, pass);
      if (okUser && okPass) return next();
    }

    res.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
    res.status(401).type('text/plain').send('Authentication required.');
  };
}

// Basic-auth credentials are replayed by the browser on every request, so a
// cross-site form post would otherwise be authenticated. Require same-origin
// intent on anything that writes.
export function sameOriginOnly(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.status(403).type('text/plain').send('Cross-site request blocked.');
  }

  const origin = req.get('origin');
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      return res.status(403).type('text/plain').send('Cross-site request blocked.');
    }
    if (originHost !== req.get('host')) {
      return res.status(403).type('text/plain').send('Cross-site request blocked.');
    }
  }

  return next();
}
