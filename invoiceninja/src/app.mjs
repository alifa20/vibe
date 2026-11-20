import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { createAuth, sameOriginOnly } from './auth.mjs';
import { InvoiceError } from './invoices.mjs';
import { adminRoutes, authRoutes } from './routes.mjs';
import { errorPage } from './views.mjs';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Nothing loads from another origin, styles come only from /static/*.css, and
// the one script is a file. No 'unsafe-inline' anywhere.
const CSP = [
  "default-src 'self'",
  "style-src 'self'",
  "script-src 'self'",
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

/**
 * Builds the Express app. Everything it depends on is passed in, so tests
 * run it against an in-memory database and a fake clock.
 *
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {{ now: () => number }} [opts.clock]
 * @param {string} opts.adminPassword
 * @param {boolean|number|string} [opts.trustProxy]  Express `trust proxy` value; false unless TRUST_PROXY is set
 * @param {boolean} [opts.secureCookies]  force the Secure flag even on plain HTTP requests
 */
export function createApp({ db, clock = { now: () => Date.now() }, adminPassword, trustProxy = false, secureCookies = false }) {
  const app = express();
  const auth = createAuth({ password: adminPassword, now: () => clock.now(), secureCookies });

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.set('query parser', 'simple');

  app.use((req, res, next) => {
    res.set('Content-Security-Policy', CSP);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'DENY');
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/static', express.static(PUBLIC_DIR, { index: false, fallthrough: false, maxAge: '1h' }));
  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100 }));
  app.use(sameOriginOnly);
  app.use(authRoutes({ auth }));
  app.use(auth.requireAuth);
  app.use(adminRoutes({ db, clock }));

  app.use((req, res) => res.status(404).type('html').send(errorPage(404, 'Nothing here.')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return;
    if (err instanceof InvoiceError) {
      return res.status(err.status).type('html').send(errorPage(err.status, err.message));
    }
    if (err?.code?.startsWith?.('SQLITE_CONSTRAINT')) {
      return res.status(409).type('html').send(errorPage(409, 'The database refused that change. Sent invoices are frozen.'));
    }
    if (err?.status >= 400 && err.status < 500) {
      return res.status(err.status).type('html').send(errorPage(err.status, 'That request could not be read.'));
    }
    console.error('[error]', req.method, req.originalUrl, err);
    res.status(500).type('html').send(errorPage(500, 'Something went wrong. Check the server log for details.'));
  });

  return app;
}
