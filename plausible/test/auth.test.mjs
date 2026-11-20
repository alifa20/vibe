import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, login, fakeClock, PASSWORD } from './helpers.mjs';

const form = (fields) => ({
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields)
});

async function withApp(options, fn) {
  const ctx = await boot(options);
  try {
    await fn(ctx);
  } finally {
    await ctx.close();
  }
}

test('unauthenticated dashboard requests redirect to the login page', async () => {
  await withApp({}, async ({ base }) => {
    for (const p of ['/', '/sites/example.com']) {
      const res = await fetch(base + p, { redirect: 'manual' });
      assert.equal(res.status, 303, p);
      assert.equal(res.headers.get('location'), '/login');
    }
    const add = await fetch(`${base}/sites`, form({ domain: 'example.com' }));
    assert.equal(add.status, 303);
    assert.equal(add.headers.get('location'), '/login');
  });
});

test('the login page renders with security headers', async () => {
  await withApp({}, async ({ base }) => {
    const res = await fetch(`${base}/login`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(res.headers.get('content-security-policy'), /style-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('referrer-policy'));
    const html = await res.text();
    assert.match(html, /type="password"/);
    assert.ok(!/style=/i.test(html));
  });
});

test('a wrong password is rejected; the right one sets an httpOnly session cookie', async () => {
  await withApp({}, async ({ base }) => {
    const wrong = await fetch(`${base}/login`, form({ password: 'nope' }));
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);

    const right = await fetch(`${base}/login`, form({ password: PASSWORD }));
    assert.equal(right.status, 303);
    assert.equal(right.headers.get('location'), '/');
    const cookie = right.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.ok(!/Secure/i.test(cookie), 'plain http on loopback: no Secure flag');

    const home = await fetch(`${base}/`, { headers: { cookie: cookie.split(';')[0] }, redirect: 'manual' });
    assert.equal(home.status, 200);
  });
});

test('a tampered cookie is rejected', async () => {
  await withApp({}, async ({ base }) => {
    const cookie = await login(base);
    const [name, value] = cookie.split('=');
    const [expiry, sig] = value.split('.');
    const forged = [
      `${name}=${expiry}.${sig.slice(0, -1)}${sig.at(-1) === '0' ? '1' : '0'}`,
      `${name}=${Number(expiry) + 999999}.${sig}`,
      `${name}=${expiry}`,
      `${name}=garbage`
    ];
    for (const c of forged) {
      const res = await fetch(`${base}/`, { headers: { cookie: c }, redirect: 'manual' });
      assert.equal(res.status, 303, c);
    }
  });
});

test('an expired cookie is rejected', async () => {
  const clock = fakeClock();
  await withApp({ clock }, async ({ base }) => {
    const cookie = await login(base);
    clock.advance(11 * 3600_000);
    assert.equal((await fetch(`${base}/`, { headers: { cookie }, redirect: 'manual' })).status, 200);
    clock.advance(1 * 3600_000 + 1);
    assert.equal((await fetch(`${base}/`, { headers: { cookie }, redirect: 'manual' })).status, 303);
  });
});

test('after repeated failures even the right password is refused until the window passes', async () => {
  const clock = fakeClock();
  await withApp({ clock }, async ({ base }) => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await fetch(`${base}/login`, form({ password: `wrong-${i}` }))).status, 401);
    }
    const locked = await fetch(`${base}/login`, form({ password: PASSWORD }));
    assert.equal(locked.status, 429);
    assert.equal(locked.headers.get('set-cookie'), null);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);

    clock.advance(14 * 60_000);
    assert.equal((await fetch(`${base}/login`, form({ password: PASSWORD }))).status, 429);
    clock.advance(60_000 + 1);
    assert.equal((await fetch(`${base}/login`, form({ password: PASSWORD }))).status, 303);
  });
});

test('a successful login clears earlier failures', async () => {
  await withApp({}, async ({ base }) => {
    for (let i = 0; i < 4; i++) await fetch(`${base}/login`, form({ password: 'wrong' }));
    await login(base);
    for (let i = 0; i < 4; i++) await fetch(`${base}/login`, form({ password: 'wrong' }));
    assert.equal((await fetch(`${base}/login`, form({ password: PASSWORD }))).status, 303);
  });
});

test('a cross-site POST to add a site is rejected by the same-origin guard', async () => {
  await withApp({}, async ({ base, db }) => {
    const cookie = await login(base);
    const crossSite = await fetch(`${base}/sites`, {
      ...form({ domain: 'example.com' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, 'sec-fetch-site': 'cross-site' }
    });
    assert.equal(crossSite.status, 403);
    const otherOrigin = await fetch(`${base}/sites`, {
      ...form({ domain: 'example.com' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin: 'https://evil.example' }
    });
    assert.equal(otherOrigin.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sites').get().n, 0);

    const sameOrigin = await fetch(`${base}/sites`, {
      ...form({ domain: 'example.com' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, 'sec-fetch-site': 'same-origin', origin: base }
    });
    assert.equal(sameOrigin.status, 303);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sites').get().n, 1);
  });
});

test('sign out clears the cookie', async () => {
  await withApp({}, async ({ base }) => {
    const cookie = await login(base);
    const res = await fetch(`${base}/logout`, { method: 'POST', redirect: 'manual', headers: { cookie } });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  });
});

test('with no admin password the dashboard is unavailable', async () => {
  await withApp({ adminPassword: '' }, async ({ base }) => {
    assert.equal((await fetch(`${base}/login`)).status, 503);
    assert.equal((await fetch(`${base}/login`, form({ password: '' }))).status, 503);
  });
});
