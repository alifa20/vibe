/**
 * The owner's side: sign in, list and add sites, and read one site's numbers.
 * All figures are aggregated from the raw events table at request time.
 */
import express from 'express';
import { addSite, dayKey, listSites, siteByDomain } from './db.mjs';
import { sameOriginOnly } from './auth.mjs';
import { barChart } from './charts.mjs';
import { loginPage, notFoundPage, sitePage, sitesPage } from './views.mjs';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const TOP_N = 10;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Turns whatever was pasted ("https://www.Example.com/blog") into the bare
 * host the tracker will report ("example.com"). Anything that is not a
 * hostname afterwards is an error.
 */
export function normaliseDomain(input) {
  let value = String(input ?? '').trim().toLowerCase();
  const error = { error: 'Enter a domain like example.com.' };
  if (!value) return error;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/)[0];
  value = value.slice(value.lastIndexOf('@') + 1);
  value = value.replace(/:\d*$/, '').replace(/\.$/, '').replace(/^www\./, '');
  if (value === 'localhost') return { domain: value };
  if (!HOSTNAME_RE.test(value)) return error;
  return { domain: value };
}

const BREAKDOWNS = {
  pages: 'path',
  referrers: 'referrer_host',
  sources: 'utm_source',
  campaigns: 'utm_campaign',
  browsers: 'browser',
  os: 'os',
  devices: 'device'
};

const PRESETS = { today: 1, '7d': 7, '30d': 30 };
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && dayKey(Date.parse(`${value}T00:00:00Z`) || 0) === value;
const addDays = (day, n) => dayKey(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);

/** Every UTC day from `from` to `to`, inclusive. */
export function daySeries(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Reads ?range= (and ?from=&to= for custom) into an inclusive UTC day range. */
export function pickRange(query, now) {
  const today = dayKey(now);
  const preset = (n, name, flash = null) => ({ preset: name, from: addDays(today, 1 - n), to: today, days: n, flash });

  if (query.range === 'custom') {
    let from = String(query.from || '');
    let to = String(query.to || '');
    if (!isDay(from) || !isDay(to)) return preset(30, '30d', 'That custom range could not be read, so the last 30 days are shown.');
    if (from > to) [from, to] = [to, from];
    let flash = null;
    if (daySeries(from, to).length > MAX_RANGE_DAYS) {
      from = addDays(to, 1 - MAX_RANGE_DAYS);
      flash = `Ranges are capped at ${MAX_RANGE_DAYS} days, so the range starts on ${from}.`;
    }
    return { preset: 'custom', from, to, days: daySeries(from, to).length, flash };
  }
  const name = Object.hasOwn(PRESETS, query.range) ? query.range : '30d';
  return preset(PRESETS[name], name);
}

function createQueries(db) {
  const where = 'site_id = ? AND day BETWEEN ? AND ?';
  const daily = db.prepare(`
    SELECT day, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
      FROM events WHERE ${where} GROUP BY day`);
  // A visitor seen on two days is two visitors here too, matching the headline.
  const breakdowns = Object.fromEntries(Object.entries(BREAKDOWNS).map(([name, column]) => [name, db.prepare(`
    SELECT ${column} AS key, COUNT(*) AS pageviews, COUNT(DISTINCT day || ':' || visitor_hash) AS visitors
      FROM events WHERE ${where} AND ${column} IS NOT NULL
     GROUP BY ${column} ORDER BY pageviews DESC, key ASC LIMIT ${TOP_N}`)]));
  const anyEvent = db.prepare('SELECT 1 FROM events WHERE site_id = ? LIMIT 1');
  const today = db.prepare(`
    SELECT site_id, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
      FROM events WHERE day = ? GROUP BY site_id`);

  return {
    hasEvents: (siteId) => Boolean(anyEvent.get(siteId)),
    daily: (siteId, range) => daily.all(siteId, range.from, range.to),
    breakdown: (name, siteId, range) => breakdowns[name].all(siteId, range.from, range.to),
    today: (day) => today.all(day)
  };
}

export function createDashboard({ db, clock, auth, baseUrl = null }) {
  const queries = createQueries(db);
  const router = express.Router();
  const html = (res, status, body) => res.status(status).set('Cache-Control', 'no-store').type('html').send(body);
  const originOf = (req) => baseUrl || `${req.protocol}://${req.get('host')}`;

  router.use(sameOriginOnly);
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  router.get('/login', (req, res) => {
    if (!auth.enabled) return html(res, 503, loginPage({ unavailable: true }));
    if (auth.hasSession(req)) return res.redirect(303, '/');
    return html(res, 200, loginPage());
  });

  router.post('/login', (req, res) => {
    if (!auth.enabled) return html(res, 503, loginPage({ unavailable: true }));
    const wait = auth.lockedFor(req);
    if (wait) {
      res.set('Retry-After', String(wait));
      return html(res, 429, loginPage({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minutes.` }));
    }
    if (!auth.checkPassword(req.body?.password ?? '')) {
      auth.recordFailure(req);
      return html(res, 401, loginPage({ error: 'That password is not right.' }));
    }
    auth.recordSuccess(req);
    auth.startSession(req, res);
    return res.set('Cache-Control', 'no-store').redirect(303, '/');
  });

  router.post('/logout', (req, res) => {
    auth.endSession(req, res);
    return res.set('Cache-Control', 'no-store').redirect(303, '/login');
  });

  function renderSites(req, res, status, form) {
    const day = dayKey(clock.now());
    const counts = new Map(queries.today(day).map((row) => [row.site_id, row]));
    const sites = listSites(db).map((site) => ({
      domain: site.domain,
      pageviews: counts.get(site.id)?.pageviews ?? 0,
      visitors: counts.get(site.id)?.visitors ?? 0
    }));
    return html(res, status, sitesPage({ sites, today: day, form }));
  }

  router.get('/', auth.requireSession, (req, res) => renderSites(req, res, 200, {}));

  router.post('/sites', auth.requireSession, (req, res) => {
    const raw = req.body?.domain ?? '';
    const { domain, error } = normaliseDomain(raw);
    if (error) return renderSites(req, res, 400, { value: raw, error });
    addSite(db, { domain, createdAt: clock.now() });
    return res.redirect(303, `/sites/${encodeURIComponent(domain)}`);
  });

  router.get('/sites/:domain', auth.requireSession, (req, res) => {
    const site = siteByDomain(db, String(req.params.domain).toLowerCase());
    if (!site) return html(res, 404, notFoundPage('No site with that domain has been added.'));

    const origin = originOf(req);
    if (!queries.hasEvents(site.id)) {
      return html(res, 200, sitePage({ domain: site.domain, origin, hasEvents: false, range: { days: 0 } }));
    }

    const range = pickRange(req.query, clock.now());
    const byDay = new Map(queries.daily(site.id, range).map((row) => [row.day, row]));
    const series = daySeries(range.from, range.to).map((day) => ({
      day,
      pageviews: byDay.get(day)?.pageviews ?? 0,
      visitors: byDay.get(day)?.visitors ?? 0
    }));
    const totals = series.reduce((acc, point) => ({
      pageviews: acc.pageviews + point.pageviews,
      visitors: acc.visitors + point.visitors
    }), { pageviews: 0, visitors: 0 });
    const breakdowns = Object.fromEntries(Object.keys(BREAKDOWNS).map((name) => [name, queries.breakdown(name, site.id, range)]));

    return html(res, 200, sitePage({
      domain: site.domain,
      origin,
      range,
      flash: range.flash,
      hasEvents: true,
      totals,
      chart: barChart(series),
      breakdowns
    }));
  });

  return router;
}
