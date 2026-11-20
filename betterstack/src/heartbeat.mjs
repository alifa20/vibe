import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { intField } from './checks.mjs';
import { closeIncident, deleteIncidents, openIncident } from './db.mjs';

/**
 * Heartbeats expect a ping by `due_at`. They are late from due_at and go down
 * when the grace period after it runs out.
 *
 *   new  --first ping--> up
 *   up   --due_at passes--> late
 *   late --ping--> up
 *   up/late --grace expires--> down    (alert)
 *   any  --fail ping--> down           (alert, unless already down)
 *   down --ping--> up                  (recovery alert)
 */

export const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PINGS_KEPT = 200;

export function isValidTimezone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function cronFor(hb) {
  return new Cron(hb.cron, { timezone: hb.tz || 'UTC', paused: true });
}

/** The next time a ping is expected, counting from `fromMs`. */
export function computeDueAt(hb, fromMs) {
  if (hb.mode === 'period') return fromMs + hb.period_s * 1000;
  const next = cronFor(hb).nextRun(new Date(fromMs));
  return next ? next.getTime() : null;
}

/** Validates the heartbeat form. Period and grace are entered in minutes. */
export function validateHeartbeat(input) {
  const errors = {};
  const name = String(input.name ?? '').trim();
  if (!name) errors.name = 'Give the heartbeat a name.';
  else if (name.length > 100) errors.name = 'Keep the name under 100 characters.';

  const mode = String(input.mode ?? '');
  const values = { name, mode, period_s: null, cron: null, tz: null, grace_s: null };

  if (mode === 'period') {
    const minutes = intField(input.period_min, { min: 1, max: 60 * 24 * 31, label: 'Period', errors, key: 'period_min' });
    if (minutes !== null) values.period_s = minutes * 60;
  } else if (mode === 'cron') {
    const cron = String(input.cron ?? '').trim().replace(/\s+/g, ' ');
    const tz = String(input.tz ?? '').trim() || 'UTC';
    if (cron.split(' ').length !== 5) {
      errors.cron = 'Use five fields: minute hour day-of-month month day-of-week.';
    } else {
      try {
        if (!new Cron(cron, { paused: true }).nextRun()) errors.cron = 'That schedule never runs.';
      } catch {
        errors.cron = 'That is not a valid cron expression.';
      }
    }
    if (!isValidTimezone(tz)) errors.tz = 'Use an IANA timezone name, such as Europe/London or Australia/Melbourne.';
    values.cron = cron;
    values.tz = tz;
  } else {
    errors.mode = 'Choose a fixed period or a cron schedule.';
  }

  const grace = intField(input.grace_min, { min: 1, max: 60 * 24 * 7, label: 'Grace period', errors, key: 'grace_min' });
  if (grace !== null) values.grace_s = grace * 60;

  return { values, errors };
}

/** Pure: the transition a sweep at `now` causes, if any. */
export function evaluateHeartbeat(hb, now) {
  if (hb.paused || hb.due_at === null || hb.due_at === undefined) return null;
  if (hb.state !== 'up' && hb.state !== 'late') return null;
  if (now >= hb.due_at + hb.grace_s * 1000) return 'down';
  if (hb.state === 'up' && now >= hb.due_at) return 'late';
  return null;
}

export function createHeartbeats({
  db,
  notifier,
  clock = { now: () => Date.now() },
  timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) },
  logger = console,
  sweepMs = 10_000,
}) {
  const pending = new Set();
  let handle = null;
  let running = false;

  // Statements on the ping path, prepared once.
  const stmt = {
    get: db.prepare('SELECT * FROM heartbeats WHERE id = ?'),
    byToken: db.prepare('SELECT * FROM heartbeats WHERE token = ?'),
    markStart: db.prepare('UPDATE heartbeats SET last_start_at = ? WHERE id = ?'),
    pingPaused: db.prepare('UPDATE heartbeats SET last_ping_at = ?, last_start_at = NULL, last_duration_ms = COALESCE(?, last_duration_ms) WHERE id = ?'),
    pingState: db.prepare(`UPDATE heartbeats SET state = ?, last_ping_at = ?, last_start_at = NULL,
        last_duration_ms = COALESCE(?, last_duration_ms), due_at = ? WHERE id = ?`),
    insertPing: db.prepare('INSERT INTO pings (heartbeat_id, ts, kind, duration_ms) VALUES (?, ?, ?, ?)'),
    pingCutoff: db.prepare('SELECT id FROM pings WHERE heartbeat_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?'),
    trimPings: db.prepare('DELETE FROM pings WHERE heartbeat_id = ? AND id <= ?'),
  };
  const get = (id) => stmt.get.get(id);
  const byToken = (token) => stmt.byToken.get(token);

  // Emails go out in the background so a ping answers at once.
  function background(promise) {
    const p = Promise.resolve(promise)
      .catch((err) => logger.error(`[heartbeat] ${err?.stack || err}`))
      .finally(() => pending.delete(p));
    pending.add(p);
    return p;
  }

  function ping(token, kind = 'ping') {
    if (!TOKEN_RE.test(String(token))) return false;
    const hb = byToken(token);
    if (!hb) return false;
    const now = clock.now();

    if (kind === 'start') {
      db.transaction(() => {
        stmt.markStart.run(now, hb.id);
        insertPing(hb.id, now, 'start', null);
      })();
      return true;
    }

    const duration = hb.last_start_at ? now - hb.last_start_at : null;
    const failed = kind === 'fail';
    let transition = null;
    let closed = null;

    db.transaction(() => {
      insertPing(hb.id, now, kind, duration);
      if (hb.paused) {
        stmt.pingPaused.run(now, duration, hb.id);
        return;
      }
      let state;
      if (failed) {
        state = 'down';
        if (hb.state !== 'down') {
          transition = 'down';
          openIncident(db, 'heartbeat', hb.id, now, 'fail ping received');
        }
      } else {
        state = 'up';
        if (hb.state === 'down') {
          transition = 'up';
          closed = closeIncident(db, 'heartbeat', hb.id, now);
        }
      }
      stmt.pingState.run(state, now, duration, computeDueAt(hb, now), hb.id);
    })();

    if (transition === 'down') {
      logger.warn(`[heartbeat] ${hb.name} is DOWN: fail ping`);
      background(notifier.heartbeatDown(hb, 'A fail ping was received.', now));
    } else if (transition === 'up') {
      logger.info(`[heartbeat] ${hb.name} is UP again`);
      background(notifier.heartbeatUp(hb, now - (closed?.started_at ?? now)));
    }
    return true;
  }

  function insertPing(id, ts, kind, duration) {
    stmt.insertPing.run(id, ts, kind, duration);
    const cutoff = stmt.pingCutoff.get(id, PINGS_KEPT);
    if (cutoff) stmt.trimPings.run(id, cutoff.id);
  }

  function sweepOnce() {
    const now = clock.now();
    const rows = db.prepare("SELECT * FROM heartbeats WHERE paused = 0 AND state IN ('up', 'late')").all();
    for (const hb of rows) {
      const transition = evaluateHeartbeat(hb, now);
      if (!transition) continue;
      if (transition === 'late') {
        db.prepare("UPDATE heartbeats SET state = 'late' WHERE id = ?").run(hb.id);
        continue;
      }
      db.transaction(() => {
        db.prepare("UPDATE heartbeats SET state = 'down' WHERE id = ?").run(hb.id);
        openIncident(db, 'heartbeat', hb.id, hb.due_at, 'no ping before the grace period ended');
      })();
      const reason = `No ping arrived. One was expected by ${new Date(hb.due_at).toISOString()}, ` +
        `and the ${Math.round(hb.grace_s / 60)}-minute grace period has ended.` +
        (hb.last_ping_at ? ` Last ping: ${new Date(hb.last_ping_at).toISOString()}.` : '');
      logger.warn(`[heartbeat] ${hb.name} is DOWN: no ping`);
      background(notifier.heartbeatDown(hb, reason, hb.due_at));
    }
  }

  async function sweep() {
    sweepOnce();
    await idle();
  }

  async function idle() {
    while (pending.size) await Promise.all([...pending]);
  }

  function loop() {
    handle = timers.setTimeout(() => {
      if (!running) return;
      try {
        sweepOnce();
      } catch (err) {
        logger.error(`[heartbeat] sweep failed: ${err?.stack || err}`);
      }
      loop();
    }, sweepMs);
  }

  return {
    get,
    ping,
    sweep,
    idle,
    list: () => db.prepare('SELECT * FROM heartbeats ORDER BY name COLLATE NOCASE, id').all(),
    recentPings: (id, limit = 30) => db.prepare('SELECT * FROM pings WHERE heartbeat_id = ? ORDER BY id DESC LIMIT ?').all(id, limit),
    create(v) {
      const token = randomUUID();
      const id = Number(db.prepare(`INSERT INTO heartbeats (name, token, mode, period_s, cron, tz, grace_s, created_at)
        VALUES (@name, @token, @mode, @period_s, @cron, @tz, @grace_s, @now)`)
        .run({ period_s: null, cron: null, tz: null, ...v, token, now: clock.now() }).lastInsertRowid);
      return { id, token };
    },
    update(id, v) {
      const hb = get(id);
      if (!hb) return false;
      const merged = { ...hb, ...v };
      // A new schedule moves the deadline, counted from the last ping.
      const dueAt = hb.last_ping_at && hb.state !== 'new' ? computeDueAt(merged, hb.last_ping_at) : hb.due_at;
      db.prepare(`UPDATE heartbeats SET name = @name, mode = @mode, period_s = @period_s, cron = @cron, tz = @tz,
        grace_s = @grace_s, due_at = @dueAt, state = CASE WHEN state = 'late' THEN 'up' ELSE state END WHERE id = @id`)
        .run({ ...merged, dueAt, id });
      return true;
    },
    /** Pausing closes an open outage silently; resuming waits for the next ping. */
    setPaused(id, paused) {
      const now = clock.now();
      db.transaction(() => {
        if (paused) {
          db.prepare('UPDATE heartbeats SET paused = 1 WHERE id = ?').run(id);
          closeIncident(db, 'heartbeat', id, now);
        } else {
          db.prepare("UPDATE heartbeats SET paused = 0, state = 'new', due_at = NULL WHERE id = ?").run(id);
        }
      })();
    },
    remove(id) {
      db.transaction(() => {
        deleteIncidents(db, 'heartbeat', id);
        db.prepare('DELETE FROM heartbeats WHERE id = ?').run(id);
      })();
    },
    /**
     * After a restart, a heartbeat whose deadline passed while the process was
     * off gets one grace period from now before it can go down.
     */
    start() {
      running = true;
      const now = clock.now();
      const rows = db.prepare("SELECT * FROM heartbeats WHERE paused = 0 AND state IN ('up', 'late')").all();
      for (const hb of rows) {
        if (hb.due_at !== null && hb.due_at + hb.grace_s * 1000 <= now) {
          db.prepare('UPDATE heartbeats SET due_at = ? WHERE id = ?').run(now, hb.id);
        }
      }
      if (handle === null) loop();
    },
    stop() {
      running = false;
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
    },
  };
}
