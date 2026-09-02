import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const uploadsDir = path.join(dataDir, 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  root,
  dataDir,
  uploadsDir,
  publicDir: path.join(root, 'public'),
  dbPath: path.join(dataDir, 'senja.db'),

  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',

  // Branding shown on the public pages.
  siteName: process.env.SITE_NAME || 'Testimonials',
  siteTagline: process.env.SITE_TAGLINE || 'What people say about working with us.',
  // Public origin, e.g. https://testimonials.example.com. Used for the embed snippet
  // and for absolute avatar URLs in the JSON API.
  siteUrl: (process.env.SITE_URL || '').replace(/\/+$/, ''),

  admin: {
    user: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
  },

  avatarSize: int(process.env.AVATAR_SIZE, 128),
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 8 * 1024 * 1024),
  // Submissions allowed per IP per hour.
  submitRateLimit: int(process.env.SUBMIT_RATE_LIMIT, 5),
  // Set to "true" only if you intentionally fetch avatars from a private network.
  allowPrivateAvatarHosts: process.env.ALLOW_PRIVATE_AVATAR_HOSTS === 'true',
};

export const limits = {
  name: 80,
  role: 120,
  text: 2000,
  textMin: 10,
};
