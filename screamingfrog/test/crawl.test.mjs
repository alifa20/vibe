import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crawl, pool } from "../src/crawl.mjs";
import { extract } from "../src/extract.mjs";
import { retryAfterMs } from "../src/fetch.mjs";
import { parseSitemap, decodeSitemapBody } from "../src/sitemap.mjs";
import { gzipSync } from "node:zlib";
import { startFixtureSites } from "../fixtures/server.mjs";

let sites;
let full;
let fullRequests;
const sleeps = [];
const noSleep = async (ms) => {
  sleeps.push(ms);
};

before(async () => {
  sites = await startFixtureSites();
  full = await crawl(sites.origin + "/", { sleep: noSleep });
  fullRequests = [...sites.requests];
});
after(() => sites.close());

const page = (result, path) => result.pages.find((p) => p.url === sites.origin + path);

test("the crawl stays on the start origin", () => {
  for (const p of full.pages) assert.ok(p.url.startsWith(sites.origin + "/"), p.url);
  const externalPaths = sites.externalRequests.map((r) => r.path);
  assert.ok(!externalPaths.includes("/deeper"), "links on external pages are not followed");
  assert.deepEqual([...new Set(externalPaths)].sort(), ["/gone", "/head-refused", "/ok"]);
});

test("every internal page linked from the fixture is visited once", () => {
  const urls = full.pages.map((p) => p.url);
  assert.equal(new Set(urls).size, urls.length, "no duplicates");
  for (const path of ["/", "/about.html", "/blog/", "/blog/post-1.html", "/missing.html", "/new-page.html", "/pastries-old.html"]) {
    assert.ok(page(full, path), `${path} was crawled`);
  }
  assert.equal(page(full, "/missing.html").status, 404);
  assert.equal(page(full, "/blog/post-1.html").depth, 2);
});

test("mailto:, tel: and javascript: links are skipped", () => {
  const home = page(full, "/");
  assert.ok(home.links.every((l) => /^https?:/.test(l)));
  assert.ok(home.links.length > 15);
});

test("robots.txt blocks /private/ and the URL is never requested", () => {
  const blocked = page(full, "/private/secret.html");
  assert.equal(blocked.blockedByRobots, true);
  assert.equal(blocked.status, null);
  assert.ok(!fullRequests.some((r) => r.path.startsWith("/private/")));
});

test("respects maxDepth 1", async () => {
  const r = await crawl(sites.origin + "/", { maxDepth: 1, sleep: noSleep, checkExternal: false });
  assert.ok(r.pages.every((p) => p.depth <= 1));
  assert.equal(page(r, "/blog/post-1.html"), undefined);
  assert.ok(page(r, "/blog/"));
});

test("respects maxPages 3", async () => {
  const r = await crawl(sites.origin + "/", { maxPages: 3, sleep: noSleep, checkExternal: false });
  assert.equal(r.pages.length, 3);
});

test("a 301 -> 301 -> 200 chain is recorded as 2 hops", () => {
  const p = page(full, "/old-page");
  assert.equal(p.status, 301);
  assert.equal(p.redirects.length, 2);
  assert.deepEqual(p.redirects.map((h) => h.location), [sites.origin + "/older-page", sites.origin + "/new-page.html"]);
  assert.equal(p.finalUrl, sites.origin + "/new-page.html");
  assert.equal(p.finalStatus, 200);
  assert.equal(p.redirectLoop, false);
});

test("a redirect loop is recorded as a loop instead of hanging", () => {
  const p = page(full, "/loop-a");
  assert.equal(p.redirectLoop, true);
  assert.equal(p.redirects.length, 2);
  assert.equal(p.finalUrl, null);
});

test("a 429 with Retry-After: 1 is retried once after the wait", () => {
  const p = page(full, "/busy.html");
  assert.equal(p.status, 200);
  assert.equal(p.retried, true);
  assert.equal(p.title, "Order ahead");
  assert.ok(sleeps.includes(1000), "waited the Retry-After");
  assert.equal(fullRequests.filter((r) => r.path === "/busy.html").length, 2);
});

test("extracts title, description, both H1s, canonical, X-Robots-Tag noindex and images without alt", () => {
  const p = page(full, "/two-h1.html");
  assert.equal(p.title, "Celebration cakes");
  assert.equal(p.metaDescription, "Order a celebration cake with three days notice.");
  assert.deepEqual(p.h1s, ["Celebration cakes", "Order a cake"]);
  assert.equal(p.canonical, sites.origin + "/two-h1.html");
  assert.equal(p.xRobotsTag, "noindex");
  assert.equal(p.noindex, true);
  assert.deepEqual(p.imagesMissingAlt, ["/img/cake-1.jpg", "/img/cake-2.jpg"]);
  assert.ok(p.size > 0 && Number.isFinite(p.timeMs));
});

test("meta robots noindex is read from the page", () => {
  assert.equal(page(full, "/noindex.html").noindex, true);
  assert.equal(page(full, "/about.html").noindex, false);
});

test("sitemaps are read through robots.txt, an index file and a .gz file", () => {
  assert.deepEqual(full.sitemaps.files.map((f) => f.kind), ["index", "urlset"]);
  assert.ok(full.sitemaps.urls.includes(sites.origin + "/orphan.html"));
  assert.equal(page(full, "/orphan.html"), undefined, "the orphan is never linked, so never crawled");
});

test("external links are checked with HEAD, then GET on 405", () => {
  const byPath = Object.fromEntries(full.external.map((e) => [new URL(e.url).pathname, e]));
  assert.equal(byPath["/ok"].status, 200);
  assert.equal(byPath["/gone"].status, 404);
  assert.equal(byPath["/head-refused"].status, 200);
  const methods = sites.externalRequests.filter((r) => r.path === "/head-refused").map((r) => r.method);
  assert.deepEqual(methods, ["HEAD", "GET"]);
  assert.ok(sites.externalRequests.filter((r) => r.path === "/ok").every((r) => r.method === "HEAD"));
});

test("bodies larger than maxBodySize are aborted and not parsed", async () => {
  const r = await crawl(sites.origin + "/", { maxBodySize: 100, sleep: noSleep, checkExternal: false });
  const home = page(r, "/");
  assert.equal(home.tooLarge, true);
  assert.equal(home.title, undefined);
  assert.equal(r.pages.length, 1);
});

test("delay waits between requests", async () => {
  const waits = [];
  await crawl(sites.origin + "/", { maxPages: 2, delay: 250, sleep: async (ms) => waits.push(ms), checkExternal: false });
  assert.ok(waits.filter((ms) => ms === 250).length >= 2);
});

test("a robots.txt 503 stops the whole crawl", async () => {
  const fetchImpl = async (url) =>
    new URL(url).pathname === "/robots.txt" ? new Response("", { status: 503 }) : new Response("<title>x</title>", { headers: { "content-type": "text/html" } });
  const r = await crawl("http://site.test/", { fetchImpl, sleep: noSleep, checkExternal: false });
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].blockedByRobots, true);
});

test("extract resolves links against <base href> and drops duplicates", () => {
  const html = `<base href="/docs/"><a href="a">a</a><a href="a#x">dup</a><a href="/b?x=1">b</a><a href="mailto:x@y.z">m</a>`;
  const out = extract(html, { url: "http://example.com/start/page", headers: {} });
  assert.deepEqual(out.links, ["http://example.com/docs/a", "http://example.com/b?x=1"]);
  assert.equal(out.title, null);
  assert.deepEqual(out.h1s, []);
});

test("retryAfterMs reads seconds and HTTP dates", () => {
  assert.equal(retryAfterMs("1"), 1000);
  assert.equal(retryAfterMs("Wed, 21 Oct 2026 07:28:10 GMT", Date.parse("Wed, 21 Oct 2026 07:28:00 GMT")), 10000);
  assert.equal(retryAfterMs(undefined), null);
  assert.equal(retryAfterMs("soon"), null);
});

test("sitemap parsing handles urlsets, index files and gzip", () => {
  const xml = `<urlset><url><loc> http://e.test/a </loc></url><url><loc>http://e.test/b</loc></url></urlset>`;
  assert.deepEqual(parseSitemap(xml), { kind: "urlset", locs: ["http://e.test/a", "http://e.test/b"] });
  assert.equal(parseSitemap(`<sitemapindex><sitemap><loc>http://e.test/s.xml</loc></sitemap></sitemapindex>`).kind, "index");
  assert.equal(decodeSitemapBody(gzipSync("<urlset/>")), "<urlset/>");
});

test("pool keeps input order and caps concurrency", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await pool([30, 10, 20, 0], 2, async (ms, i) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await Promise.resolve();
    inFlight--;
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3]);
  assert.equal(peak, 2);
});
