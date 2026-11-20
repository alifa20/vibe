import assert from 'node:assert/strict';
import { openDb } from '../src/db.mjs';
import { createApp } from '../src/app.mjs';
import { createNotifier } from '../src/notify.mjs';
import { fakeMailer, fakeTime, quietLogger } from './helpers.mjs';

export const PASSWORD = 'correct horse battery staple';

export async function startApp(t, extra = {}) {
  const db = openDb(':memory:');
  const time = fakeTime(Date.parse('2026-06-01T00:00:00Z'));
  const logger = quietLogger();
  const mailer = fakeMailer();
  const notifier = createNotifier({ mailer, to: 'ops@example.com', logger, baseUrl: 'http://up.test' });
  const built = createApp({
    db, adminPassword: PASSWORD, baseUrl: 'http://up.test', clock: time.clock, timers: time.timers, random: () => 0, notifier, logger, ...extra,
  });
  built.start();
  const server = built.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => { built.stop(); server.closeAllConnections(); server.close(resolve); }));

  const request = (path, { method = 'GET', form, cookie, headers = {} } = {}) => fetch(base + path, {
    method,
    redirect: 'manual',
    headers: {
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(method === 'POST' ? { 'sec-fetch-site': 'same-origin' } : {}),
      ...headers,
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });

  async function login() {
    const res = await request('/login', { method: 'POST', form: { password: PASSWORD } });
    assert.equal(res.status, 303);
    return res.headers.get('set-cookie').split(';')[0];
  }

  return { db, time, mailer, logger, base, request, login, ...built };
}

