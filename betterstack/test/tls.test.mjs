import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { openDb } from '../src/db.mjs';
import { createMonitor, getMonitor } from '../src/monitors.mjs';
import { createNotifier } from '../src/notify.mjs';
import { createTlsChecker, probeTls, tlsWarningDue } from '../src/tls.mjs';
import { closedPort, fakeMailer, quietLogger } from './helpers.mjs';

const DAY = 86_400_000;
const now = Date.parse('2026-05-01T00:00:00Z');

test('threshold logic: 13 days warns at 14 once, 6 days warns at 7 once, 0.5 days warns at 1', () => {
  assert.deepEqual(tlsWarningDue(now + 30 * DAY, now, null), { threshold: null, warned: null });
  assert.deepEqual(tlsWarningDue(now + 13 * DAY, now, null), { threshold: 14, warned: 14 });
  assert.deepEqual(tlsWarningDue(now + 12 * DAY, now, 14), { threshold: null, warned: 14 });
  assert.deepEqual(tlsWarningDue(now + 6 * DAY, now, 14), { threshold: 7, warned: 7 });
  assert.deepEqual(tlsWarningDue(now + 5 * DAY, now, 7), { threshold: null, warned: 7 });
  assert.deepEqual(tlsWarningDue(now + 0.5 * DAY, now, 7), { threshold: 1, warned: 1 });
  assert.deepEqual(tlsWarningDue(now - DAY, now, 1), { threshold: null, warned: 1 });
});

test('a first look at a cert with 5 days left sends only the 7-day warning', () => {
  assert.deepEqual(tlsWarningDue(now + 5 * DAY, now, null), { threshold: 7, warned: 7 });
});

test('a renewed certificate resets the warnings', () => {
  assert.deepEqual(tlsWarningDue(now + 90 * DAY, now, 1), { threshold: null, warned: null });
});

function setup(probe) {
  const db = openDb(':memory:');
  const mailer = fakeMailer();
  const logger = quietLogger();
  const notifier = createNotifier({ mailer, to: 'ops@example.com', logger });
  const checker = createTlsChecker({ db, notifier, probe, logger, everyMs: 6 * 3600_000 });
  const id = createMonitor(db, { name: 'site', url: 'https://site.example/', interval_s: 60, timeout_s: 10, expected: '200-299', down_after: 2, up_after: 1 }, now);
  return { db, mailer, checker, id };
}

test('a cert expiring in 13 days triggers one 14-day warning; the next check sends none; at 6 days the 7-day warning fires once', async () => {
  const expires = now + 13 * DAY;
  const { db, mailer, checker, id } = setup(async () => ({ validTo: expires }));
  await checker(getMonitor(db, id), null, now);
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0].subject, /expires within 14 days/);

  await checker(getMonitor(db, id), null, now + 6 * 3600_000);
  assert.equal(mailer.sent.length, 1, 'no second 14-day warning');

  await checker(getMonitor(db, id), null, expires - 6 * DAY);
  assert.equal(mailer.sent.length, 2);
  assert.match(mailer.sent[1].subject, /expires within 7 days/);
  await checker(getMonitor(db, id), null, expires - 5 * DAY);
  assert.equal(mailer.sent.length, 2);
  assert.equal(getMonitor(db, id).tls_warned, 7);
});

test('the probe is not repeated more often than everyMs', async () => {
  let calls = 0;
  const { db, checker, id } = setup(async () => { calls += 1; return { validTo: now + 100 * DAY }; });
  await checker(getMonitor(db, id), null, now);
  await checker(getMonitor(db, id), null, now + 3600_000);
  assert.equal(calls, 1);
  await checker(getMonitor(db, id), null, now + 6 * 3600_000);
  assert.equal(calls, 2);
});

test('a TLS connection error is stored as an error state, not an expiry warning', async () => {
  const { db, mailer, checker, id } = setup(async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:443'); });
  await checker(getMonitor(db, id), null, now);
  assert.equal(mailer.sent.length, 0);
  const m = getMonitor(db, id);
  assert.match(m.tls_error, /ECONNREFUSED/);
  assert.equal(m.tls_expires_at, null);
});

test('http monitors are never probed', async () => {
  let calls = 0;
  const { db, checker } = setup(async () => { calls += 1; return { validTo: now }; });
  const plain = createMonitor(db, { name: 'p', url: 'http://plain.example/', interval_s: 60, timeout_s: 10, expected: '200-299', down_after: 2, up_after: 1 }, now);
  await checker(getMonitor(db, plain), null, now);
  assert.equal(calls, 0);
});

test('probeTls reads the expiry from a real local https server', async (t) => {
  const cert = fs.readFileSync(new URL('./fixtures/localhost-cert.pem', import.meta.url));
  const key = fs.readFileSync(new URL('./fixtures/localhost-key.pem', import.meta.url));
  const server = https.createServer({ cert, key }, (req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { validTo } = await probeTls(`https://localhost:${server.address().port}/`, { timeoutMs: 5000, host: '127.0.0.1' });
  assert.equal(validTo, Date.parse(new X509Certificate(cert).validTo));
});

test('probeTls rejects on a closed port', async () => {
  const port = await closedPort();
  await assert.rejects(probeTls(`https://127.0.0.1:${port}/`, { timeoutMs: 5000 }), /ECONNREFUSED/);
});

test('the scheduler runs the TLS check after an https monitor is checked', async (t) => {
  const { startApp } = await import('./harness.mjs');
  const port = await closedPort();
  let probed = 0;
  const app = await startApp(t, {
    probeTls: async () => { probed += 1; return { validTo: Date.parse('2026-06-01T00:00:00Z') + 13 * DAY }; },
  });
  const cookie = await app.login();
  await app.request('/monitors', {
    method: 'POST', cookie,
    form: { name: 'secure', url: `https://127.0.0.1:${port}/`, interval_s: '60', timeout_s: '10', expected: '200-299', down_after: '2', up_after: '1' },
  });
  await app.time.advance(0, () => app.scheduler.idle());
  assert.equal(probed, 1);
  assert.ok(app.mailer.sent.some((m) => /expires within 14 days/.test(m.subject)));
  const detail = await (await app.request('/monitors/1', { cookie })).text();
  assert.match(detail, /expires in 13 days/);
});
