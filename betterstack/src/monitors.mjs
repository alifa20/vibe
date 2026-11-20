import { closeIncident, deleteIncidents } from './db.mjs';

export const CHECKS_KEPT_PER_MONITOR = 3000;

export const listMonitors = (db) => db.prepare('SELECT * FROM monitors ORDER BY name COLLATE NOCASE, id').all();
export const getMonitor = (db, id) => db.prepare('SELECT * FROM monitors WHERE id = ?').get(id);

export function createMonitor(db, v, now) {
  return Number(db.prepare(`
    INSERT INTO monitors (name, url, interval_s, timeout_s, expected, down_after, up_after, next_check_at, created_at)
    VALUES (@name, @url, @interval_s, @timeout_s, @expected, @down_after, @up_after, @now, @now)
  `).run({ ...v, now }).lastInsertRowid);
}

export function updateMonitor(db, id, v, now) {
  const before = getMonitor(db, id);
  if (!before) return false;
  // A new URL starts a fresh certificate history.
  const tlsReset = before.url !== v.url
    ? ', tls_checked_at = NULL, tls_expires_at = NULL, tls_warned = NULL, tls_error = NULL'
    : '';
  db.prepare(`
    UPDATE monitors SET name = @name, url = @url, interval_s = @interval_s, timeout_s = @timeout_s,
      expected = @expected, down_after = @down_after, up_after = @up_after, next_check_at = @now ${tlsReset}
    WHERE id = @id
  `).run({ ...v, id, now });
  return true;
}

/** Pausing closes any open outage silently; resuming starts again from pending. */
export function setMonitorPaused(db, id, paused, now) {
  db.transaction(() => {
    if (paused) {
      db.prepare('UPDATE monitors SET paused = 1 WHERE id = ?').run(id);
      closeIncident(db, 'monitor', id, now);
    } else {
      db.prepare(`UPDATE monitors SET paused = 0, state = 'pending', fail_streak = 0, ok_streak = 0,
        fail_since = NULL, next_check_at = ? WHERE id = ?`).run(now, id);
    }
  })();
}

export function deleteMonitor(db, id) {
  db.transaction(() => {
    deleteIncidents(db, 'monitor', id);
    db.prepare('DELETE FROM monitors WHERE id = ?').run(id);
  })();
}

/**
 * Returns recordCheck(monitorId, ts, result), which stores one check and keeps
 * the latest CHECKS_KEPT_PER_MONITOR per monitor. Statements are prepared once.
 */
export function createCheckRecorder(db) {
  const insert = db.prepare('INSERT INTO checks (monitor_id, ts, ok, status_code, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)');
  const cutoffRow = db.prepare('SELECT id FROM checks WHERE monitor_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?');
  const trim = db.prepare('DELETE FROM checks WHERE monitor_id = ? AND id <= ?');
  return function recordCheck(monitorId, ts, result) {
    insert.run(monitorId, ts, result.ok ? 1 : 0, result.status, result.latencyMs, result.error);
    const cutoff = cutoffRow.get(monitorId, CHECKS_KEPT_PER_MONITOR);
    if (cutoff) trim.run(monitorId, cutoff.id);
  };
}

export const recentChecks = (db, monitorId, limit = 50) =>
  db.prepare('SELECT * FROM checks WHERE monitor_id = ? ORDER BY id DESC LIMIT ?').all(monitorId, limit).reverse();

/** Share of successful checks in the last 24 hours, or null with no checks. */
export function uptime24h(db, monitorId, now) {
  const row = db.prepare('SELECT COUNT(*) AS n, SUM(ok) AS ok FROM checks WHERE monitor_id = ? AND ts > ?')
    .get(monitorId, now - 86_400_000);
  return row.n ? (row.ok / row.n) * 100 : null;
}
