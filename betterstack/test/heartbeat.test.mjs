import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.mjs';
import { computeDueAt, createHeartbeats, validateHeartbeat } from '../src/heartbeat.mjs';
import { createNotifier } from '../src/notify.mjs';
import { fakeMailer, fakeTime, quietLogger } from './helpers.mjs';

const MIN = 60_000;

function setup(start) {
  const db = openDb(':memory:');
  const time = fakeTime(start);
  const mailer = fakeMailer();
  const logger = quietLogger();
  const notifier = createNotifier({ mailer, to: 'ops@example.com', logger });
  const hb = createHeartbeats({ db, clock: time.clock, timers: time.timers, notifier, logger });
  return { db, time, mailer, hb };
}

const melbourne = { name: 'nightly backup', mode: 'cron', cron: '0 3 * * *', tz: 'Australia/Melbourne', grace_s: 30 * 60 };

// AE4 on an ordinary day, the day daylight saving ends (5 April 2026) and the
// day it starts (4 October 2026) in Melbourne. 03:00 local is a different UTC
// instant on each side of the change.
for (const { label, pingAt, dueUtc } of [
  { label: 'an ordinary day', pingAt: '2026-06-09T17:05:00Z', dueUtc: '2026-06-10T17:00:00Z' },
  { label: 'the day DST ends', pingAt: '2026-04-03T16:05:00Z', dueUtc: '2026-04-04T17:00:00Z' },
  { label: 'the day DST starts', pingAt: '2026-10-02T17:05:00Z', dueUtc: '2026-10-03T16:00:00Z' },
]) {
  test(`AE4: cron 0 3 * * * in Australia/Melbourne with 30m grace, ${label}`, async () => {
    const { db, time, mailer, hb } = setup(Date.parse(pingAt));
    const { id, token } = hb.create(melbourne);
    assert.equal(hb.ping(token, 'ping'), true);
    const due = Date.parse(dueUtc);
    assert.equal(hb.get(id).due_at, due, '03:00 local the next day');

    const stateAt = async (ms) => {
      time.set(ms);
      await hb.sweep();
      return hb.get(id).state;
    };
    assert.equal(await stateAt(due - 1000), 'up', 'up before 03:00');
    assert.equal(await stateAt(due), 'late', 'late from 03:00');
    assert.equal(await stateAt(due + 30 * MIN - 1000), 'late');
    assert.equal(mailer.sent.length, 0, 'late does not alert');
    assert.equal(await stateAt(due + 30 * MIN), 'down', 'down at 03:30');
    assert.equal(mailer.sent.length, 1);
    assert.match(mailer.sent[0].subject, /DOWN: nightly backup/);
    assert.equal(await stateAt(due + 90 * MIN), 'down');
    assert.equal(mailer.sent.length, 1, 'exactly one email');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incidents').get().n, 1);
  });
}

test('computeDueAt for cron uses the timezone', () => {
  const due = computeDueAt({ mode: 'cron', cron: '0 3 * * *', tz: 'Australia/Melbourne' }, Date.parse('2026-01-15T00:00:00Z'));
  assert.equal(new Date(due).toISOString(), '2026-01-15T16:00:00.000Z'); // 03:00 AEDT (UTC+11)
});

test('a 1h period with 5m grace goes down after 66 minutes without a ping, and a ping recovers it', async () => {
  const t0 = Date.parse('2026-02-01T00:00:00Z');
  const { time, mailer, hb } = setup(t0);
  const { id, token } = hb.create({ name: 'hourly', mode: 'period', period_s: 3600, grace_s: 300 });
  hb.ping(token, 'ping');
  time.set(t0 + 61 * MIN);
  await hb.sweep();
  assert.equal(hb.get(id).state, 'late');
  time.set(t0 + 66 * MIN);
  await hb.sweep();
  assert.equal(hb.get(id).state, 'down');
  assert.equal(mailer.sent.length, 1);

  time.set(t0 + 70 * MIN);
  await hb.ping(token, 'ping');
  await hb.idle();
  assert.equal(hb.get(id).state, 'up');
  assert.equal(mailer.sent.length, 2);
  assert.match(mailer.sent[1].subject, /UP: hourly/);
  assert.match(mailer.sent[1].text, /back up after 10m of downtime/);
  assert.equal(hb.get(id).due_at, t0 + 130 * MIN);
});

test('the sweep timer runs on its own', async () => {
  const t0 = Date.parse('2026-02-01T00:00:00Z');
  const { time, hb, mailer } = setup(t0);
  const { id, token } = hb.create({ name: 'hourly', mode: 'period', period_s: 3600, grace_s: 300 });
  hb.ping(token, 'ping');
  hb.start();
  await time.advance(66 * MIN, () => hb.idle());
  hb.stop();
  assert.equal(hb.get(id).state, 'down');
  assert.equal(mailer.sent.length, 1);
});

test('/start then a ping 42 seconds later records a 42-second duration', async () => {
  const t0 = Date.parse('2026-02-01T00:00:00Z');
  const { db, time, hb } = setup(t0);
  const { id, token } = hb.create({ name: 'job', mode: 'period', period_s: 3600, grace_s: 300 });
  hb.ping(token, 'start');
  time.set(t0 + 42_000);
  hb.ping(token, 'ping');
  assert.equal(hb.get(id).last_duration_ms, 42_000);
  assert.equal(hb.get(id).last_start_at, null);
  const kinds = db.prepare('SELECT kind, duration_ms FROM pings ORDER BY id').all();
  assert.deepEqual(kinds, [{ kind: 'start', duration_ms: null }, { kind: 'ping', duration_ms: 42_000 }]);
});

test('/fail marks the heartbeat down immediately and alerts once', async () => {
  const { hb, mailer } = setup(Date.parse('2026-02-01T00:00:00Z'));
  const { id, token } = hb.create({ name: 'job', mode: 'period', period_s: 3600, grace_s: 300 });
  hb.ping(token, 'ping');
  hb.ping(token, 'fail');
  await hb.idle();
  assert.equal(hb.get(id).state, 'down');
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0].text, /fail ping/);
  hb.ping(token, 'fail');
  await hb.idle();
  assert.equal(mailer.sent.length, 1);
});

test('unknown tokens are rejected and tokens are random UUIDs', () => {
  const { hb } = setup(Date.parse('2026-02-01T00:00:00Z'));
  const a = hb.create({ name: 'a', mode: 'period', period_s: 3600, grace_s: 60 });
  const b = hb.create({ name: 'b', mode: 'period', period_s: 3600, grace_s: 60 });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(a.token, uuid);
  assert.match(b.token, uuid);
  assert.notEqual(a.token, b.token);
  assert.equal(hb.ping('00000000-0000-4000-8000-000000000000', 'ping'), false);
  assert.equal(hb.ping('1', 'ping'), false);
});

test('a new heartbeat waits for its first ping and never goes late', async () => {
  const t0 = Date.parse('2026-02-01T00:00:00Z');
  const { time, hb } = setup(t0);
  const { id } = hb.create({ name: 'job', mode: 'period', period_s: 60, grace_s: 60 });
  time.set(t0 + 24 * 60 * MIN);
  await hb.sweep();
  assert.equal(hb.get(id).state, 'new');
});

test('after a restart an overdue heartbeat gets one grace period before going down', async () => {
  const t0 = Date.parse('2026-02-01T00:00:00Z');
  const first = setup(t0);
  const { id, token } = first.hb.create({ name: 'job', mode: 'period', period_s: 3600, grace_s: 600 });
  first.hb.ping(token, 'ping');

  // The process was off for three hours.
  const restartAt = t0 + 3 * 60 * MIN;
  first.time.set(restartAt);
  const again = createHeartbeats({ db: first.db, clock: first.time.clock, timers: first.time.timers, notifier: createNotifier({ mailer: first.mailer, to: 'x@example.com', logger: quietLogger() }), logger: quietLogger() });
  again.start();
  await again.sweep();
  assert.notEqual(again.get(id).state, 'down');
  assert.equal(first.mailer.sent.length, 0);
  first.time.set(restartAt + 600_000);
  await again.sweep();
  again.stop();
  assert.equal(again.get(id).state, 'down');
  assert.equal(first.mailer.sent.length, 1);
});

test('the heartbeat form validates cron expressions and IANA timezones', () => {
  const ok = validateHeartbeat({ name: 'x', mode: 'cron', cron: '0 3 * * *', tz: 'Australia/Melbourne', grace_min: '30' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.values.grace_s, 1800);
  const bad = validateHeartbeat({ name: '', mode: 'cron', cron: '61 3 * * *', tz: 'Mars/Olympus', grace_min: '0' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['cron', 'grace_min', 'name', 'tz']);
  assert.match(validateHeartbeat({ name: 'x', mode: 'cron', cron: '0 0 3 * * *', tz: 'UTC', grace_min: '5' }).errors.cron, /five fields/);
  const period = validateHeartbeat({ name: 'x', mode: 'period', period_min: '60', grace_min: '5' });
  assert.deepEqual(period.errors, {});
  assert.equal(period.values.period_s, 3600);
  assert.ok(validateHeartbeat({ name: 'x', mode: 'period', period_min: '0', grace_min: '5' }).errors.period_min);
  assert.ok(validateHeartbeat({ name: 'x', mode: 'weekly', grace_min: '5' }).errors.mode);
});
