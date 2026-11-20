// The crawl itself: robots.txt, sitemaps, then a breadth-first walk of one origin.
//
//   crawl(startUrl, options) -> {
//     startUrl, origin, userAgent, limits, robots: { status, note },
//     sitemaps: { files, urls }, pages: [PageRecord], external: [ExternalCheck]
//   }
//
// The walk goes one depth level at a time. Each level is fetched with
// `concurrency` workers, then its links are queued in page order, so the same
// site always produces the same records in the same order.
//
// PageRecord: { url, depth, status, error, blockedByRobots, redirects, redirectLoop,
//   tooManyRedirects, finalUrl, contentType, size, timeMs, tooLarge, retried,
//   title, metaDescription, h1s, canonical, metaRobots, xRobotsTag, noindex,
//   nofollow, imagesMissingAlt, links }

import { extract } from "./extract.mjs";
import { FETCH_DEFAULTS, fetchFollowing, realSleep } from "./fetch.mjs";
import { robotsFor } from "./robots.mjs";
import { loadSitemaps } from "./sitemap.mjs";
import { normaliseUrl, sameOrigin, isHttp } from "./url.mjs";

export const DEFAULTS = {
  maxPages: 10000,
  maxDepth: Infinity,
  concurrency: 3,
  externalConcurrency: 2,
  delay: 0,
  maxBodySize: FETCH_DEFAULTS.maxBodySize,
  timeoutMs: FETCH_DEFAULTS.timeoutMs,
  userAgent: "sitecrawl/1.0 (+https://github.com/alifa20/vibe/tree/main/screamingfrog)",
  checkExternal: true,
};

/** Run `worker` over `items` with at most `n` in flight; results keep input order. */
export async function pool(items, n, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, run));
  return results;
}

const isHtml = (contentType) => /\b(text\/html|application\/xhtml\+xml)\b/i.test(contentType || "");
/** A redirect loop or overlong chain never reaches a final response worth reporting. */
const settled = (res) => !(res.loop || res.tooManyRedirects);
const pathOf = (url) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

export async function crawl(startUrl, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const sleep = o.sleep ?? realSleep;
  const http = { userAgent: o.userAgent, timeoutMs: o.timeoutMs, maxBodySize: o.maxBodySize, sleep, now: o.now, fetchImpl: o.fetchImpl };
  const polite = async (fn) => {
    const out = await fn();
    if (o.delay > 0) await sleep(o.delay);
    return out;
  };
  const log = o.onProgress ?? (() => {});

  const start = normaliseUrl(startUrl);
  const origin = new URL(start).origin;

  // robots.txt
  const robotsUrl = origin + "/robots.txt";
  const robotsRes = await polite(() => fetchFollowing(robotsUrl, http));
  const robots = robotsFor(
    { status: robotsRes.final.status, body: robotsRes.final.body.toString("utf8") },
    o.userAgent,
  );

  // sitemaps: the ones robots.txt names, else /sitemap.xml
  const sitemapStarts = robots.sitemaps.length
    ? robots.sitemaps.map((s) => new URL(s, robotsUrl).href)
    : [origin + "/sitemap.xml"];
  const sitemaps = await loadSitemaps(sitemapStarts, (u) => polite(() => fetchFollowing(u, http)));
  sitemaps.urls = sitemaps.urls.filter((u) => sameOrigin(u, origin)).map(normaliseUrl);

  // breadth-first walk
  const pages = [];
  const seen = new Set([start]);
  let level = [start];
  let depth = 0;

  const visit = async (url) => {
    const record = { url, depth, status: null, error: null, blockedByRobots: false, redirects: [], links: [] };
    if (!robots.isAllowed(pathOf(url))) {
      record.blockedByRobots = true;
      return record;
    }
    const res = await polite(() => fetchFollowing(url, http));
    const { final } = res;
    Object.assign(record, {
      status: res.hops.length ? res.hops[0].status : final.status,
      error: final.error,
      redirects: res.hops,
      redirectLoop: res.loop,
      tooManyRedirects: res.tooManyRedirects,
      finalUrl: res.hops.length ? (settled(res) ? final.url : null) : url,
      finalStatus: settled(res) ? final.status : null,
      contentType: final.headers["content-type"] ?? null,
      size: final.size,
      timeMs: final.timeMs,
      tooLarge: final.tooLarge,
      retried: Boolean(final.retried),
    });
    if (!res.hops.length && final.status >= 200 && final.status < 300 && !final.tooLarge && isHtml(record.contentType)) {
      Object.assign(record, extract(final.body.toString("utf8"), { url, headers: final.headers }));
    }
    return record;
  };

  while (level.length) {
    log({ depth, queued: level.length, done: pages.length });
    const results = await pool(level, o.concurrency, visit);
    const next = [];
    for (const record of results) {
      pages.push(record);
      const candidates = [];
      if (!record.nofollow) candidates.push(...record.links);
      if (record.canonical) candidates.push(record.canonical);
      if (record.finalUrl && record.finalUrl !== record.url) candidates.push(record.finalUrl);
      for (const link of candidates) {
        if (!sameOrigin(link, origin) || seen.has(link)) continue;
        if (depth + 1 > o.maxDepth || seen.size >= o.maxPages) continue;
        seen.add(link);
        next.push(link);
      }
    }
    level = next;
    depth++;
  }

  // external links: HEAD, then GET when HEAD is refused
  const external = [];
  if (o.checkExternal) {
    const targets = [...new Set(pages.flatMap((p) => p.links).filter((l) => isHttp(l) && !sameOrigin(l, origin)))];
    const checked = await pool(targets, o.externalConcurrency, async (url) => {
      let res = await polite(() => fetchFollowing(url, { ...http, method: "HEAD" }));
      if (res.final.status === 405 || res.final.status === 501) {
        res = await polite(() => fetchFollowing(url, { ...http, method: "GET" }));
      }
      return {
        url,
        status: settled(res) ? res.final.status : res.hops[0].status,
        finalStatus: settled(res) ? res.final.status : null,
        redirects: res.hops,
        redirectLoop: res.loop,
        error: res.final.error,
      };
    });
    external.push(...checked);
  }

  return {
    startUrl: start,
    origin,
    userAgent: o.userAgent,
    limits: { maxPages: o.maxPages, maxDepth: o.maxDepth, maxBodySize: o.maxBodySize },
    robots: { status: robotsRes.final.status, note: robots.note },
    sitemaps,
    pages,
    external,
  };
}
