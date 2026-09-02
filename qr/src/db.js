import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'qr.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT    NOT NULL UNIQUE,
    label      TEXT    NOT NULL DEFAULT '',
    target     TEXT    NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS scans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code_id    INTEGER NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
    ts         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    user_agent TEXT    NOT NULL DEFAULT '',
    referer    TEXT    NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_scans_code_ts ON scans (code_id, ts);
`);

const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/1/i/l/o — unambiguous when read off a printed code
export const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Paths the app itself serves; a code may not shadow one.
const RESERVED_SLUGS = new Set(['r', 'admin', 'api', 'vendor', 'healthz', 'favicon.ico', 'robots.txt']);

export function randomSlug(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
  return out;
}

export function slugError(slug) {
  if (!SLUG_RE.test(slug)) return 'Slug may only contain letters, numbers, hyphens and underscores (max 64).';
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return `"${slug}" is reserved.`;
  return null;
}

export function normaliseTarget(raw) {
  const value = String(raw || '').trim();
  if (!value) return { error: 'Target URL is required.' };
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'Target must be a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Target must be an http:// or https:// URL.' };
  }
  return { target: url.toString() };
}

const statements = {
  bySlug: db.prepare('SELECT * FROM codes WHERE slug = ? COLLATE NOCASE'),
  byId: db.prepare('SELECT * FROM codes WHERE id = ?'),
  insert: db.prepare('INSERT INTO codes (slug, label, target) VALUES (@slug, @label, @target)'),
  update: db.prepare(`
    UPDATE codes
       SET slug = @slug, label = @label, target = @target, active = @active,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = @id
  `),
  remove: db.prepare('DELETE FROM codes WHERE id = ?'),
  logScan: db.prepare('INSERT INTO scans (code_id, user_agent, referer) VALUES (?, ?, ?)'),
  clearScans: db.prepare('DELETE FROM scans WHERE code_id = ?'),
  recentScans: db.prepare('SELECT ts, user_agent, referer FROM scans WHERE code_id = ? ORDER BY id DESC LIMIT ?'),
  dailyScans: db.prepare(`
    SELECT substr(ts, 1, 10) AS day, COUNT(*) AS hits
      FROM scans
     WHERE code_id = ? AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-29 days','start of day')
     GROUP BY day
  `),
  list: db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM scans s WHERE s.code_id = c.id) AS scans_total,
           (SELECT COUNT(*) FROM scans s WHERE s.code_id = c.id
              AND s.ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')) AS scans_30d,
           (SELECT MAX(ts) FROM scans s WHERE s.code_id = c.id) AS last_scan
      FROM codes c
     ORDER BY c.created_at DESC
  `),
  totals: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM scans WHERE code_id = ?) AS scans_total,
      (SELECT COUNT(*) FROM scans WHERE code_id = ?
        AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')) AS scans_30d,
      (SELECT MAX(ts) FROM scans WHERE code_id = ?) AS last_scan
  `),
  stats: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM codes) AS codes,
      (SELECT COUNT(*) FROM scans) AS scans_total,
      (SELECT COUNT(*) FROM scans
        WHERE ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')) AS scans_30d
  `)
};

export const codes = {
  list: () => statements.list.all(),
  stats: () => statements.stats.get(),
  totals: (id) => statements.totals.get(id, id, id),
  byId: (id) => statements.byId.get(id),
  bySlug: (slug) => statements.bySlug.get(slug),
  create: ({ slug, label, target }) => {
    const info = statements.insert.run({ slug, label, target });
    return statements.byId.get(info.lastInsertRowid);
  },
  update: ({ id, slug, label, target, active }) => {
    statements.update.run({ id, slug, label, target, active: active ? 1 : 0 });
    return statements.byId.get(id);
  },
  remove: (id) => statements.remove.run(id),
  uniqueSlug: () => {
    for (let i = 0; i < 20; i++) {
      const slug = randomSlug();
      if (!statements.bySlug.get(slug)) return slug;
    }
    return randomSlug(10);
  }
};

export const scans = {
  log: (codeId, userAgent, referer) =>
    statements.logScan.run(codeId, String(userAgent || '').slice(0, 500), String(referer || '').slice(0, 500)),
  clear: (codeId) => statements.clearScans.run(codeId),
  recent: (codeId, limit = 50) => statements.recentScans.all(codeId, limit),
  daily: (codeId) => statements.dailyScans.all(codeId)
};
