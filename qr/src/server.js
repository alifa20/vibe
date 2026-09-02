import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import express from 'express';

import { db } from './db.js';
import { createBasicAuth, sameOriginOnly } from './auth.js';
import { createAdminRouter } from './routes/admin.js';
import { redirectRouter } from './routes/redirect.js';
import { errorPage } from './views/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// Served from node_modules so the browser never talks to a CDN.
const QR_LIB = require.resolve('qr-code-styling');

const app = express();
app.disable('x-powered-by');

// Behind nginx/Caddy this makes req.protocol reflect the original scheme.
if (process.env.TRUST_PROXY) {
  const value = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(value) ? Number(value) : value === 'true' ? 1 : value);
}

/** Absolute origin used when printing short links. */
function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY'
  });
  next();
});

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

// Assets revalidate with an ETag rather than sitting in the browser cache, so an
// upgrade or a tweak to the CSS shows up on the next load.
app.get('/vendor/qr-code-styling.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(QR_LIB);
});

app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: 0, index: 'index.html' }));

app.use('/', redirectRouter);

app.use(
  '/admin',
  sameOriginOnly,
  createBasicAuth({ user: process.env.ADMIN_USER, pass: process.env.ADMIN_PASS }),
  createAdminRouter({ baseUrl })
);

app.use((req, res) => {
  res.status(404).type('html').send(errorPage({
    status: 404,
    title: 'Page not found',
    message: 'Nothing lives at this address.'
  }));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).type('html').send(errorPage({
    status: 500,
    title: 'Something went wrong',
    message: 'The server hit an unexpected error. Check the logs for details.'
  }));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`QRForge listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (process.env.BASE_URL) console.log(`Short links: ${process.env.BASE_URL.replace(/\/+$/, '')}/r/<slug>`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
