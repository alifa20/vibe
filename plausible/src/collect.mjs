/**
 * The collect endpoint: one pageview per POST from the tracking script.
 *
 * Every request gets a quick, uninformative answer. Hits that pass the filters
 * are reduced to a row with no IP and no user agent in it, and put on an
 * in-memory queue that is written to SQLite in one transaction per flush.
 */
import { siteByDomain } from './db.mjs';
import { visitorHash } from './salt.mjs';
import { isBotUA, parseUA } from './ua.mjs';

const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign'];
const MAX_PATH = 512;
const MAX_FIELD = 128;
export const MAX_QUEUE = 10_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

/** Lowercase, no trailing dot, no leading "www.". */
export const normaliseHost = (host) =>
  String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

/**
 * The client address. Proxy headers are only believed when TRUST_PROXY is
 * set; otherwise anyone could pick their own "IP" and inflate the counts.
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
  }
  return req.socket.remoteAddress || '';
}

/** Path plus the allowlisted UTM fields. Every other query parameter is dropped. */
export function normalisePage(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const page = { host: normaliseHost(url.hostname), path: (url.pathname || '/').slice(0, MAX_PATH) };
  for (const field of UTM_FIELDS) {
    const value = url.searchParams.get(field);
    page[field] = value ? value.trim().slice(0, MAX_FIELD) || null : null;
  }
  return page;
}

/** Host only, without "www."; null for a missing, unusable or self referrer. */
export function referrerHost(raw, ...selfHosts) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = normaliseHost(url.hostname);
  if (!host || selfHosts.map(normaliseHost).includes(host)) return null;
  return host.slice(0, MAX_FIELD);
}

/** Two-letter country from Cloudflare, only when a trusted proxy set it. */
function countryOf(req, trustProxy) {
  if (!trustProxy) return null;
  const code = String(req.headers['cf-ipcountry'] || '').toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
}

/** Signals that a hit should not be recorded at all. */
function shouldDrop(req, payload) {
  if (isBotUA(req.headers['user-agent'])) return true;
  if (!String(req.headers['accept-language'] || '').trim()) return true;
  if (req.headers['sec-gpc'] === '1') return true;
  // Do Not Track is honoured only for sites whose script opts in.
  if (payload.h && req.headers.dnt === '1') return true;
  return false;
}

function parsePayload(body) {
  let payload;
  try {
    payload = JSON.parse(typeof body === 'string' ? body : '');
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.d !== 'string' || typeof payload.u !== 'string') return null;
  return payload;
}

export function createCollector({ db, clock, salts, trustProxy = false }) {
  const insert = db.prepare(`
    INSERT INTO events (site_id, ts, day, visitor_hash, path, referrer_host,
                        utm_source, utm_medium, utm_campaign, browser, os, device, country)
    VALUES (@site_id, @ts, @day, @visitor_hash, @path, @referrer_host,
            @utm_source, @utm_medium, @utm_campaign, @browser, @os, @device, @country)
  `);

  let queue = [];

  /**
   * Writes everything queued in a single transaction. Returns the row count.
   * Rows leave the queue only once the transaction commits: on a SQLite error
   * (busy past busy_timeout, disk full) they are put back for the next flush,
   * keeping the newest MAX_QUEUE, and 0 is returned instead of throwing.
   */
  function flush() {
    if (!queue.length) return 0;
    const rows = queue;
    queue = [];
    try {
      db.transaction((batch) => { for (const row of batch) insert.run(row); })(rows);
    } catch (err) {
      console.error(`analytics: flush of ${rows.length} pageviews failed, kept for retry:`, err);
      queue = rows.concat(queue);
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
      return 0;
    }
    return rows.length;
  }

  function handler(req, res) {
    res.set(CORS);
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS' || req.method === 'HEAD') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').end();

    const payload = parsePayload(req.body);
    if (!payload) return res.status(400).end();
    const page = normalisePage(payload.u);
    if (!page) return res.status(400).end();

    const site = siteByDomain(db, normaliseHost(payload.d));
    if (!site || shouldDrop(req, payload)) return res.status(204).end();

    const ts = clock.now();
    const { day, salt } = salts.current(ts);
    const ua = String(req.headers['user-agent']);
    queue.push({
      site_id: site.id,
      ts,
      day,
      visitor_hash: visitorHash(salt, site.domain, clientIp(req, trustProxy), ua),
      path: page.path,
      referrer_host: referrerHost(typeof payload.r === 'string' ? payload.r : null, page.host, site.domain),
      utm_source: page.utm_source,
      utm_medium: page.utm_medium,
      utm_campaign: page.utm_campaign,
      ...parseUA(ua),
      country: countryOf(req, trustProxy)
    });
    if (queue.length >= MAX_QUEUE) flush();
    return res.status(202).end();
  }

  return { handler, flush, get size () { return queue.length; } };
}
