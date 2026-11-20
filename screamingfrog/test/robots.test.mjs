import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRobots, robotsFor, productToken } from "../src/robots.mjs";

// The example file from RFC 9309 section 5.1.
const RFC_EXAMPLE = `User-Agent: *
Disallow: *.gif$
Disallow: /example/
Allow: /publications/

User-Agent: foobot
Disallow:/
Allow:/example/page.html
Allow:/example/allowed.gif

User-Agent: barbot
User-Agent: bazbot
Disallow: /example/page.html

User-Agent: quxbot

EOF
`;

const ok = (body, ua = "sitecrawl/1.0") => robotsFor({ status: 200, body }, ua);

test("productToken takes the name before the version", () => {
  assert.equal(productToken("sitecrawl/1.0 (+https://example.com)"), "sitecrawl");
  assert.equal(productToken("FooBot"), "foobot");
});

test("parseRobots groups consecutive user-agent lines and collects sitemaps", () => {
  const r = parseRobots(RFC_EXAMPLE + "\nSitemap: https://example.com/sitemap.xml\n");
  assert.equal(r.groups.length, 4);
  assert.deepEqual(r.groups[2].agents, ["barbot", "bazbot"]);
  assert.deepEqual(r.sitemaps, ["https://example.com/sitemap.xml"]);
});

test("RFC example: the * group applies to an unnamed crawler", () => {
  const r = ok(RFC_EXAMPLE);
  assert.equal(r.isAllowed("/example/page.html"), false);
  assert.equal(r.isAllowed("/publications/x"), true);
  assert.equal(r.isAllowed("/images/cat.gif"), false);
  assert.equal(r.isAllowed("/images/cat.gif?x=1"), true, "$ anchors the end of the path+query");
  assert.equal(r.isAllowed("/"), true);
});

test("RFC example: foobot gets its own group, longest match wins", () => {
  const r = ok(RFC_EXAMPLE, "FooBot/2.1");
  assert.equal(r.isAllowed("/"), false);
  assert.equal(r.isAllowed("/example/page.html"), true);
  assert.equal(r.isAllowed("/example/allowed.gif"), true);
  assert.equal(r.isAllowed("/example/other.html"), false);
});

test("RFC example: barbot and bazbot share a group", () => {
  assert.equal(ok(RFC_EXAMPLE, "barbot").isAllowed("/example/page.html"), false);
  assert.equal(ok(RFC_EXAMPLE, "bazbot").isAllowed("/example/page.html"), false);
  assert.equal(ok(RFC_EXAMPLE, "bazbot").isAllowed("/example/"), true, "the * group no longer applies");
});

test("RFC example: quxbot has an empty group and may crawl everything", () => {
  assert.equal(ok(RFC_EXAMPLE, "quxbot").isAllowed("/example/page.html"), true);
});

test("Disallow: /private with Allow: /private/ok", () => {
  const r = ok("User-agent: *\nDisallow: /private\nAllow: /private/ok\n");
  assert.equal(r.isAllowed("/private/ok/x"), true);
  assert.equal(r.isAllowed("/private/y"), false);
  assert.equal(r.isAllowed("/privateer"), false, "rules are prefixes");
  assert.equal(r.isAllowed("/public"), true);
});

test("a tie between Allow and Disallow resolves to Allow", () => {
  const r = ok("User-agent: *\nDisallow: /page\nAllow: /page\n");
  assert.equal(r.isAllowed("/page"), true);
  const r2 = ok("User-agent: *\nAllow: /folder/\nDisallow: /folder/\n");
  assert.equal(r2.isAllowed("/folder/x"), true);
});

test("* matches any run of characters and $ anchors the end", () => {
  const r = ok("User-agent: *\nDisallow: /*.php$\nDisallow: /fish*.html\nDisallow: /exact$\n");
  assert.equal(r.isAllowed("/index.php"), false);
  assert.equal(r.isAllowed("/dir/index.php"), false);
  assert.equal(r.isAllowed("/index.php?q=1"), true);
  assert.equal(r.isAllowed("/index.php5"), true);
  assert.equal(r.isAllowed("/fishheads/catfish.html"), false);
  assert.equal(r.isAllowed("/fish.htm"), true);
  assert.equal(r.isAllowed("/exact"), false);
  assert.equal(r.isAllowed("/exact/more"), true);
});

test("an empty Disallow allows everything", () => {
  assert.equal(ok("User-agent: *\nDisallow:\n").isAllowed("/anything"), true);
});

test("user-agent and directive names are case-insensitive, comments are stripped", () => {
  const r = ok("USER-AGENT: SiteCrawl # us\nDISALLOW: /secret # hidden\n", "sitecrawl/1.0");
  assert.equal(r.isAllowed("/secret/x"), false);
  assert.equal(r.isAllowed("/open"), true);
});

test("percent-encoded and literal characters compare equal", () => {
  const r = ok("User-agent: *\nDisallow: /foo/%62ar\n");
  assert.equal(r.isAllowed("/foo/bar"), false);
  const r2 = ok("User-agent: *\nDisallow: /a%3cd\n");
  assert.equal(r2.isAllowed("/a%3Cd"), false);
});

test("/robots.txt itself is always allowed", () => {
  assert.equal(ok("User-agent: *\nDisallow: /\n").isAllowed("/robots.txt"), true);
});

test("a robots.txt 404 allows everything", () => {
  const r = robotsFor({ status: 404, body: "User-agent: *\nDisallow: /\n" }, "sitecrawl");
  assert.equal(r.isAllowed("/"), true);
  assert.equal(r.isAllowed("/private"), true);
});

test("a robots.txt 503 blocks everything", () => {
  const r = robotsFor({ status: 503, body: "" }, "sitecrawl");
  assert.equal(r.isAllowed("/"), false);
  assert.equal(r.isAllowed("/about"), false);
});

test("an unreachable robots.txt (network error) blocks everything", () => {
  assert.equal(robotsFor({ status: 0, body: "" }, "sitecrawl").isAllowed("/"), false);
});
