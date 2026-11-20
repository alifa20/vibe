/**
 * Entry point: read the environment, open the database, listen, and flush the
 * event queue on the way out.
 */
import fs from 'node:fs';
import { openDb } from './src/db.mjs';
import { createApp } from './src/app.mjs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;

const truthy = (value) => Boolean(value) && !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());

function fail(message) {
  console.error(`analytics: ${message}`);
  process.exit(1);
}

const adminPassword = env.ADMIN_PASSWORD || '';
if (adminPassword.length < 12) fail('ADMIN_PASSWORD must be set to at least 12 characters (see .env.example).');
if (adminPassword.startsWith('change-me')) fail('ADMIN_PASSWORD is still a change-me placeholder; set a long random one (see .env.example).');

let retentionDays = null;
if (env.RETENTION_DAYS) {
  retentionDays = Number(env.RETENTION_DAYS);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) fail('RETENTION_DAYS must be a whole number of days, 1 or more.');
}

const port = Number(env.PORT || 8000);
const host = env.HOST || '127.0.0.1';
const db = openDb(env.DB_PATH || './data/analytics.db');

const runtime = createApp({
  db,
  adminPassword,
  trustProxy: truthy(env.TRUST_PROXY),
  retentionDays,
  baseUrl: env.BASE_URL ? env.BASE_URL.replace(/\/+$/, '') : null
});
runtime.start();

const server = runtime.app.listen(port, host, () => {
  console.log(`analytics listening on http://${host}:${server.address().port}`);
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => {
    runtime.stop();
    db.close();
    process.exit(0);
  });
  // Keep-alive connections can hold close() open; don't wait forever.
  setTimeout(() => {
    runtime.stop();
    db.close();
    process.exit(0);
  }, 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
