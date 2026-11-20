import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, addSite } from '../src/db.mjs';
import { normalisePage, referrerHost } from '../src/collect.mjs';
import { boot, hit, events, fakeClock, CHROME_UA } from './helpers.mjs';

const page = (p = '/') => ({ d: 'example.com', u: `https://example.com${p}`, r: null });

async function withSite(options, fn) {
  const ctx = await boot(options);
  addSite(ctx.db, { domain: 'example.com', createdAt: ctx.clock.now() });
  try {
    await fn(ctx);
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------ pure helpers

test('normalisePage keeps the path and allowlisted UTM fields only', () => {
  assert.deepEqual(normalisePage('https://example.com/pricing?email=a@b.com&utm_source=x'), {
    host: 'example.com', path: '/pricing', utm_source: 'x', utm_medium: null, utm_campaign: null
  });
  assert.deepEqual(
    normalisePage('https://example.com/a/b/?utm_medium=email&utm_campaign=launch&utm_term=t#frag'),
    { host: 'example.com', path: '/a/b/', utm_source: null, utm_medium: 'email', utm_campaign: 'launch' }
  );
  assert.equal(normalisePage('not a url'), null);
  assert.equal(normalisePage('javascript:alert(1)'), null);
  assert.equal(normalisePage('https://example.com/' + 'x'.repeat(5000)).path.length, 512);
});

test('referrerHost keeps the host only and drops self-referrals', () => {
  assert.equal(referrerHost('https://www.google.com/search?q=secret', 'example.com'), 'google.com');
  assert.equal(referrerHost('https://News.YCombinator.com/item?id=1', 'example.com'), 'news.ycombinator.com');
  assert.equal(referrerHost('https://example.com/other', 'example.com'), null);
  assert.equal(referrerHost('https://www.example.com/other', 'example.com'), null);
  assert.equal(referrerHost('', 'example.com'), null);
  assert.equal(referrerHost(null, 'example.com'), null);
  assert.equal(referrerHost('garbage', 'example.com'), null);
  assert.equal(referrerHost('android-app://com.slack/', 'example.com'), null);
});

// -------------------------------------------------------------- collector

test('a normal pageview is queued, then stored on flush with no raw IP or UA', async () => {
  await withSite({}, async ({ base, db, flush }) => {
    const res = await hit(base, { ...page('/pricing?email=a@b.com&utm_source=x'), r: 'https://www.google.com/search?q=..' });
    assert.equal(res.status, 202);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(events(db).length, 0, 'nothing is written before the flush');
    assert.equal(flush(), 1);
    const [row] = events(db);
    assert.equal(row.path, '/pricing');
    assert.equal(row.utm_source, 'x');
    assert.equal(row.referrer_host, 'google.com');
    assert.equal(row.day, '2026-11-20');
    assert.equal(row.browser, 'Chrome');
    assert.equal(row.os, 'macOS');
    assert.equal(row.device, 'desktop');
    assert.match(row.visitor_hash, /^[0-9a-f]{16}$/);
    const dump = JSON.stringify(db.prepare('SELECT * FROM events').all());
    assert.ok(!dump.includes('127.0.0.1'));
    assert.ok(!dump.includes('Macintosh'));
  });
});

test('a same-host referrer is stored as null', async () => {
  await withSite({}, async ({ base, db, flush }) => {
    await hit(base, { ...page('/b'), r: 'https://example.com/a' });
    flush();
    assert.equal(events(db)[0].referrer_host, null);
  });
});

test('the domain is matched case-insensitively and without www.', async () => {
  await withSite({}, async ({ base, db, flush }) => {
    await hit(base, { ...page(), d: 'WWW.Example.com' });
    flush();
    assert.equal(events(db).length, 1);
  });
});

test('an unregistered domain is answered and nothing is stored', async () => {
  await withSite({}, async ({ base, db, flush }) => {
    const res = await hit(base, { ...page(), d: 'unknown.org' });
    assert.ok([202, 204].includes(res.status));
    flush();
    assert.equal(events(db).length, 0);
  });
});

test('malformed bodies are rejected and nothing is stored', async () => {
  await withSite({}, async ({ base, db, flush }) => {
    assert.equal((await hit(base, '{not json')).status, 400);
    assert.equal((await hit(base, { d: 'example.com' })).status, 400);
    assert.equal((await hit(base, { d: 'example.com', u: 'ftp://example.com/x' })).status, 400);
    flush();
    assert.equal(events(db).length, 0);
  });
});

const filtered = [
  ['a bot user agent', { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }],
  ['an empty user agent', { 'user-agent': '' }],
  ['a missing Accept-Language', { 'accept-language': '' }],
  ['Sec-GPC: 1', { 'sec-gpc': '1' }]
];
for (const [label, headers] of filtered) {
  test(`${label} stores nothing`, async () => {
    await withSite({}, async ({ base, db, flush }) => {
      const res = await hit(base, page(), headers);
      assert.equal(res.status, 204);
      flush();
      assert.equal(events(db).length, 0);
    });
  });
}

test('a HEAD request stores nothing', async () => {
  await withSite({}, async ({ base, db, flush }) => {
    const res = await fetch(`${base}/api/event`, {
      method: 'HEAD',
      headers: { 'user-agent': CHROME_UA, 'accept-language': 'en' }
    });
    assert.ok(res.status < 500);
    flush();
    assert.equal(events(db).length, 0);
  });
});

test('DNT is ignored unless the site opts in through the script', async () => {
  await withSite({}, async ({ base, db, flush }) => {
    await hit(base, page('/plain'), { dnt: '1' });
    const optedIn = await hit(base, { ...page('/opted-in'), h: 1 }, { dnt: '1' });
    assert.equal(optedIn.status, 204);
    await hit(base, { ...page('/opted-in-no-dnt'), h: 1 });
    flush();
    assert.deepEqual(events(db).map((e) => e.path), ['/plain', '/opted-in-no-dnt']);
  });
});

test('X-Forwarded-For is ignored unless TRUST_PROXY is set', async () => {
  await withSite({}, async ({ base, db, flush }) => {
    await hit(base, page('/1'), { 'x-forwarded-for': '198.51.100.1' });
    await hit(base, page('/2'), { 'x-forwarded-for': '198.51.100.2' });
    flush();
    const [a, b] = events(db);
    assert.equal(a.visitor_hash, b.visitor_hash, 'both hashed from the socket address');
  });
  await withSite({ trustProxy: true }, async ({ base, db, flush }) => {
    await hit(base, page('/1'), { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' });
    await hit(base, page('/2'), { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' });
    await hit(base, page('/3'), { 'x-forwarded-for': '198.51.100.1' });
    flush();
    const [a, b, c] = events(db);
    assert.notEqual(a.visitor_hash, b.visitor_hash);
    assert.equal(a.visitor_hash, c.visitor_hash);
  });
});

test('CF-IPCountry is read only behind a trusted proxy', async () => {
  await withSite({}, async ({ base, db, flush }) => {
    await hit(base, page(), { 'cf-ipcountry': 'AU' });
    flush();
    assert.equal(events(db)[0].country, null);
  });
  await withSite({ trustProxy: true }, async ({ base, db, flush }) => {
    await hit(base, page('/a'), { 'cf-ipcountry': 'au' });
    await hit(base, page('/b'), { 'cf-ipcountry': 'XX' });
    await hit(base, page('/c'), { 'cf-ipcountry': '<b>' });
    flush();
    assert.deepEqual(events(db).map((e) => e.country), ['AU', null, null]);
  });
});

test('hits either side of UTC midnight land on different days with different hashes', async () => {
  const clock = fakeClock('2026-11-20T23:59:59Z');
  await withSite({ clock }, async ({ base, db, flush }) => {
    await hit(base, page('/late'));
    clock.set('2026-11-21T00:00:00Z');
    await hit(base, page('/early'));
    flush();
    const [late, early] = events(db);
    assert.equal(late.day, '2026-11-20');
    assert.equal(early.day, '2026-11-21');
    assert.notEqual(late.visitor_hash, early.visitor_hash);
  });
});

test('the same visitor twice in a day gives one distinct hash (AE1)', async () => {
  await withSite({}, async ({ base, db, flush }) => {
    await hit(base, page('/a'));
    await hit(base, page('/b'));
    flush();
    const distinct = db.prepare('SELECT COUNT(DISTINCT visitor_hash) AS n FROM events').get().n;
    assert.equal(distinct, 1);
  });
});

test('CORS preflight is answered without credentials', async () => {
  await withSite({}, async ({ base }) => {
    const res = await fetch(`${base}/api/event`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  });
});

test('integration: 50 hits within one flush interval land in one transaction', async () => {
  const clock = fakeClock();
  await withSite({ clock }, async ({ base, db, start }) => {
    start();
    let transactions = 0;
    const realTransaction = db.transaction.bind(db);
    // Count commits by wrapping the statement the queue uses.
    db.transaction = (fn) => { const t = realTransaction(fn); return (...a) => { transactions++; return t(...a); }; };
    await Promise.all(Array.from({ length: 50 }, (_, i) => hit(base, page(`/p${i}`))));
    assert.equal(events(db).length, 0);
    clock.fire(1000);
    assert.equal(events(db).length, 50);
    assert.equal(transactions, 1);
    db.transaction = realTransaction;
  });
});

test('stop() flushes whatever is still queued', async () => {
  const db = openDb(':memory:');
  addSite(db, { domain: 'example.com', createdAt: Date.now() });
  const ctx = await boot({ db });
  await hit(ctx.base, page('/last'));
  ctx.stop();
  assert.equal(events(db).length, 1);
  await ctx.close();
});

test('with a retention period, older events are pruned and newer ones kept', async () => {
  const clock = fakeClock('2026-11-20T12:00:00Z');
  await withSite({ clock, retentionDays: 30 }, async ({ base, db, flush, prune, start }) => {
    clock.set('2026-10-01T12:00:00Z');
    await hit(base, page('/old'));
    clock.set('2026-10-25T12:00:00Z');
    await hit(base, page('/recent'));
    flush();
    clock.set('2026-11-20T12:00:00Z');
    assert.equal(prune(), 1);
    assert.deepEqual(events(db).map((e) => e.path), ['/recent']);
    // The daily timer runs the same pruning.
    clock.set('2026-11-23T12:00:00Z');
    start();
    assert.equal(events(db).length, 1, 'still inside the 30 days');
    clock.set('2026-11-25T12:00:01Z');
    clock.fire(24 * 3600_000);
    assert.equal(events(db).length, 0);
  });
});

test('without a retention period, events are kept', async () => {
  const clock = fakeClock('2020-01-01T00:00:00Z');
  await withSite({ clock }, async ({ base, db, flush, prune }) => {
    await hit(base, page('/ancient'));
    flush();
    clock.set('2026-11-20T00:00:00Z');
    assert.equal(prune(), 0);
    assert.equal(events(db).length, 1);
  });
});

test('the database file never contains the raw IP or user agent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-'));
  const file = path.join(dir, 'test.db');
  const db = openDb(file);
  addSite(db, { domain: 'example.com', createdAt: Date.now() });
  const ctx = await boot({ db, trustProxy: true });
  await hit(ctx.base, page('/x'), { 'x-forwarded-for': '198.51.100.77', 'user-agent': CHROME_UA + ' UniqueMarker/9' });
  ctx.flush();
  db.pragma('wal_checkpoint(TRUNCATE)');
  await ctx.close();
  const bytes = fs.readFileSync(file).toString('latin1');
  assert.ok(bytes.includes('/x'), 'sanity: the event is in the file');
  assert.ok(!bytes.includes('198.51.100.77'));
  assert.ok(!bytes.includes('UniqueMarker'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the tracker script is served as JavaScript and reads data-domain', async () => {
  await withSite({}, async ({ base }) => {
    const res = await fetch(`${base}/script.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    const body = await res.text();
    assert.match(body, /data-domain/);
    assert.match(body, /sendBeacon/);
    assert.match(body, /pushState/);
    assert.match(body, /data-respect-dnt/);
    assert.ok(!/cookie|localStorage|sessionStorage/i.test(body), 'stores nothing on the visitor\'s device');
  });
});
