import { openDb } from './src/db.mjs';
import { createApp } from './src/app.mjs';

function fail(message) {
  console.error(`\n${message}\nCopy .env.example to .env and fill it in.\n`);
  process.exit(1);
}

const env = process.env;
const adminPassword = (env.ADMIN_PASSWORD || '').trim();
if (!adminPassword) fail('Missing ADMIN_PASSWORD.');
if (adminPassword.length < 12) fail('ADMIN_PASSWORD must be at least 12 characters.');
if (adminPassword.startsWith('change-me')) fail('ADMIN_PASSWORD is still a change-me placeholder. Set a long random one.');

const port = Number.parseInt(env.PORT || '3000', 10);
const host = env.HOST || '127.0.0.1';
const dbPath = env.DB_PATH || './data/invoices.db';

// Proxy headers are ignored unless TRUST_PROXY says how many proxies to trust.
const rawTrust = (env.TRUST_PROXY || '').trim();
const trustProxy = rawTrust === '' ? false : /^\d+$/.test(rawTrust) ? Number(rawTrust) : rawTrust;

const db = openDb(dbPath);
const app = createApp({
  db,
  adminPassword,
  trustProxy,
  secureCookies: /^(1|true|yes|on)$/i.test(env.SECURE_COOKIES || ''),
});

const server = app.listen(port, host, () => {
  console.log(`invoices listening on http://${host}:${port}`);
  console.log(`  db  ${dbPath}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
