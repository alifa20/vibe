import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { renderReport, relabel } from "../src/report.mjs";
import { audit } from "../src/audit.mjs";

const O = "http://site.test";
const page = (path, extra = {}) => ({
  url: O + path,
  depth: 1,
  status: 200,
  error: null,
  blockedByRobots: false,
  redirects: [],
  redirectLoop: false,
  finalUrl: O + path,
  finalStatus: 200,
  contentType: "text/html",
  size: 1234,
  timeMs: 12,
  title: `Page ${path}`,
  metaDescription: `About ${path}`,
  h1s: ["Hi"],
  canonical: null,
  noindex: false,
  imagesMissingAlt: [],
  links: [],
  ...extra,
});

const result = (pages, extra = {}) => ({
  startUrl: O + "/",
  origin: O,
  userAgent: "sitecrawl/1.0",
  limits: { maxPages: 10000, maxDepth: Infinity, maxBodySize: 5242880 },
  robots: { status: 200, note: "" },
  sitemaps: { files: [], urls: [] },
  pages,
  external: [],
  ...extra,
});

const build = (r, opts) => renderReport(r, audit(r), opts);

// Same rules as site/check-csp.mjs, restated here so this folder stays standalone.
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("base64");
const decode = (s) => s.replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
function cspProblems(html) {
  const meta = /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=(["'])([^]*?)\1/i.exec(html);
  if (!meta) return ["no CSP meta"];
  const csp = decode(meta[2]);
  const directive = (name) => {
    const found = csp.split(";").map((d) => d.trim()).find((d) => d.split(/\s+/)[0] === name);
    return found ? found.split(/\s+/).slice(1) : null;
  };
  const sources = {
    style: directive("style-src") ?? directive("default-src") ?? [],
    script: directive("script-src") ?? directive("default-src") ?? [],
  };
  const problems = [];
  for (const [, tag, attrs, body] of html.matchAll(/<(style|script)\b([^>]*)>([^]*?)<\/\1>/gi)) {
    const kind = tag.toLowerCase();
    if (kind === "script" && /\bsrc\s*=/i.test(attrs)) continue;
    if (!sources[kind].includes(`'sha256-${sha256(body)}'`)) problems.push(`inline <${kind}> not allowed`);
  }
  return problems;
}

test("a hostile title renders as escaped text", () => {
  const html = build(result([page("/", { title: "<script>alert(1)</script>", metaDescription: `"><img src=x onerror=alert(2)>` })]));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!/<img\b/i.test(html));
  assert.ok(!/<script\b/i.test(html), "the report has no script at all");
});

test("crawled URLs are escaped inside attributes", () => {
  const html = build(result([page(`/q?a="b"&c=<d>`)]));
  assert.ok(html.includes(`href="${O}/q?a=&quot;b&quot;&amp;c=&lt;d&gt;"`));
});

test("no style attributes, and no src or href outside the crawled URLs and in-page anchors", () => {
  const r = result(
    [page("/", { links: ["https://other.test/x", O + "/gone"] }), page("/gone", { status: 404, title: undefined })],
    { external: [{ url: "https://other.test/x", status: 500, finalStatus: 500, redirects: [], error: null }] },
  );
  const html = build(r);
  assert.ok(!/\sstyle\s*=/i.test(html));
  const allowed = new Set([...r.pages.map((p) => p.url), ...r.external.map((e) => e.url)]);
  const refs = [...html.matchAll(/\s(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => decode(m[1]));
  assert.ok(refs.length > 0);
  for (const ref of refs) assert.ok(ref.startsWith("#") || allowed.has(ref), `unexpected reference ${ref}`);
  assert.ok(!/\ssrc\s*=/i.test(html), "nothing is loaded");
});

test("the inline style hash matches the meta CSP", () => {
  const html = build(result([page("/")]));
  assert.deepEqual(cspProblems(html), []);
  assert.equal((html.match(/<style\b/g) || []).length, 1);
  assert.match(decode(html), /default-src 'none'; img-src 'self'; style-src 'sha256-/);
});

test("the head closes right before <body>, so the hub can add its nav strip", () => {
  assert.match(build(result([page("/")])), /<\/head>\s*<body\b/);
});

test("summary, issues grouped by type with counts and anchors, and pages sorted by status", () => {
  const r = result([
    page("/", { links: [O + "/gone", O + "/moved"] }),
    page("/gone", { status: 404, title: undefined }),
    page("/a", { title: "Same" }),
    page("/b", { title: "Same" }),
    page("/moved", { status: 301, title: undefined, redirects: [{ url: O + "/moved", status: 301, location: O + "/a" }], finalUrl: O + "/a" }),
  ]);
  const html = build(r);
  assert.match(html, /<a href="#issue-broken-internal-link">/);
  assert.match(html, /<section[^>]*id="issue-broken-internal-link"/);
  assert.match(html, /<section[^>]*id="issue-duplicate-title"/);
  assert.match(html, /id="pages"/);
  const table = html.slice(html.indexOf('id="pages"'));
  const order = [...table.matchAll(/<td class="status[^"]*">(\d+)</g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.deepEqual(order, [200, 200, 200, 301, 404]);
});

test("linkUrls: false shows URLs as text with no href", () => {
  const html = build(result([page("/")]), { linkUrls: false });
  assert.ok(![...html.matchAll(/\shref="([^"]*)"/g)].some((m) => !m[1].startsWith("#")));
});

test("the report is the same for the same input", () => {
  const r = result([page("/b"), page("/a")]);
  assert.equal(build(r), build(structuredClone(r)));
});

test("relabel swaps origins everywhere in the result", () => {
  const r = result([page("/", { links: ["http://127.0.0.1:5000/x"] })]);
  const out = relabel(r, { [O]: "https://bakery.example", "http://127.0.0.1:5000": "https://elsewhere.example" });
  assert.equal(out.startUrl, "https://bakery.example/");
  assert.deepEqual(out.pages[0].links, ["https://elsewhere.example/x"]);
  assert.equal(r.startUrl, O + "/", "the input is not changed");
});
