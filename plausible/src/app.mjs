/**
 * The app factory. Everything with state or time in it (database, clock,
 * timers) is passed in, so tests run against in-memory SQLite and a fake clock.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pruneEvents } from './db.mjs';
import { createSaltStore } from './salt.mjs';
import { createCollector } from './collect.mjs';
import { createAuth } from './auth.mjs';
import { createDashboard } from './dashboard.mjs';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export const FLUSH_MS = 1000;
export const SALT_CHECK_MS = 60_000;
export const PRUNE_MS = 24 * 60 * 60 * 1000;

const CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'"
].join('; ');

export const systemClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms).unref(),
  clearInterval: (handle) => clearInterval(handle)
};

export function createApp({
  db,
  clock = systemClock,
  trustProxy = false,
  retentionDays = null,
  adminPassword = '',
  baseUrl = null
} = {}) {
  if (!db) throw new Error('createApp needs a database');
  const salts = createSaltStore(db, clock);
  const collector = createCollector({ db, clock, salts, trustProxy });

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', true);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin'
    });
    next();
  });

  app.all('/api/event', express.text({ type: () => true, limit: '8kb' }), collector.handler);

  app.get('/healthz', (req, res) => res.type('text/plain').set('Cache-Control', 'no-store').send('ok\n'));

  app.use(express.static(PUBLIC_DIR, {
    index: false,
    maxAge: '1h',
    setHeaders: (res, file) => {
      if (file.endsWith('.js')) res.set('Content-Type', 'text/javascript; charset=utf-8');
    }
  }));

  const auth = createAuth({ password: adminPassword, clock, trustProxy });
  app.use(createDashboard({ db, clock, auth, baseUrl }));

  app.use((req, res) => res.status(404).type('text/plain').send('Not found.\n'));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).end();
    if (err.type === 'entity.parse.failed') return res.status(400).end();
    console.error(err);
    res.status(500).type('text/plain').send('Something went wrong.\n');
  });

  const prune = () => (retentionDays ? pruneEvents(db, { days: retentionDays, now: clock.now() }) : 0);

  const timers = [];
  function start() {
    timers.push(clock.setInterval(() => collector.flush(), FLUSH_MS));
    timers.push(clock.setInterval(() => salts.rotate(), SALT_CHECK_MS));
    if (retentionDays) {
      prune();
      timers.push(clock.setInterval(prune, PRUNE_MS));
    }
  }
  function stop() {
    while (timers.length) clock.clearInterval(timers.pop());
    collector.flush();
  }

  return { app, salts, flush: collector.flush, prune, start, stop };
}
