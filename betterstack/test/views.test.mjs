import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './harness.mjs';
import { sparkline } from '../src/views.mjs';

const hbForm = { name: 'nightly', mode: 'cron', cron: '0 3 * * *', tz: 'Australia/Melbourne', period_min: '60', grace_min: '30' };
const monitorForm = { name: 'Shop', url: 'http://127.0.0.1:1/', interval_s: '60', timeout_s: '10', expected: '200-299', down_after: '2', up_after: '1' };

test('dashboard and heartbeat pages require login', async (t) => {
  const { request } = await startApp(t);
  for (const path of ['/', '/heartbeats/new', '/heartbeats/1', '/monitors/1']) {
    const res = await request(path);
    assert.equal(res.status, 303, path);
    assert.equal(res.headers.get('location'), '/login');
  }
});

test('no admin page contains a style attribute or inline script', async (t) => {
  const { request, login, db } = await startApp(t);
  const cookie = await login();
  const m = await request('/monitors', { method: 'POST', form: monitorForm, cookie });
  const h = await request('/heartbeats', { method: 'POST', form: hbForm, cookie });
  assert.equal(h.status, 303);
  // Give the monitor some history so the sparkline renders.
  const mid = Number(m.headers.get('location').split('/').pop());
  for (let i = 0; i < 5; i += 1) {
    db.prepare('INSERT INTO checks (monitor_id, ts, ok, status_code, latency_ms) VALUES (?, ?, 1, 200, ?)').run(mid, Date.parse('2026-06-01T00:00:00Z') - i * 60_000, 50 + i * 10);
  }
  const pages = ['/', m.headers.get('location'), `${m.headers.get('location')}/edit`, `${m.headers.get('location')}/delete`,
    '/monitors/new', '/heartbeats/new', h.headers.get('location'), `${h.headers.get('location')}/edit`, `${h.headers.get('location')}/delete`];
  for (const path of pages) {
    const res = await request(path, { cookie });
    assert.equal(res.status, 200, path);
    const body = await res.text();
    assert.doesNotMatch(body, /style\s*=/i, path);
    assert.doesNotMatch(body, /<script/i, path);
    assert.doesNotMatch(body, /\son[a-z]+\s*=/i, path);
  }
  const loginHtml = await (await request('/login')).text();
  assert.doesNotMatch(loginHtml, /style\s*=|<script/i);
  const dash = await (await request('/', { cookie })).text();
  assert.match(dash, /<svg class="spark"/);
  assert.match(dash, /Shop/);
  assert.match(dash, /nightly/);
  assert.match(dash, /100%/);
});

test('heartbeat detail shows the ping, start and fail URLs with a curl example', async (t) => {
  const { request, login, db } = await startApp(t);
  const cookie = await login();
  const h = await request('/heartbeats', { method: 'POST', form: hbForm, cookie });
  const { token } = db.prepare('SELECT token FROM heartbeats').get();
  const body = await (await request(h.headers.get('location'), { cookie })).text();
  for (const suffix of ['', '/start', '/fail']) assert.ok(body.includes(`http://up.test/ping/${token}${suffix}`), suffix);
  assert.match(body, /curl -fsS -m 10 --retry 3/);
});

test('ping endpoints are public, answer 200 or 404, and accept GET and POST', async (t) => {
  const { request, login, db, mailer } = await startApp(t);
  const cookie = await login();
  await request('/heartbeats', { method: 'POST', form: { ...hbForm, mode: 'period' }, cookie });
  const { token, id } = db.prepare('SELECT token, id FROM heartbeats').get();
  const get = await request(`/ping/${token}`);
  assert.equal(get.status, 200);
  assert.equal(await get.text(), 'OK\n');
  // curl sends no Sec-Fetch-Site; a POST must still work without a session.
  const post = await fetch(`${new URL(get.url).origin}/ping/${token}/start`, { method: 'POST', body: 'log output' });
  assert.equal(post.status, 200);
  assert.equal((await request(`/ping/${token}/fail`, { method: 'POST' })).status, 200);
  assert.equal(db.prepare('SELECT state FROM heartbeats WHERE id = ?').get(id).state, 'down');
  for (const path of ['/ping/00000000-0000-4000-8000-000000000000', '/ping/nope', `/ping/${token}/other`]) {
    const res = await request(path);
    assert.equal(res.status, 404, path);
    assert.equal(await res.text(), 'Not found\n');
  }
  await new Promise((r) => setImmediate(r));
  assert.ok(mailer.sent.some((m) => /DOWN: nightly/.test(m.subject)));
});

test('heartbeat form shows field errors for a bad cron and timezone', async (t) => {
  const { request, login } = await startApp(t);
  const cookie = await login();
  const res = await request('/heartbeats', { method: 'POST', form: { ...hbForm, cron: 'every day', tz: 'Nowhere/Land' }, cookie });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /five fields/);
  assert.match(body, /IANA timezone/);
});

test('deleting a heartbeat asks first and then removes it', async (t) => {
  const { request, login, db } = await startApp(t);
  const cookie = await login();
  const h = await request('/heartbeats', { method: 'POST', form: hbForm, cookie });
  const path = h.headers.get('location');
  assert.match(await (await request(`${path}/delete`, { cookie })).text(), /cannot be undone/);
  assert.equal((await request(`${path}/delete`, { method: 'POST', cookie })).status, 303);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM heartbeats').get().n, 0);
});

test('sparkline uses SVG attributes only', () => {
  const svg = sparkline([10, 20, 15]);
  assert.match(svg, /<polyline points="[^"]+" fill="none" stroke="currentColor"/);
  assert.doesNotMatch(svg, /style/);
});
