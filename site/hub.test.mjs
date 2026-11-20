// Tests for site/hub.mjs: manifest validation, hub, 404 and project pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadManifest, renderHub, render404, renderProjectPage } from "./hub.mjs";

const RAW = readFileSync(new URL("./projects.json", import.meta.url), "utf8");
const real = () => loadManifest(RAW);
const clone = () => JSON.parse(RAW);

/** Pull every hub card (<a class="hub-card ...">...</a>) out of the hub HTML. */
const cards = (html) => [...html.matchAll(/<a class="hub-card[^"]*" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];

test("loadManifest accepts the real manifest and an object or a JSON string", () => {
  const m = real();
  assert.equal(m.projects.length, 9);
  assert.equal(m.basePath, "/vibe/");
  assert.equal(loadManifest(clone()).projects.length, 9);
});

test("manifest order is the 01-09 numbering", () => {
  assert.deepEqual(
    real().projects.map((p) => p.slug),
    ["teleprompter", "carrd", "bitly", "linktree", "qr", "senja", "tally", "zcal", "myshot"],
  );
});

test("hub renders 9 cards in manifest order; on-site ones link to ./<slug>/, external ones out", () => {
  const html = renderHub(real());
  const cs = cards(html);
  assert.equal(cs.length, 9);
  assert.deepEqual(
    cs.map((c) => c[1]).sort(),
    real().projects.map((p) => p.external?.url ?? `./${p.slug}/`).sort(),
  );
  for (const [, , inner] of cs) assert.doesNotMatch(inner, /<a\b|<button\b/, "nothing interactive inside a card");
});

test("live demo cards say live demo, server cards say needs a server", () => {
  const cs = cards(renderHub(real()));
  const status = cs.map((c) => (/live demo/.test(c[2]) ? "live" : /needs a server/.test(c[2]) ? "srv" : "?"));
  // cards render grouped: live (01, 02, 09) then server apps
  assert.deepEqual(status, ["live", "live", "live", "srv", "srv", "srv", "srv", "srv", "srv"]);
});

test("each card's accessible name is name, status, description", () => {
  const html = renderHub(real());
  assert.match(html, /aria-label="golinks, needs a server, link shortener with click analytics/);
  assert.match(html, /aria-label="teleprompter, live demo, a local, single-page teleprompter/);
});

test("hub groups: live demos (2) then run it yourself (6)", () => {
  const html = renderHub(real());
  const live = html.indexOf(">live demos<");
  const srv = html.indexOf(">run it yourself<");
  assert.ok(live > 0 && srv > live);
  assert.ok(html.indexOf('href="./carrd/"') < srv && html.indexOf('href="./bitly/"') > srv);
});

test("inspired-by shows only when set", () => {
  const cs = cards(renderHub(real()));
  const bySlug = Object.fromEntries(cs.map((c) => [c[1].slice(2, -1), c[2]]));
  assert.match(bySlug.bitly, /inspired by Bitly/);
  assert.match(bySlug.carrd, /inspired by Carrd/);
  assert.doesNotMatch(bySlug.teleprompter, /inspired by/);
  assert.doesNotMatch(bySlug.qr, /inspired by/);
});

test("hub links its favicon relatively and the repo", () => {
  const html = renderHub(real());
  assert.match(html, /<link rel="icon" href="\.\/favicon\.svg"/);
  assert.match(html, /href="https:\/\/github\.com\/alifa20\/vibe"/);
  assert.match(html, /prefers-color-scheme: ?dark/);
  assert.match(html, /prefers-reduced-motion/);
});

test("manifest text is escaped", () => {
  const m = clone();
  m.projects[2].description = 'evil <script>alert("x")</script>';
  m.projects[2].page.features[0].title = "<b>bold</b>";
  const parsed = loadManifest(m);
  const hub = renderHub(parsed);
  assert.doesNotMatch(hub, /<script>alert/);
  assert.match(hub, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  const page = renderProjectPage(parsed, "bitly");
  assert.doesNotMatch(page, /<script>alert/);
  assert.doesNotMatch(page, /<b>bold<\/b>/);
});

test("validation: duplicate slug names the slug", () => {
  const m = clone();
  m.projects[3].slug = "bitly";
  assert.throws(() => loadManifest(m), /bitly/);
});

test("validation: demo without out names the slug", () => {
  const m = clone();
  delete m.projects[1].demo.out;
  assert.throws(() => loadManifest(m), /carrd.*demo\.out|demo\.out.*carrd/);
});

test("validation: both demo and page names the slug", () => {
  const m = clone();
  m.projects[0].page = clone().projects[2].page;
  assert.throws(() => loadManifest(m), /teleprompter/);
});

test("validation: neither demo nor page names the slug", () => {
  const m = clone();
  delete m.projects[7].page;
  assert.throws(() => loadManifest(m), /zcal/);
});

test("validation: bad colour names the slug", () => {
  const m = clone();
  m.projects[4].color = "purple";
  assert.throws(() => loadManifest(m), /qr.*colou?r|colou?r.*qr/);
});

test("validation: missing required field names the slug", () => {
  const m = clone();
  delete m.projects[5].description;
  assert.throws(() => loadManifest(m), /senja.*description/);
});

test("404 uses absolute /vibe/ links and no nav strip", () => {
  const html = render404(real());
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
  const internal = hrefs.filter((h) => !h.startsWith("https://"));
  assert.ok(internal.includes("/vibe/"), "back link is /vibe/");
  assert.ok(internal.includes("/vibe/favicon.svg"));
  for (const h of internal) assert.match(h, /^\/vibe\//, `${h} is absolute under /vibe/`);
  assert.match(html, /← back to vibe/);
  assert.match(html, /404/);
  assert.doesNotMatch(html, /class="vibe-nav"/);
});

test("project page renders features, run commands and the source link", () => {
  const html = renderProjectPage(real(), "zcal");
  for (const t of ["one calendar", "booking links", "visitors see free times only", "booked = written back"]) {
    assert.ok(html.includes(t), t);
  }
  assert.match(html, /npm run bootstrap/);
  assert.match(html, /npm run dev/);
  assert.match(html, /href="https:\/\/github\.com\/alifa20\/vibe\/tree\/main\/zcal"/);
  assert.match(html, /source on github/);
  assert.match(html, /needs a server/);
  assert.match(html, /inspired by Zcal/);
  assert.match(html, /<code>bootstrap<\/code>/);
});

test("project page has the skip link, nav strip and relative links", () => {
  const html = renderProjectPage(real(), "zcal");
  const skip = html.indexOf('class="vibe-skip"');
  const nav = html.indexOf('<nav class="vibe-nav"');
  assert.ok(skip > 0 && nav > skip, "skip link precedes nav");
  assert.match(html, /<link rel="icon" href="\.\.\/favicon\.svg"/);
  assert.match(html, /href="\.\.\/"/);
  assert.match(html, /href="\.\.\/tally\/"/);
  assert.match(html, /aria-current="page"/);
});

test("copy button is hidden without JS; script copies without comment lines", () => {
  const html = renderProjectPage(real(), "zcal");
  assert.match(html, /<button[^>]*class="copy"[^>]*hidden/);
  const cmds = [...html.matchAll(/<span class="cmd">([^<]*)<\/span>/g)].map((x) => x[1]);
  assert.deepEqual(cmds, ["cd zcal", "npm run bootstrap", "npm run dev"]);
  assert.match(html, /querySelectorAll\("\.cmd"\)/);
  assert.match(html, /copied ✓/);
});

test("no screenshot section when the list is empty, one when it isn't", () => {
  const m = real();
  assert.doesNotMatch(renderProjectPage(m, "zcal"), /class="shots"/);
  const withShots = clone();
  withShots.projects[7].page.screenshots = [
    { src: "shots/booking.png", alt: "zcal booking page showing open slots", label: "booking page" },
    { src: "shots/admin.png", alt: "zcal admin calendar", label: "admin calendar" },
  ];
  const html = renderProjectPage(loadManifest(withShots), "zcal");
  assert.match(html, /class="shots"/);
  assert.match(html, /<img src="shots\/booking\.png" alt="zcal booking page showing open slots"/);
  assert.match(html, /screenshot: booking page/);
  assert.match(html, /href="shots\/admin\.png"/);
});

test("project page for a demo or unknown slug throws", () => {
  assert.throws(() => renderProjectPage(real(), "teleprompter"), /teleprompter/);
  assert.throws(() => renderProjectPage(real(), "nope"), /nope/);
});

test("long names get the long-name class for the 64px phone size", () => {
  assert.match(renderProjectPage(real(), "linktree"), /<h1 class="pname long"/);
  assert.match(renderProjectPage(real(), "zcal"), /<h1 class="pname"/);
});

// WCAG relative luminance contrast
const lum = (hex) => {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("every project colour has >= 4.5:1 contrast with #121212", () => {
  for (const p of real().projects) {
    const c = contrast(p.color, "#121212");
    assert.ok(c >= 4.5, `${p.slug} ${p.color} is ${c.toFixed(2)}:1`);
  }
  assert.ok(contrast("#ffd23f", "#121212") >= 4.5, "nav yellow");
});

test("filter bar: hidden until JS, a search box and three status chips with counts", () => {
  const html = renderHub(real());
  const bar = html.match(/<form class="filter"[^>]*>[\s\S]*?<\/form>/)[0];
  assert.match(bar, /^<form class="filter" role="search" aria-label="filter projects" hidden>/);
  assert.match(bar, /<input type="search" name="q"/);
  assert.match(bar, /<span class="vh">search projects<\/span>/, "the input has a label");
  const chips = [...bar.matchAll(/<button type="button" class="chip" data-kind="(\w+)" aria-pressed="(\w+)">[\s\S]*?<span class="n">(\d+)<\/span>/g)];
  assert.deepEqual(chips.map((c) => [c[1], c[2], c[3]]), [["all", "true", "9"], ["live", "false", "3"], ["srv", "false", "6"]]);
  assert.match(bar, /<p class="fcount" aria-live="polite"><\/p>/);
  assert.match(html, /<div class="empty" hidden>/);
});

test("each card carries its kind and lowercase search text", () => {
  const html = renderHub(real());
  const items = [...html.matchAll(/<li data-kind="(live|srv)" data-q="([^"]*)">/g)];
  assert.equal(items.length, 9);
  assert.deepEqual(items.map((i) => i[1]), ["live", "live", "live", "srv", "srv", "srv", "srv", "srv", "srv"]);
  const zcal = items.find((i) => i[2].includes("zcal"))[2];
  assert.equal(zcal, zcal.toLowerCase());
  assert.match(zcal, /needs a server/);
  assert.match(items[0][2], /live demo/);
});

test("filter script runs: terms AND together, chips narrow, empty sections hide", () => {
  const html = renderHub(real());
  const js = html.match(/<script>([^]*?)<\/script>/)[1];
  // Minimal DOM stand-in, just enough for the script.
  const el = (props = {}) => ({ hidden: false, dataset: {}, textContent: "", attrs: {}, listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; }, focus() {}, select() {}, ...props });
  const items = [...html.matchAll(/<li data-kind="(\w+)" data-q="([^"]*)">/g)].map((x) => el({ dataset: { kind: x[1], q: x[2] } }));
  const secItems = { live: items.slice(0, 3), srv: items.slice(3) };
  const cts = { live: el(), srv: el() };
  const secs = ["live", "srv"].map((id) => el({ querySelectorAll: () => secItems[id].filter((i) => !i.hidden), querySelector: () => cts[id] }));
  const input = el({ value: "" });
  const chips = ["all", "live", "srv"].map((k) => el({ dataset: { kind: k } }));
  const out = el(), eq = el(), clear = el();
  const empty = el({ querySelector: (s) => (s === ".eq" ? eq : clear) });
  const form = el({ hidden: true, querySelector: (s) => (s === "input" ? input : out), querySelectorAll: () => chips });
  const doc = { activeElement: null, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; },
    querySelector: (s) => (s === ".filter" ? form : empty), querySelectorAll: (s) => (s === ".grid>li" ? items : secs) };
  const loc = { href: "http://x/vibe/?q=sqlite", search: "?q=sqlite" };
  const urls = [];
  new Function("document", "location", "history", "URL", "URLSearchParams", js)(
    doc, loc, { replaceState: (_s, _t, u) => urls.push(String(u)) }, URL, URLSearchParams);

  assert.equal(form.hidden, false, "JS reveals the bar");
  assert.equal(input.value, "sqlite", "?q= restores the search");
  const shown = () => items.filter((i) => !i.hidden).map((i) => i.dataset.q.split(" ")[0]);
  assert.ok(shown().length > 0 && shown().every((n) => /qrforge|senja|zcal|forms|golinks|linkinbio/.test(n)));
  assert.equal(secs[0].hidden, true, "live demos section hides when none match");
  assert.equal(cts.srv.textContent, shown().length);

  input.value = "  PROMPTER  "; input.listeners.input();
  assert.deepEqual(shown(), ["teleprompter"]);
  assert.equal(out.textContent, "showing 1 of 9");
  assert.equal(secs[1].hidden, true);

  input.value = ""; chips[2].listeners.click();
  assert.equal(shown().length, 6);
  assert.equal(chips[2].attrs["aria-pressed"], "true");
  assert.equal(chips[0].attrs["aria-pressed"], "false");
  assert.match(urls.at(-1), /\?show=srv$/);

  input.value = "zzz nothing"; input.listeners.input();
  assert.equal(shown().length, 0);
  assert.equal(empty.hidden, false);
  assert.equal(eq.textContent, "“zzz nothing”");

  clear.listeners.click();
  assert.equal(shown().length, 9);
  assert.equal(out.textContent, "all 9 projects");
  assert.equal(empty.hidden, true);
  assert.equal(urls.at(-1), "http://x/vibe/");
});

test("external project: card links out, says own repo, sits under live demos; no project page", () => {
  const html = renderHub(real());
  const card = cards(html).find((c) => c[1] === "https://alifa20.github.io/myshot/");
  assert.ok(card, "myshot card links to its own site");
  assert.match(card[2], /live demo/);
  assert.match(card[2], /own repo ↗/);
  assert.match(html, /aria-label="myshot, live demo, in its own repo, screenshot beautifier/);
  const srv = html.indexOf(">run it yourself<");
  assert.ok(html.indexOf("alifa20.github.io/myshot/") < srv, "listed with the live demos");
  assert.match(html, /nine things I built with AI/);
  assert.throws(() => renderProjectPage(real(), "myshot"));
});

test("validation: external needs an https url, and only one kind per project", () => {
  const ext = (external, extra = {}) => {
    const j = clone();
    Object.assign(j.projects.find((p) => p.slug === "myshot"), { external, ...extra });
    return () => loadManifest(j);
  };
  assert.throws(ext({ url: "http://x.test/" }), /myshot.*https/);
  assert.throws(ext({}), /myshot.*https/);
  assert.throws(ext({ url: "https://x.test/" }, { demo: { build: "x", out: "y" } }), /myshot.*exactly one of demo, page or external/);
});
