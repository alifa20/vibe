import { closeIncident, openIncident } from './db.mjs';
import { runHttpCheck } from './checks.mjs';
import { getMonitor, listMonitors, recordCheck } from './monitors.mjs';

/**
 * The monitor state machine. Pure: given the stored monitor and one check
 * result, returns the fields to persist and the transition, if any.
 *
 *   pending --success--> up            (no alert, nothing was down)
 *   pending --N fails--> down          (alert)
 *   up      --N fails--> down          (alert)
 *   down    --M successes--> up        (recovery alert)
 */
export function applyCheckResult(m, ok, now) {
  const next = {};
  let transition = null;
  if (ok) {
    next.fail_streak = 0;
    next.ok_streak = m.ok_streak + 1;
    if (m.state === 'down') {
      if (next.ok_streak >= m.up_after) {
        next.state = 'up';
        next.fail_since = null;
        transition = 'up';
      }
    } else {
      next.state = 'up';
      next.fail_since = null;
    }
  } else {
    next.ok_streak = 0;
    next.fail_streak = m.fail_streak + 1;
    next.fail_since = m.fail_since ?? now;
    if (m.state !== 'down' && next.fail_streak >= m.down_after) {
      next.state = 'down';
      transition = 'down';
    }
  }
  return { next, transition };
}

/**
 * Runs every monitor on its own timer. The clock, timers, randomness, fetch
 * and TLS probe are all injectable so tests never wait on real time.
 */
export function createScheduler({
  db,
  notifier,
  clock = { now: () => Date.now() },
  timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) },
  random = Math.random,
  logger = console,
  fetchImpl = fetch,
  signalFor,
  maxInFlight = 8,
  hooks = {},
}) {
  const handles = new Map();
  const running = new Set();
  const queue = [];
  const pending = new Set();
  let stopped = true;

  // Up to 60s of spread for overdue monitors at startup, so a restart does
  // not fire every check at the same instant.
  const startupSpread = (m) => Math.floor(random() * Math.min(m.interval_s * 1000, 60_000));
  // A small jitter on every reschedule keeps monitors with equal intervals apart.
  const jitter = (m) => Math.floor(random() * Math.min(1000, m.interval_s * 50));

  function schedule(id, at) {
    unschedule(id);
    if (stopped) return;
    const delay = Math.max(0, at - clock.now());
    handles.set(id, timers.setTimeout(() => {
      handles.delete(id);
      enqueue(id);
    }, delay));
  }

  function unschedule(id) {
    const h = handles.get(id);
    if (h !== undefined) timers.clearTimeout(h);
    handles.delete(id);
  }

  function enqueue(id) {
    if (running.has(id) || queue.includes(id)) return;
    queue.push(id);
    drain();
  }

  function drain() {
    while (!stopped && running.size < maxInFlight && queue.length) {
      const id = queue.shift();
      running.add(id);
      const p = runCheck(id)
        .catch((err) => logger.error(`[scheduler] check ${id} crashed: ${err?.stack || err}`))
        .finally(() => {
          running.delete(id);
          pending.delete(p);
          drain();
        });
      pending.add(p);
    }
  }

  async function runCheck(id) {
    const before = getMonitor(db, id);
    if (!before || before.paused) return;

    const result = await runHttpCheck(before, { fetchImpl, now: clock.now, signalFor });
    const now = clock.now();

    // The monitor may have been edited, paused or deleted while the check ran.
    const m = getMonitor(db, id);
    if (!m || m.paused) return;

    const { next, transition } = applyCheckResult(m, result.ok, now);
    const nextCheckAt = now + m.interval_s * 1000 + jitter(m);
    let closed = null;

    db.transaction(() => {
      recordCheck(db, id, now, result);
      db.prepare(`UPDATE monitors SET state = @state, fail_streak = @fail_streak, ok_streak = @ok_streak,
        fail_since = @fail_since, last_checked_at = @now, last_status = @status, last_latency_ms = @latency,
        last_error = @error, next_check_at = @nextCheckAt WHERE id = @id`).run({
        state: next.state ?? m.state,
        fail_streak: next.fail_streak,
        ok_streak: next.ok_streak,
        fail_since: 'fail_since' in next ? next.fail_since : m.fail_since,
        now,
        status: result.status,
        latency: result.latencyMs,
        error: result.error,
        nextCheckAt,
        id,
      });
      if (transition === 'down') openIncident(db, 'monitor', id, next.fail_since, result.error);
      if (transition === 'up') closed = closeIncident(db, 'monitor', id, now);
    })();

    if (transition === 'down') {
      logger.warn(`[monitor] ${m.name} is DOWN: ${result.error}`);
      await notifier.monitorDown(m, result.error, next.fail_since);
    } else if (transition === 'up') {
      const since = closed?.started_at ?? m.fail_since ?? now;
      logger.info(`[monitor] ${m.name} is UP again`);
      await notifier.monitorUp(m, now - since);
    }

    if (hooks.afterCheck) await hooks.afterCheck(getMonitor(db, id), result, now);

    schedule(id, nextCheckAt);
  }

  return {
    start() {
      stopped = false;
      const now = clock.now();
      for (const m of listMonitors(db)) {
        if (m.paused) continue;
        let at = m.next_check_at;
        if (at <= now) {
          at = now + startupSpread(m);
          db.prepare('UPDATE monitors SET next_check_at = ? WHERE id = ?').run(at, m.id);
        }
        schedule(m.id, at);
      }
    },
    stop() {
      stopped = true;
      for (const id of [...handles.keys()]) unschedule(id);
      queue.length = 0;
    },
    /** Call after a monitor is created, edited, paused, resumed or deleted. */
    monitorChanged(id) {
      const m = getMonitor(db, id);
      if (!m || m.paused) return unschedule(id);
      schedule(id, m.next_check_at);
    },
    scheduledAt(id) {
      return handles.has(id);
    },
    runCheck,
    /** Resolves once every check that has started has finished. */
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}
