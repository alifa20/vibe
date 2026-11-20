import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { createAuth, sameOriginOnly } from './auth.mjs';
import { validateMonitor } from './checks.mjs';
import { createNotifier } from './notify.mjs';
import { createScheduler } from './scheduler.mjs';
import { createHeartbeats, validateHeartbeat } from './heartbeat.mjs';
import { createTlsChecker, probeTls as realProbeTls } from './tls.mjs';
import {
  createMonitor, deleteMonitor, getMonitor, listMonitors, recentChecks, setMonitorPaused, updateMonitor, uptime24h,
} from './monitors.mjs';
import * as views from './views.mjs';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self'",
  "style-src 'self'",
].join('; ');

/**
 * Builds the Express app and the scheduler around one database. Everything
 * time- or network-dependent is injectable for tests.
 */
export function createApp({
  db,
  adminPassword,
  clock = { now: () => Date.now() },
  timers,
  random,
  notifier = createNotifier(),
  logger = console,
  fetchImpl,
  signalFor,
  probeTls = realProbeTls,
  baseUrl = '',
  trustProxy = '',
} = {}) {
  const auth = createAuth({ password: adminPassword, clock });
  const afterCheck = createTlsChecker({ db, notifier, probe: probeTls, logger });
  const scheduler = createScheduler({ db, notifier, clock, timers, random, logger, fetchImpl, signalFor, hooks: { afterCheck } });
  const heartbeats = createHeartbeats({ db, notifier, clock, timers, logger });

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    next();
  });

  app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: 0 }));

  // ------------------------------------------------------------ pings
  // Public and unauthenticated: the random token is the credential. The
  // answer is the same 404 for a malformed, unknown or deleted token.
  const pingHandler = (kind) => (req, res) => {
    res.set('Cache-Control', 'no-store').type('text/plain');
    const k = kind ?? req.params.kind;
    if (k !== 'ping' && k !== 'start' && k !== 'fail') return res.status(404).send('Not found\n');
    if (!heartbeats.ping(req.params.token, k)) return res.status(404).send('Not found\n');
    res.send('OK\n');
  };
  app.route('/ping/:token').get(pingHandler('ping')).post(pingHandler('ping'));
  app.route('/ping/:token/:kind').get(pingHandler()).post(pingHandler());

  // ------------------------------------------------------------ admin
  const html = (res, body, status = 200) => res.status(status).set('Cache-Control', 'no-store').type('html').send(body);

  app.use(sameOriginOnly);
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));

  app.get('/login', (req, res) => {
    if (auth.hasSession(req)) return res.redirect(303, '/');
    html(res, views.loginPage());
  });

  app.post('/login', (req, res) => {
    const result = auth.login(req, String(req.body?.password ?? ''));
    if (result.ok) return res.set('Set-Cookie', result.cookie).redirect(303, '/');
    if (result.lockedMs) {
      res.set('Retry-After', String(Math.ceil(result.lockedMs / 1000)));
      return html(res, views.loginPage({ error: 'Too many failed sign-ins. Try again later.' }), 429);
    }
    html(res, views.loginPage({ error: 'That password is not right.' }), 401);
  });

  app.post('/logout', (req, res) => res.set('Set-Cookie', auth.logoutCookie(req)).redirect(303, '/login'));

  const admin = express.Router();
  admin.use(auth.requireLogin);

  admin.get('/', (req, res) => {
    const now = clock.now();
    const monitors = listMonitors(db).map((m) => ({
      ...m,
      uptime: uptime24h(db, m.id, now),
      latencies: recentChecks(db, m.id, 30).map((c) => c.latency_ms),
    }));
    const incidents = db.prepare(`
      SELECT i.*, COALESCE(m.name, h.name) AS name FROM incidents i
      LEFT JOIN monitors m ON i.kind = 'monitor' AND m.id = i.ref_id
      LEFT JOIN heartbeats h ON i.kind = 'heartbeat' AND h.id = i.ref_id
      ORDER BY i.started_at DESC LIMIT 15`).all();
    html(res, views.dashboard({ monitors, heartbeats: heartbeats.list(), incidents, now }));
  });

  // Monitors
  const loadMonitor = (req, res) => {
    const m = /^\d+$/.test(req.params.id) ? getMonitor(db, Number(req.params.id)) : null;
    if (!m) html(res, views.notFoundPage(), 404);
    return m;
  };

  admin.get('/monitors/new', (req, res) => html(res, views.monitorForm({ title: 'New monitor', action: '/monitors' })));

  admin.post('/monitors', (req, res) => {
    const { values, errors } = validateMonitor(req.body ?? {});
    if (Object.keys(errors).length) {
      return html(res, views.monitorForm({ title: 'New monitor', action: '/monitors', values: req.body, errors }), 422);
    }
    const id = createMonitor(db, values, clock.now());
    scheduler.monitorChanged(id);
    res.redirect(303, `/monitors/${id}`);
  });

  admin.get('/monitors/:id', (req, res) => {
    const m = loadMonitor(req, res);
    if (!m) return;
    const now = clock.now();
    html(res, views.monitorDetail({
      monitor: m,
      checks: recentChecks(db, m.id, 50),
      incidents: db.prepare("SELECT * FROM incidents WHERE kind = 'monitor' AND ref_id = ? ORDER BY id DESC LIMIT 20").all(m.id),
      uptime: uptime24h(db, m.id, now),
      now,
    }));
  });

  admin.get('/monitors/:id/edit', (req, res) => {
    const m = loadMonitor(req, res);
    if (m) html(res, views.monitorForm({ title: `Edit ${m.name}`, action: `/monitors/${m.id}`, values: m }));
  });

  admin.post('/monitors/:id', (req, res) => {
    const m = loadMonitor(req, res);
    if (!m) return;
    const { values, errors } = validateMonitor(req.body ?? {});
    if (Object.keys(errors).length) {
      return html(res, views.monitorForm({ title: `Edit ${m.name}`, action: `/monitors/${m.id}`, values: req.body, errors }), 422);
    }
    updateMonitor(db, m.id, values, clock.now());
    scheduler.monitorChanged(m.id);
    res.redirect(303, `/monitors/${m.id}`);
  });

  for (const action of ['pause', 'resume']) {
    admin.post(`/monitors/:id/${action}`, (req, res) => {
      const m = loadMonitor(req, res);
      if (!m) return;
      setMonitorPaused(db, m.id, action === 'pause', clock.now());
      scheduler.monitorChanged(m.id);
      res.redirect(303, `/monitors/${m.id}`);
    });
  }

  admin.get('/monitors/:id/delete', (req, res) => {
    const m = loadMonitor(req, res);
    if (m) html(res, views.confirmDelete({ what: 'monitor', name: m.name, action: `/monitors/${m.id}/delete`, back: `/monitors/${m.id}` }));
  });

  admin.post('/monitors/:id/delete', (req, res) => {
    const m = loadMonitor(req, res);
    if (!m) return;
    deleteMonitor(db, m.id);
    scheduler.monitorChanged(m.id);
    res.redirect(303, '/');
  });

  // Heartbeats
  const formFromHeartbeat = (hb) => ({
    name: hb.name, mode: hb.mode, cron: hb.cron ?? '0 3 * * *', tz: hb.tz ?? 'UTC',
    period_min: hb.period_s ? Math.round(hb.period_s / 60) : 60, grace_min: Math.round(hb.grace_s / 60),
  });
  const loadHeartbeat = (req, res) => {
    const hb = /^\d+$/.test(req.params.id) ? heartbeats.get(Number(req.params.id)) : null;
    if (!hb) html(res, views.notFoundPage(), 404);
    return hb;
  };
  const pingBase = (req) => (baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

  admin.get('/heartbeats/new', (req, res) => html(res, views.heartbeatForm({ title: 'New heartbeat', action: '/heartbeats' })));

  admin.post('/heartbeats', (req, res) => {
    const { values, errors } = validateHeartbeat(req.body ?? {});
    if (Object.keys(errors).length) {
      return html(res, views.heartbeatForm({ title: 'New heartbeat', action: '/heartbeats', values: req.body, errors }), 422);
    }
    const { id } = heartbeats.create(values);
    res.redirect(303, `/heartbeats/${id}`);
  });

  admin.get('/heartbeats/:id', (req, res) => {
    const hb = loadHeartbeat(req, res);
    if (!hb) return;
    html(res, views.heartbeatDetail({
      hb,
      pings: heartbeats.recentPings(hb.id, 30),
      incidents: db.prepare("SELECT * FROM incidents WHERE kind = 'heartbeat' AND ref_id = ? ORDER BY id DESC LIMIT 20").all(hb.id),
      pingBase: pingBase(req),
      now: clock.now(),
    }));
  });

  admin.get('/heartbeats/:id/edit', (req, res) => {
    const hb = loadHeartbeat(req, res);
    if (hb) html(res, views.heartbeatForm({ title: `Edit ${hb.name}`, action: `/heartbeats/${hb.id}`, values: formFromHeartbeat(hb) }));
  });

  admin.post('/heartbeats/:id', (req, res) => {
    const hb = loadHeartbeat(req, res);
    if (!hb) return;
    const { values, errors } = validateHeartbeat(req.body ?? {});
    if (Object.keys(errors).length) {
      return html(res, views.heartbeatForm({ title: `Edit ${hb.name}`, action: `/heartbeats/${hb.id}`, values: req.body, errors }), 422);
    }
    heartbeats.update(hb.id, values);
    res.redirect(303, `/heartbeats/${hb.id}`);
  });

  for (const action of ['pause', 'resume']) {
    admin.post(`/heartbeats/:id/${action}`, (req, res) => {
      const hb = loadHeartbeat(req, res);
      if (!hb) return;
      heartbeats.setPaused(hb.id, action === 'pause');
      res.redirect(303, `/heartbeats/${hb.id}`);
    });
  }

  admin.get('/heartbeats/:id/delete', (req, res) => {
    const hb = loadHeartbeat(req, res);
    if (hb) html(res, views.confirmDelete({ what: 'heartbeat', name: hb.name, action: `/heartbeats/${hb.id}/delete`, back: `/heartbeats/${hb.id}` }));
  });

  admin.post('/heartbeats/:id/delete', (req, res) => {
    const hb = loadHeartbeat(req, res);
    if (!hb) return;
    heartbeats.remove(hb.id);
    res.redirect(303, '/');
  });

  app.use(admin);

  app.use((req, res) => html(res, views.notFoundPage(), 404));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error(`[http] ${req.method} ${req.path}: ${err?.stack || err}`);
    res.status(err.status || 500).type('text/plain').send(err.status && err.status < 500 ? 'Bad request.' : 'Something went wrong.');
  });

  return {
    app,
    scheduler,
    heartbeats,
    start() {
      scheduler.start();
      heartbeats.start();
    },
    stop() {
      scheduler.stop();
      heartbeats.stop();
    },
  };
}
