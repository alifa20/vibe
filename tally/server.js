'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./src/config');
require('./src/db');

const adminRoutes = require('./src/routes/admin');
const publicRoutes = require('./src/routes/public');
const adminViews = require('./src/views/admin');
const publicViews = require('./src/views/public');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.set('query parser', 'simple');

app.use(cookieParser(config.adminToken));

// Nothing on any page is loaded from another origin, and the CSP keeps it that
// way: a stray third-party script or tracking pixel simply will not load.
const CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'", // the per-form accent lives in an inline <style>
  "script-src 'self'",
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

app.use((req, res, next) => {
  res.set('Content-Security-Policy', CSP);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    fallthrough: false,
    index: false,
  })
);

app.use('/admin', adminRoutes);
app.use('/f', publicRoutes);

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.get('/', (req, res) => res.redirect('/admin'));

app.use((req, res) => {
  if (req.path.startsWith('/f/')) {
    return res.status(404).type('html').send(publicViews.renderNotFound());
  }
  res
    .status(404)
    .type('html')
    .send(adminViews.errorPage({ status: 404, message: 'Nothing here.' }));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.originalUrl, err);
  if (res.headersSent) return;
  res
    .status(500)
    .type('html')
    .send(
      adminViews.errorPage({
        status: 500,
        message: 'Something went wrong. Check the server log for details.',
      })
    );
});

const server = app.listen(config.port, config.host, () => {
  console.log(`Forms listening on http://${config.host}:${config.port}`);
  console.log(`  admin   ${config.baseUrl}/admin`);
  console.log(`  db      ${config.dbPath}`);
  console.log(`  uploads ${config.uploadDir}`);
  if (!config.smtp.enabled) console.log('  smtp    not configured (email notifications disabled)');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
