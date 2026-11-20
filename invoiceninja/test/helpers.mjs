// Shared test harness: an app on an ephemeral port with an in-memory DB and a settable clock.
import { openDb } from '../src/db.mjs';
import { createApp } from '../src/app.mjs';

export const PASSWORD = 'correct horse battery';

export async function startApp({ timezone = 'UTC', now = Date.parse('2026-03-10T10:00:00Z') } = {}) {
  const db = openDb(':memory:', { timezone });
  const clock = { t: now, now() { return this.t; } };
  const app = createApp({ db, clock, adminPassword: PASSWORD });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function request(path, { method = 'GET', form, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(method === 'POST' ? { 'sec-fetch-site': 'same-origin' } : {}),
        ...headers,
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.getSetCookie();
    for (const c of set) {
      const pair = c.split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }

  const get = (path, opts) => request(path, { ...opts, method: 'GET' });
  const post = (path, form = {}, opts) => request(path, { ...opts, method: 'POST', form });
  const login = () => post('/login', { password: PASSWORD, next: '/' });

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  return { db, clock, base, get, post, login, close, clearCookie: () => { cookie = ''; } };
}

/** Id from a "/invoices/12" style redirect. */
export const idFrom = (location) => Number(/\/(\d+)$/.exec(location)?.[1]);
