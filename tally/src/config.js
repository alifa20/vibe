'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    console.error(
      `\nMissing required environment variable ${name}.\n` +
        `Copy .env.example to .env and fill it in.\n`
    );
    process.exit(1);
  }
  return value.trim();
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

const root = path.resolve(__dirname, '..');
const resolve = (p) => (path.isAbsolute(p) ? p : path.join(root, p));

const adminToken = required('ADMIN_TOKEN');
if (adminToken.length < 16) {
  console.error('\nADMIN_TOKEN must be at least 16 characters.\n');
  process.exit(1);
}

const config = {
  root,
  adminToken,
  baseUrl: (process.env.BASE_URL || `http://localhost:${int('PORT', 3000)}`).replace(/\/+$/, ''),
  port: int('PORT', 3000),
  host: process.env.HOST || '127.0.0.1',
  trustProxy: int('TRUST_PROXY', 1),
  dbPath: resolve(process.env.DB_PATH || './data/forms.db'),
  uploadDir: resolve(process.env.UPLOAD_DIR || './uploads'),
  insecureCookies: bool('INSECURE_COOKIES', false),
  rateLimit: {
    max: int('RATE_LIMIT_MAX', 5),
    windowMs: int('RATE_LIMIT_WINDOW_MINUTES', 10) * 60 * 1000,
  },
  maxUploadBytes: int('MAX_UPLOAD_MB', 10) * 1024 * 1024,
  maxUploadMb: int('MAX_UPLOAD_MB', 10),
  smtp: {
    host: (process.env.SMTP_HOST || '').trim(),
    port: int('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: (process.env.SMTP_USER || '').trim(),
    pass: process.env.SMTP_PASS || '',
    from: (process.env.SMTP_FROM || '').trim(),
  },
  notifyEmailTo: (process.env.NOTIFY_EMAIL_TO || '').trim(),
};

config.smtp.enabled = Boolean(config.smtp.host);

for (const dir of [path.dirname(config.dbPath), config.uploadDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = config;
