import { test } from "node:test";
import assert from "node:assert/strict";
import { audit, ISSUE_TYPES } from "../src/audit.mjs";

const O = "http://site.test";

/** A healthy, parsed HTML page; override what the test is about. */
const ok = (path, extra = {}) => ({
  url: O + path,
  depth: 1,
  status: 200,
  error: null,
  blockedByRobots: false,
  redirects: [],
  redirectLoop: false,
  finalUrl: O + path,
  finalStatus: 200,
  title: `Page ${path}`,
  metaDescription: `About ${path}`,
  h1s: [`Heading ${path}`],
  canonical: null,
  noindex: false,
  imagesMissingAlt: [],
  links: [],
  ...extra,
});

const run = (pages, { external = [], sitemapUrls = [] } = {}) =>
  audit({ origin: O, startUrl: O + "/", pages, external, sitemaps: { files: [], urls: sitemapUrls } });

const ofType = (issues, type) => issues.filter((i) => i.type === type);

test("a clean site has no issues", () => {
  assert.deepEqual(run([ok("/"), ok("/a")]), []);
});

test("every issue carries a known type and that type's severity", () => {
  const issues = run([ok("/", { title: null, h1s: [] })]);
  assert.ok(issues.length);
  for (const i of issues) {
    assert.ok(ISSUE_TYPES[i.type], i.type);
    assert.equal(i.severity, ISSUE_TYPES[i.type].severity);
  }
});

test("two pages with the same title produce one duplicate-title issue listing both URLs", () => {
  const issues = ofType(run([ok("/a", { title: "Same" }), ok("/b", { title: "Same" }), ok("/c")]), "duplicate-title");
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].urls, [O + "/a", O + "/b"]);
  assert.equal(issues[0].detail, "Same");
});

test("duplicate meta descriptions are grouped the same way", () => {
  const issues = ofType(run([ok("/a", { metaDescription: "D" }), ok("/b", { metaDescription: "D" })]), "duplicate-meta-description");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].urls.length, 2);
});

test("a 71-character title is too long and a 60-character title is not", () => {
  const issues = run([ok("/long", { title: "x".repeat(71) }), ok("/fine", { title: "y".repeat(60) })]);
  assert.deepEqual(ofType(issues, "title-too-long").map((i) => i.url), [O + "/long"]);
});

test("missing titles, descriptions and H1s, and multiple H1s", () => {
  const issues = run([
    ok("/no-title", { title: null }),
    ok("/empty-title", { title: "" }),
    ok("/no-desc", { metaDescription: null }),
    ok("/long-desc", { metaDescription: "z".repeat(156) }),
    ok("/no-h1", { h1s: [] }),
    ok("/two-h1", { h1s: ["A", "B"] }),
  ]);
  assert.deepEqual(ofType(issues, "missing-title").map((i) => i.url), [O + "/empty-title", O + "/no-title"]);
  assert.deepEqual(ofType(issues, "missing-meta-description").map((i) => i.url), [O + "/no-desc"]);
  assert.deepEqual(ofType(issues, "meta-description-too-long").map((i) => i.url), [O + "/long-desc"]);
  assert.deepEqual(ofType(issues, "missing-h1").map((i) => i.url), [O + "/no-h1"]);
  assert.deepEqual(ofType(issues, "multiple-h1").map((i) => i.url), [O + "/two-h1"]);
});

test("pages that were not parsed (errors, redirects) skip the content checks", () => {
  const notParsed = { url: O + "/x", depth: 1, status: 404, redirects: [], links: [] };
  assert.deepEqual(ofType(run([notParsed]), "missing-title"), []);
});

test("a broken internal link lists the pages that link to it", () => {
  const issues = run([ok("/", { links: [O + "/gone", O + "/a"] }), ok("/a", { links: [O + "/gone"] }), { ...ok("/gone"), status: 404, title: undefined }]);
  const broken = ofType(issues, "broken-internal-link");
  assert.equal(broken.length, 1);
  assert.equal(broken[0].url, O + "/gone");
  assert.equal(broken[0].detail, "404");
  assert.deepEqual(broken[0].sources, [O + "/", O + "/a"]);
});

test("an error page reached only through a canonical is not a broken link", () => {
  const issues = run([ok("/", { canonical: O + "/gone" }), { ...ok("/gone"), status: 404, title: undefined }]);
  assert.deepEqual(ofType(issues, "broken-internal-link"), []);
  assert.equal(ofType(issues, "canonical-to-error").length, 1);
});

test("a broken external link, including a connection failure", () => {
  const issues = run([ok("/", { links: ["http://other.test/x", "http://down.test/"] })], {
    external: [
      { url: "http://other.test/x", status: 410, redirects: [], error: null },
      { url: "http://down.test/", status: 0, redirects: [], error: "ECONNREFUSED" },
      { url: "http://fine.test/", status: 200, redirects: [], error: null },
    ],
  });
  const broken = ofType(issues, "broken-external-link");
  assert.deepEqual(broken.map((i) => [i.url, i.detail]), [["http://down.test/", "ECONNREFUSED"], ["http://other.test/x", "410"]]);
  assert.deepEqual(broken[0].sources, [O + "/"]);
});

test("redirect chains of two or more hops, and redirect loops", () => {
  const hop = (from, to, status = 301) => ({ url: O + from, status, location: O + to });
  const issues = run([
    { ...ok("/one"), status: 301, title: undefined, redirects: [hop("/one", "/a")], finalUrl: O + "/a" },
    { ...ok("/chain"), status: 301, title: undefined, redirects: [hop("/chain", "/b"), hop("/b", "/a")], finalUrl: O + "/a" },
    { ...ok("/loop"), status: 302, title: undefined, redirects: [hop("/loop", "/l2", 302), hop("/l2", "/loop", 302)], redirectLoop: true, finalUrl: null },
    ok("/a"),
  ]);
  assert.deepEqual(ofType(issues, "redirect-chain").map((i) => i.url), [O + "/chain"]);
  assert.match(ofType(issues, "redirect-chain")[0].detail, /2 hops/);
  assert.deepEqual(ofType(issues, "redirect-loop").map((i) => i.url), [O + "/loop"]);
});

test("canonicals pointing at a redirect, a 404 page or a noindex page are flagged", () => {
  const issues = run([
    ok("/c-redirect", { canonical: O + "/moved" }),
    { ...ok("/moved"), status: 301, title: undefined, redirects: [{ url: O + "/moved", status: 301, location: O + "/a" }], finalUrl: O + "/a" },
    ok("/c-404", { canonical: O + "/gone" }),
    { ...ok("/gone"), status: 404, title: undefined },
    ok("/c-noindex", { canonical: O + "/hidden" }),
    ok("/hidden", { noindex: true }),
    ok("/self", { canonical: O + "/self", noindex: true }),
    ok("/a", { canonical: O + "/a" }),
  ]);
  assert.deepEqual(ofType(issues, "canonical-to-redirect").map((i) => i.url), [O + "/c-redirect"]);
  assert.deepEqual(ofType(issues, "canonical-to-error").map((i) => i.url), [O + "/c-404"]);
  assert.deepEqual(ofType(issues, "canonical-to-noindex").map((i) => i.url), [O + "/c-noindex"]);
  assert.equal(ofType(issues, "canonical-to-error")[0].detail, `${O}/gone (404)`);
});

test("noindex pages are listed", () => {
  assert.deepEqual(ofType(run([ok("/", { noindex: true })]), "noindex").map((i) => i.url), [O + "/"]);
});

test("a URL in the sitemap but never linked is reported as orphaned", () => {
  const issues = run([ok("/")], { sitemapUrls: [O + "/", O + "/orphan"] });
  assert.deepEqual(ofType(issues, "sitemap-orphan").map((i) => i.url), [O + "/orphan"]);
});

test("sitemap URLs that were crawled but are not indexable are flagged", () => {
  const issues = run(
    [ok("/"), ok("/hidden", { noindex: true }), { ...ok("/gone"), status: 404, title: undefined }, ok("/canon", { canonical: O + "/" }), { url: O + "/blocked", blockedByRobots: true, status: null, redirects: [], links: [] }],
    { sitemapUrls: [O + "/", O + "/hidden", O + "/gone", O + "/canon", O + "/blocked"] },
  );
  assert.deepEqual(
    ofType(issues, "sitemap-non-indexable").map((i) => [i.url, i.detail]),
    [[O + "/blocked", "blocked by robots.txt"], [O + "/canon", `canonicalised to ${O}/`], [O + "/gone", "status 404"], [O + "/hidden", "noindex"]],
  );
});

test("images without alt text are listed per page", () => {
  const issues = ofType(run([ok("/", { imagesMissingAlt: ["/a.jpg", "/b.jpg"] })]), "image-missing-alt");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].detail, "2 images: /a.jpg, /b.jpg");
});

test("issues come out in a stable order: by type, then URL", () => {
  const pages = [ok("/b", { title: null }), ok("/a", { title: null, h1s: [] })];
  const forward = run(pages);
  const backward = run([...pages].reverse());
  assert.deepEqual(forward, backward);
  const order = Object.keys(ISSUE_TYPES);
  const idx = forward.map((i) => order.indexOf(i.type));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
});
