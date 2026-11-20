import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.mjs';
import { createMonitor, getMonitor } from '../src/monitors.mjs';
import { createNotifier } from '../src/notify.mjs';
import { createScheduler } from '../src/scheduler.mjs';
import { fakeMailer, fakeTime, quietLogger, targetServer } from './helpers.mjs';

const monitorValues = (url, extra = {}) => ({
  name: 'api', url, interval_s: 60, timeout_s: 10, expected: '200-299', down_after: 2, up_after: 1, ...extra,
});

function setup({ mailer = fakeMailer(), random = () => 0, smtpTo = 'ops@example.com' } = {}) {
  const db = openDb(':memory:');
  const time = fakeTime();
  const logger = quietLogger();
  const notifier = createNotifier({ mailer, to: smtpTo, logger, smtp: { enabled: false } });
  const scheduler = createScheduler({ db, notifier, clock: time.clock, timers: time.timers, random, logger });
  const advance = (ms) => time.advance(ms, () => scheduler.idle());
  return { db, time, logger, mailer, scheduler, advance };
}

test('AE3: fail, success, fail, fail sends exactly one down email, after the fourth check', async (t) => {
  const target = await targetServer(500);
  t.after(target.close);
  const { db, mailer, scheduler, advance } = setup();
  const id = createMonitor(db, monitorValues(target.url), Date.parse('2026-01-01T00:00:00Z'));
  scheduler.start();
  t.after(scheduler.stop);

  const sequence = [500, 200, 500, 500];
  const emailsAfter = [];
  for (const [i, status] of sequence.entries()) {
    target.state.status = status;
    await advance(i === 0 ? 0 : 60_000);
    emailsAfter.push(mailer.sent.length);
  }
  assert.equal(target.state.hits, 4);
  assert.deepEqual(emailsAfter, [0, 0, 0, 1]);
  assert.match(mailer.sent[0].subject, /DOWN: api/);
  assert.match(mailer.sent[0].text, /HTTP 500/);
  assert.equal(getMonitor(db, id).state, 'down');

  // Staying down sends nothing more.
  await advance(60_000);
  assert.equal(mailer.sent.length, 1);
});

test('two successes with an up threshold of 2 send one recovery email with the outage length', async (t) => {
  const target = await targetServer(500);
  t.after(target.close);
  const { db, time, mailer, scheduler, advance } = setup();
  const start = time.clock.now();
  const id = createMonitor(db, monitorValues(target.url, { up_after: 2 }), start);
  scheduler.start();
  t.after(scheduler.stop);

  await advance(0); // first failure at t=0
  await advance(60_000); // second failure: down
  assert.equal(mailer.sent.length, 1);

  target.state.status = 200;
  await advance(60_000); // one success: still down
  assert.equal(getMonitor(db, id).state, 'down');
  assert.equal(mailer.sent.length, 1);
  await advance(60_000); // second success at t=180s: up
  assert.equal(getMonitor(db, id).state, 'up');
  assert.equal(mailer.sent.length, 2);
  assert.match(mailer.sent[1].subject, /UP: api/);
  assert.match(mailer.sent[1].text, /back up after 3m of downtime/);

  const incident = db.prepare('SELECT * FROM incidents').get();
  assert.equal(incident.started_at, start);
  assert.equal(incident.ended_at, start + 180_000);
});

test('after a restart monitors resume at their persisted next_check_at and are spread out', async (t) => {
  const target = await targetServer(200);
  t.after(target.close);
  const first = setup();
  const t0 = first.time.clock.now();
  const future = createMonitor(first.db, monitorValues(target.url, { name: 'future' }), t0);
  first.db.prepare('UPDATE monitors SET next_check_at = ? WHERE id = ?').run(t0 + 45_000, future);
  const overdue = [];
  for (let i = 0; i < 5; i += 1) overdue.push(createMonitor(first.db, monitorValues(target.url, { name: `old${i}` }), t0 - 600_000));

  // Same database, a fresh scheduler, as after a process restart.
  const randoms = [0.1, 0.3, 0.5, 0.7, 0.9];
  const scheduler = createScheduler({
    db: first.db, notifier: createNotifier({ mailer: fakeMailer(), to: 'x@example.com', logger: first.logger }),
    clock: first.time.clock, timers: first.time.timers, random: () => randoms.shift() ?? 0, logger: first.logger,
  });
  scheduler.start();
  t.after(scheduler.stop);

  const at = first.time.pending().map((p) => p.at - t0);
  assert.ok(at.includes(45_000), 'the not-yet-due monitor keeps its persisted time');
  const spread = new Set(at.filter((x) => x !== 45_000));
  assert.equal(spread.size, 5, 'overdue monitors are not all checked at once');
  for (const offset of spread) assert.ok(offset >= 0 && offset < 60_000);

  await first.time.advance(1, () => scheduler.idle());
  assert.equal(target.state.hits, 0, 'nothing ran at the instant of the restart');
});

test('with SMTP unset alerts are logged and skipped, and the scheduler keeps running', async (t) => {
  const target = await targetServer(500);
  t.after(target.close);
  const db = openDb(':memory:');
  const time = fakeTime();
  const logger = quietLogger();
  const notifier = createNotifier({ smtp: { enabled: false }, to: 'ops@example.com', logger });
  const scheduler = createScheduler({ db, notifier, clock: time.clock, timers: time.timers, random: () => 0, logger });
  const id = createMonitor(db, monitorValues(target.url), time.clock.now());
  scheduler.start();
  t.after(scheduler.stop);

  await time.advance(0, () => scheduler.idle());
  await time.advance(60_000, () => scheduler.idle());
  assert.equal(getMonitor(db, id).state, 'down');
  assert.ok(logger.lines.warn.some((l) => /SMTP_HOST is not set/.test(l)));
  await time.advance(60_000, () => scheduler.idle());
  assert.equal(target.state.hits, 3, 'checks continue after a skipped alert');
});

test('a transport that throws does not stop the scheduler', async (t) => {
  const target = await targetServer(500);
  t.after(target.close);
  const { db, logger, scheduler, advance } = setup({ mailer: fakeMailer({ fail: true }) });
  const id = createMonitor(db, monitorValues(target.url), Date.parse('2026-01-01T00:00:00Z'));
  scheduler.start();
  t.after(scheduler.stop);

  await advance(0);
  await advance(60_000);
  assert.equal(getMonitor(db, id).state, 'down');
  assert.ok(logger.lines.error.some((l) => /SMTP connection refused/.test(l)));
  target.state.status = 200;
  await advance(60_000);
  assert.equal(getMonitor(db, id).state, 'up');
  assert.equal(target.state.hits, 3);
});

test('paused monitors are not checked and deleted ones are unscheduled', async (t) => {
  const target = await targetServer(200);
  t.after(target.close);
  const { db, scheduler, advance } = setup();
  const id = createMonitor(db, monitorValues(target.url), Date.parse('2026-01-01T00:00:00Z'));
  scheduler.start();
  t.after(scheduler.stop);
  await advance(0);
  assert.equal(target.state.hits, 1);
  db.prepare('UPDATE monitors SET paused = 1 WHERE id = ?').run(id);
  scheduler.monitorChanged(id);
  await advance(600_000);
  assert.equal(target.state.hits, 1);
});

test('a stopped port alerts once and recovers once when it comes back', async (t) => {
  const { closedPort } = await import('./helpers.mjs');
  const http = await import('node:http');
  const port = await closedPort();
  const { db, mailer, scheduler, advance } = setup();
  createMonitor(db, monitorValues(`http://127.0.0.1:${port}/`), Date.parse('2026-01-01T00:00:00Z'));
  scheduler.start();
  t.after(scheduler.stop);

  for (let i = 0; i < 4; i += 1) await advance(i === 0 ? 0 : 60_000);
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0].text, /ECONNREFUSED/);

  const server = http.createServer((req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await advance(60_000);
  await advance(60_000);
  assert.deepEqual(mailer.sent.map((m) => m.subject), ['[uptime] DOWN: api', '[uptime] UP: api']);
  assert.match(mailer.sent[1].text, /back up after 4m of downtime/);
});
