import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, formatDuration, smtpFromEnv } from '../src/notify.mjs';
import { fakeMailer, quietLogger } from './helpers.mjs';

const monitor = { id: 3, name: 'shop', url: 'https://shop.example/' };

test('down email names the monitor and the error, with a link', async () => {
  const mailer = fakeMailer();
  const n = createNotifier({ mailer, to: 'me@example.com', baseUrl: 'https://up.example/', smtp: { from: 'Uptime <up@example.com>' } });
  assert.equal(await n.monitorDown(monitor, 'ECONNREFUSED', Date.parse('2026-03-01T10:00:00Z')), true);
  const [mail] = mailer.sent;
  assert.equal(mail.to, 'me@example.com');
  assert.equal(mail.from, 'Uptime <up@example.com>');
  assert.equal(mail.subject, '[uptime] DOWN: shop');
  assert.match(mail.text, /Error: ECONNREFUSED/);
  assert.match(mail.text, /https:\/\/up\.example\/monitors\/3/);
});

test('recovery email says how long the outage lasted', async () => {
  const mailer = fakeMailer();
  const n = createNotifier({ mailer, to: 'me@example.com' });
  await n.monitorUp(monitor, 3_725_000);
  assert.match(mailer.sent[0].text, /back up after 1h 2m of downtime/);
});

test('with SMTP unset sending logs a warning and resolves false', async () => {
  const logger = quietLogger();
  const n = createNotifier({ smtp: smtpFromEnv({}), to: 'me@example.com', logger });
  assert.equal(await n.monitorDown(monitor, 'x', 0), false);
  assert.match(logger.lines.warn[0], /SMTP_HOST is not set/);
});

test('with no recipient sending is skipped', async () => {
  const logger = quietLogger();
  const mailer = fakeMailer();
  const n = createNotifier({ mailer, to: '', logger });
  assert.equal(await n.monitorDown(monitor, 'x', 0), false);
  assert.equal(mailer.sent.length, 0);
  assert.match(logger.lines.warn[0], /ALERT_EMAIL_TO/);
});

test('a throwing transport never throws out of send', async () => {
  const logger = quietLogger();
  const n = createNotifier({ mailer: fakeMailer({ fail: true }), to: 'me@example.com', logger });
  assert.equal(await n.monitorDown(monitor, 'x', 0), false);
  assert.match(logger.lines.error[0], /SMTP connection refused/);
});

test('smtpFromEnv reads the tally-style variables', () => {
  const s = smtpFromEnv({ SMTP_HOST: 'mail.example', SMTP_PORT: '465', SMTP_SECURE: '1', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'f@example' });
  assert.deepEqual(s, { host: 'mail.example', port: 465, secure: true, user: 'u', pass: 'p', from: 'f@example', enabled: true });
  assert.equal(smtpFromEnv({}).enabled, false);
  assert.equal(smtpFromEnv({}).port, 587);
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(42_000), '42s');
  assert.equal(formatDuration(180_000), '3m');
  assert.equal(formatDuration(90_061_000), '1d 1h');
});
