import { openDb } from '../src/db.mjs';
import { createApp } from '../src/app.mjs';

export const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const PASSWORD = 'correct horse battery staple';

/** A clock the tests move by hand. Intervals are recorded, never scheduled. */
export function fakeClock(iso = '2026-11-20T12:00:00.000Z') {
  let now = Date.parse(iso);
  const intervals = [];
  return {
    now: () => now,
    set: (value) => { now = Date.parse(value); },
    advance: (ms) => { now += ms; },
    intervals,
    setInterval: (fn, ms) => {
      const handle = { fn, ms, cleared: false };
      intervals.push(handle);
      return handle;
    },
    clearInterval: (handle) => { if (handle) handle.cleared = true; },
    /** Run every live interval whose period matches `ms`. */
    fire: (ms) => { for (const h of intervals) if (!h.cleared && h.ms === ms) h.fn(); }
  };
}

/** Boot an app on an ephemeral port against an in-memory database. */
export async function boot(options = {}) {
  const db = options.db ?? openDb(':memory:');
  const clock = options.clock ?? fakeClock();
  const runtime = createApp({ db, clock, adminPassword: PASSWORD, ...options, db, clock });
  const server = await new Promise((resolve) => {
    const s = runtime.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...runtime,
    db,
    clock,
    base,
    async close () {
      runtime.stop();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    }
  };
}

/** Post a tracker payload the way the script does: a text/plain body. */
export function hit(base, payload, headers = {}) {
  return fetch(`${base}/api/event`, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'user-agent': CHROME_UA,
      'accept-language': 'en-AU,en;q=0.9',
      ...headers
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload)
  });
}

export const events = (db) => db.prepare('SELECT * FROM events ORDER BY id').all();

/** Sign in and return the session cookie ("name=value"). */
export async function login(base, password = PASSWORD) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password })
  });
  if (res.status !== 303) throw new Error(`login failed: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

/** Write an event row directly, for dashboard tests. */
export function seedEvent(db, siteId, fields) {
  const row = {
    site_id: siteId,
    ts: Date.parse(`${fields.day}T12:00:00Z`),
    visitor_hash: 'v1',
    path: '/',
    referrer_host: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    browser: 'Chrome',
    os: 'macOS',
    device: 'desktop',
    country: null,
    ...fields
  };
  db.prepare(`
    INSERT INTO events (site_id, ts, day, visitor_hash, path, referrer_host, utm_source, utm_medium,
                        utm_campaign, browser, os, device, country)
    VALUES (@site_id, @ts, @day, @visitor_hash, @path, @referrer_host, @utm_source, @utm_medium,
            @utm_campaign, @browser, @os, @device, @country)
  `).run(row);
}
