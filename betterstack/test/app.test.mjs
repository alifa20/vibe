import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, startApp } from './harness.mjs';

const monitorForm = { name: 'Example', url: 'https://example.com/health', interval_s: '60', timeout_s: '10', expected: '200-299', down_after: '2', up_after: '1' };

test('login page renders and admin pages redirect there without a session', async (t) => {
  const { request } = await startApp(t);
  const page = await request('/login');
  assert.equal(page.status, 200);
  const body = await page.text();
  assert.match(body, /type="password"/);
  assert.match(page.headers.get('content-security-policy'), /style-src 'self'/);
  const dash = await request('/');
  assert.equal(dash.status, 303);
  assert.equal(dash.headers.get('location'), '/login');
  const post = await request('/monitors', { method: 'POST', form: monitorForm });
  assert.equal(post.status, 401);
});

test('a correct password sets an httpOnly signed cookie that opens the dashboard', async (t) => {
  const { request, login } = await startApp(t);
  const cookie = await login();
  assert.match(cookie, /^uptime_session=\d+\.[0-9a-f]{64}$/);
  const res = await request('/', { cookie });
  assert.equal(res.status, 200);
  // A tampered signature is rejected.
  const forged = cookie.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
  assert.equal((await request('/', { cookie: forged })).status, 303);
});

test('the session cookie expires', async (t) => {
  const { request, login, time } = await startApp(t);
  const cookie = await login();
  time.set(time.clock.now() + 13 * 3600 * 1000);
  assert.equal((await request('/', { cookie })).status, 303);
});

test('five wrong passwords lock the IP out, even for the right password', async (t) => {
  const { request } = await startApp(t);
  for (let i = 0; i < 5; i += 1) {
    const res = await request('/login', { method: 'POST', form: { password: 'nope' } });
    assert.equal(res.status, i < 4 ? 401 : 429);
  }
  const locked = await request('/login', { method: 'POST', form: { password: PASSWORD } });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
});

test('cross-site writes are blocked', async (t) => {
  const { request, login } = await startApp(t);
  const cookie = await login();
  const res = await request('/monitors', { method: 'POST', form: monitorForm, cookie, headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(res.status, 403);
  const res2 = await request('/monitors', { method: 'POST', form: monitorForm, cookie, headers: { origin: 'https://evil.example' } });
  assert.equal(res2.status, 403);
});

test('create, edit, pause, resume and delete a monitor', async (t) => {
  const { request, login, db, scheduler } = await startApp(t);
  const cookie = await login();
  const created = await request('/monitors', { method: 'POST', form: monitorForm, cookie });
  assert.equal(created.status, 303);
  const path = created.headers.get('location');
  const id = Number(path.split('/').pop());
  assert.equal(db.prepare('SELECT name FROM monitors WHERE id = ?').get(id).name, 'Example');
  assert.equal(scheduler.scheduledAt(id), true);

  const detail = await (await request(path, { cookie })).text();
  assert.match(detail, /Example/);

  const edited = await request(path, { method: 'POST', form: { ...monitorForm, name: 'Renamed' }, cookie });
  assert.equal(edited.status, 303);
  assert.equal(db.prepare('SELECT name FROM monitors WHERE id = ?').get(id).name, 'Renamed');

  await request(`${path}/pause`, { method: 'POST', cookie });
  assert.equal(db.prepare('SELECT paused FROM monitors WHERE id = ?').get(id).paused, 1);
  assert.equal(scheduler.scheduledAt(id), false);
  await request(`${path}/resume`, { method: 'POST', cookie });
  assert.equal(db.prepare('SELECT paused FROM monitors WHERE id = ?').get(id).paused, 0);
  assert.equal(scheduler.scheduledAt(id), true);

  const confirm = await (await request(`${path}/delete`, { cookie })).text();
  assert.match(confirm, /cannot be undone/);
  const deleted = await request(`${path}/delete`, { method: 'POST', cookie });
  assert.equal(deleted.status, 303);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM monitors').get().n, 0);
  assert.equal(scheduler.scheduledAt(id), false);
});

test('the form shows field errors, including the timeout-below-interval rule', async (t) => {
  const { request, login, db } = await startApp(t);
  const cookie = await login();
  const res = await request('/monitors', { method: 'POST', form: { ...monitorForm, interval_s: '30', timeout_s: '30' }, cookie });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /Timeout must be shorter than the interval\./);
  assert.match(body, /aria-invalid="true"/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM monitors').get().n, 0);
});

test('monitor names and URLs are escaped', async (t) => {
  const { request, login } = await startApp(t);
  const cookie = await login();
  const created = await request('/monitors', { method: 'POST', form: { ...monitorForm, name: '<script>alert(1)</script>', url: 'https://example.com/?q="><img src=x>' }, cookie });
  const detail = await (await request(created.headers.get('location'), { cookie })).text();
  assert.doesNotMatch(detail, /<script>alert/);
  assert.doesNotMatch(detail, /"><img/);
  assert.match(detail, /&lt;script&gt;/);
});
