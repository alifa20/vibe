import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Opens (or creates) the database and applies the schema. Pass ':memory:' in
 * tests. Every timestamp column holds epoch milliseconds from the injected clock.
 */
export function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);

  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS monitors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      url             TEXT    NOT NULL,
      interval_s      INTEGER NOT NULL,
      timeout_s       INTEGER NOT NULL,
      expected        TEXT    NOT NULL DEFAULT '200-299',
      down_after      INTEGER NOT NULL DEFAULT 2,
      up_after        INTEGER NOT NULL DEFAULT 1,
      paused          INTEGER NOT NULL DEFAULT 0,
      state           TEXT    NOT NULL DEFAULT 'pending',
      fail_streak     INTEGER NOT NULL DEFAULT 0,
      ok_streak       INTEGER NOT NULL DEFAULT 0,
      fail_since      INTEGER,
      next_check_at   INTEGER NOT NULL DEFAULT 0,
      last_checked_at INTEGER,
      last_status     INTEGER,
      last_latency_ms INTEGER,
      last_error      TEXT,
      tls_checked_at  INTEGER,
      tls_expires_at  INTEGER,
      tls_warned      INTEGER,
      tls_error       TEXT,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      ts          INTEGER NOT NULL,
      ok          INTEGER NOT NULL,
      status_code INTEGER,
      latency_ms  INTEGER,
      error       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_checks_monitor ON checks (monitor_id, id);

    CREATE TABLE IF NOT EXISTS heartbeats (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      token            TEXT    NOT NULL UNIQUE,
      mode             TEXT    NOT NULL CHECK (mode IN ('period', 'cron')),
      period_s         INTEGER,
      cron             TEXT,
      tz               TEXT,
      grace_s          INTEGER NOT NULL,
      paused           INTEGER NOT NULL DEFAULT 0,
      state            TEXT    NOT NULL DEFAULT 'new',
      due_at           INTEGER,
      last_ping_at     INTEGER,
      last_start_at    INTEGER,
      last_duration_ms INTEGER,
      created_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      heartbeat_id INTEGER NOT NULL REFERENCES heartbeats(id) ON DELETE CASCADE,
      ts           INTEGER NOT NULL,
      kind         TEXT    NOT NULL,
      duration_ms  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pings_heartbeat ON pings (heartbeat_id, id);

    -- One row per outage. kind + ref_id point at a monitor or a heartbeat.
    CREATE TABLE IF NOT EXISTS incidents (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT    NOT NULL CHECK (kind IN ('monitor', 'heartbeat')),
      ref_id     INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER,
      cause      TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_ref ON incidents (kind, ref_id, ended_at);
  `);

  return db;
}

export function openIncident(db, kind, refId, startedAt, cause) {
  const open = db.prepare('SELECT id FROM incidents WHERE kind = ? AND ref_id = ? AND ended_at IS NULL').get(kind, refId);
  if (open) return open.id;
  return db.prepare('INSERT INTO incidents (kind, ref_id, started_at, cause) VALUES (?, ?, ?, ?)')
    .run(kind, refId, startedAt, String(cause || '').slice(0, 500)).lastInsertRowid;
}

/** Closes the open incident, if any, and returns it with its end time filled in. */
export function closeIncident(db, kind, refId, endedAt) {
  const open = db.prepare('SELECT * FROM incidents WHERE kind = ? AND ref_id = ? AND ended_at IS NULL').get(kind, refId);
  if (!open) return null;
  db.prepare('UPDATE incidents SET ended_at = ? WHERE id = ?').run(endedAt, open.id);
  return { ...open, ended_at: endedAt };
}

/** The latest incidents across monitors and heartbeats, with the check's name (null once deleted). */
export function recentIncidents(db, limit = 15) {
  return db.prepare(`
    SELECT i.*, COALESCE(m.name, h.name) AS name FROM incidents i
    LEFT JOIN monitors m ON i.kind = 'monitor' AND m.id = i.ref_id
    LEFT JOIN heartbeats h ON i.kind = 'heartbeat' AND h.id = i.ref_id
    ORDER BY i.started_at DESC LIMIT ?`).all(limit);
}

/** The latest incidents of one monitor or heartbeat, newest first. */
export function incidentsFor(db, kind, refId, limit = 20) {
  return db.prepare('SELECT * FROM incidents WHERE kind = ? AND ref_id = ? ORDER BY id DESC LIMIT ?').all(kind, refId, limit);
}

export function deleteIncidents(db, kind, refId) {
  db.prepare('DELETE FROM incidents WHERE kind = ? AND ref_id = ?').run(kind, refId);
}
