/**
 * SQLite setup and the few queries shared by the collector and the dashboard.
 * The schema is applied on every start; there is no migration step.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sites (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    domain     TEXT    NOT NULL UNIQUE,     -- lowercased host, no www.
    created_at INTEGER NOT NULL             -- epoch ms
  );

  -- One row per pageview. No IP and no user agent: only the derived columns.
  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    ts            INTEGER NOT NULL,         -- epoch ms
    day           TEXT    NOT NULL,         -- YYYY-MM-DD (UTC), the same day the salt belongs to
    visitor_hash  TEXT    NOT NULL,         -- 64-bit hex, meaningless once the day's salt is gone
    path          TEXT    NOT NULL,
    referrer_host TEXT,
    utm_source    TEXT,
    utm_medium    TEXT,
    utm_campaign  TEXT,
    browser       TEXT    NOT NULL,
    os            TEXT    NOT NULL,
    device        TEXT    NOT NULL,
    country       TEXT
  );

  CREATE INDEX IF NOT EXISTS events_site_ts  ON events (site_id, ts);
  CREATE INDEX IF NOT EXISTS events_site_day ON events (site_id, day);
  CREATE INDEX IF NOT EXISTS events_ts       ON events (ts);
  -- Today's totals for every site on the sites list: WHERE day = ? GROUP BY site_id.
  CREATE INDEX IF NOT EXISTS events_day_site ON events (day, site_id);

  -- Holds today's salt only. Yesterday's row is deleted when the day turns.
  CREATE TABLE IF NOT EXISTS salts (
    day  TEXT PRIMARY KEY,
    salt BLOB NOT NULL
  );
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // Deleted rows (yesterday's salt) are zeroed on their pages, not just unlinked.
  db.pragma('secure_delete = ON');
  db.exec(SCHEMA);
  return db;
}

/** UTC day key, "YYYY-MM-DD". Days are UTC everywhere in this app. */
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// Prepared once per connection: this runs on every /api/event hit.
const siteByDomainStmts = new WeakMap();
export function siteByDomain(db, domain) {
  let stmt = siteByDomainStmts.get(db);
  if (!stmt) siteByDomainStmts.set(db, stmt = db.prepare('SELECT * FROM sites WHERE domain = ?'));
  return stmt.get(domain);
}

export const listSites = (db) =>
  db.prepare('SELECT * FROM sites ORDER BY domain').all();

/** Inserts the site, or returns the existing row for that domain. */
export function addSite(db, { domain, createdAt }) {
  db.prepare('INSERT INTO sites (domain, created_at) VALUES (?, ?) ON CONFLICT(domain) DO NOTHING').run(domain, createdAt);
  return siteByDomain(db, domain);
}

/** Deletes events older than `days` days before `now`. Returns how many went. */
export function pruneEvents(db, { days, now }) {
  const cutoff = now - days * 86_400_000;
  return db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff).changes;
}
