import 'dotenv/config';
import { openDb } from './src/db.mjs';
import { createApp } from './src/app.mjs';
import { createNotifier, smtpFromEnv } from './src/notify.mjs';

const env = process.env;
const PORT = Number(env.PORT || 3000);
const HOST = env.HOST || '127.0.0.1';

if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_PASSWORD must be set to at least 12 characters (see .env.example).');
  process.exit(1);
}

const db = openDb(env.DB_PATH || './data/uptime.db');
const notifier = createNotifier({
  smtp: smtpFromEnv(env),
  to: (env.ALERT_EMAIL_TO || '').trim(),
  baseUrl: (env.BASE_URL || '').trim(),
});
const uptime = createApp({
  db,
  adminPassword: env.ADMIN_PASSWORD,
  notifier,
  baseUrl: (env.BASE_URL || '').trim(),
  trustProxy: (env.TRUST_PROXY || '').trim(),
});

uptime.start();
const server = uptime.app.listen(PORT, HOST, () => {
  console.log(`uptime listening on http://${HOST}:${PORT}`);
  if (!smtpFromEnv(env).enabled) console.warn('SMTP_HOST is not set: alerts will be logged, not emailed.');
});

function shutdown() {
  uptime.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
