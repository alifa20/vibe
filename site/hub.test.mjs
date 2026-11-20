// Tests for site/hub.mjs: manifest validation, hub, 404 and project pages.
// Counts, orders and group sizes are derived from site/projects.json, so adding a
// project is a manifest-only change (KTD1). Count-sensitive tests also run against a
// copy of the manifest with an extra fake project, to prove they hold for any size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadManifest, renderHub, render404, renderProjectPage } from "./hub.mjs";

const RAW = readFileSync(new URL("./projects.json", import.meta.url), "utf8");
const real = () => loadManifest(RAW);
const clone = () => JSON.parse(RAW);
const bySlug = (m, slug) => m.projects.find((p) => p.slug === slug);

/** Pull every hub card (<a class="hub-card ...">...</a>) out of the hub HTML. */
const cards = (html) => [...html.matchAll(/<a class="hub-card[^"]*" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];

// The spelled-out numbers the hub lede uses ("nine things I built with AI").
const SPELLED = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

// What the hub should show for a manifest: demo and external projects are live, page ones need a server.
const isLive = (p) => Boolean(p.demo || p.external);
const kindOf = (p) => (isLive(p) ? "live" : "srv");
const hrefOf = (p) => p.external?.url ?? `./${p.slug}/`;
const facts = (m) => {
  const live = m.projects.filter(isLive);
  const srv = m.projects.filter((p) => !isLive(p));
  return { total: m.projects.length, live, srv, order: [...live, ...srv] };
};

/** A copy of the real manifest with `n` extra fake `page` projects appended. */
const withExtraPages = (n = 1) => {
  const j = clone();
  const template = j.projects.find((p) => p.page);
  for (let k = 1; k <= n; k++) {
    const p = { ...structuredClone(template), slug: `fake-page-${k}`, name: `fakepage${k}`, description: `fake page project ${k}.`, color: "#ffd23f" };
    delete p.inspiredBy;
    j.projects.push(p);
  }
  return loadManifest(j);
};

const MANIFESTS = [
  ["real manifest", real],
  ["manifest plus a fake page project", () => withExtraPages(1)],
];

test("loadManifest accepts the real manifest and an object or a JSON string", () => {
  const m = real();
  assert.equal(m.projects.length, clone().projects.length);
  assert.ok(m.projects.length > 0);
  assert.equal(m.basePath, "/vibe/");
  assert.equal(loadManifest(clone()).projects.length, m.projects.length);
});

test("loadManifest keeps manifest order", () => {
  assert.deepEqual(real().projects.map((p) => p.slug), clone().projects.map((p) => p.slug));
});

for (const [label, load] of MANIFESTS) {
  test(`${label}: hub renders one card per project, live ones first, each group in manifest order`, () => {
    const m = load();
    const { total, order } = facts(m);
    const cs = cards(renderHub(m));
    assert.equal(cs.length, total);
    assert.deepEqual(cs.map((c) => c[1]), order.map(hrefOf), "on-site cards link to ./<slug>/, external ones out");
    for (const [, , inner] of cs) assert.doesNotMatch(inner, /<a\b|<button\b/, "nothing interactive inside a card");
    // Card numbers are the 01..NN position in the manifest, whatever group a card sits in.
    const nums = cs.map((c) => c[2].match(/<span class="num"[^>]*>(\d+)<\/span>/)[1]);
    assert.deepEqual(nums, order.map((p) => String(m.projects.indexOf(p) + 1).padStart(2, "0")));
  });

  test(`${label}: live demo cards say live demo, server cards say needs a server`, () => {
    const m = load();
    const cs = cards(renderHub(m));
    const status = cs.map((c) => (/live demo/.test(c[2]) ? "live" : /needs a server/.test(c[2]) ? "srv" : "?"));
    assert.deepEqual(status, facts(m).order.map(kindOf));
    const firstSrv = status.indexOf("srv");
    if (firstSrv >= 0) assert.ok(!status.slice(firstSrv).includes("live"), "every live card comes before every server card");
  });

  test(`${label}: hub groups live demos then run it yourself, each card in its group`, () => {
    const m = load();
    const { live, srv } = facts(m);
    const html = renderHub(m);
    const liveAt = html.indexOf(">live demos<");
    const srvAt = html.indexOf(">run it yourself<");
    assert.ok(liveAt > 0 && srvAt > liveAt);
    for (const p of live) assert.ok(html.indexOf(`href="${hrefOf(p)}"`) > liveAt && html.indexOf(`href="${hrefOf(p)}"`) < srvAt, `${p.slug} under live demos`);
    for (const p of srv) assert.ok(html.indexOf(`href="${hrefOf(p)}"`) > srvAt, `${p.slug} under run it yourself`);
    const cts = [...html.matchAll(/<span class="ct" aria-hidden="true">(\d+)<\/span>/g)].map((x) => Number(x[1]));
    assert.deepEqual(cts, [live.length, srv.length], "section counts match their groups");
  });

  test(`${label}: the lede, title and description spell out the project count`, () => {
    const m = load();
    const { total, live, srv } = facts(m);
    const html = renderHub(m);
    assert.match(html, new RegExp(`<p class="lede"><span class="dash">—</span> ${SPELLED[total]} things I built with AI\\.</p>`));
    assert.match(html, new RegExp(`<title>vibe — ${SPELLED[total]} things I built with AI</title>`));
    assert.match(html, new RegExp(`${SPELLED[live.length]} run right in your browser; ${SPELLED[srv.length]} need a server`));
  });
}

test("fourteen projects read as fourteen in the lede", () => {
  const grown = withExtraPages(Math.max(0, 14 - clone().projects.length));
  const m = loadManifest({ ...grown, projects: grown.projects.slice(0, 14) });
  assert.equal(m.projects.length, 14);
  assert.match(renderHub(m), /fourteen things I built with AI/);
});

test("each card's accessible name is name, status, description", () => {
  const html = renderHub(real());
  assert.match(html, /aria-label="golinks, needs a server, link shortener with click analytics/);
  assert.match(html, /aria-label="teleprompter, live demo, a local, single-page teleprompter/);
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
  bySlug(m, "bitly").description = 'evil <script>alert("x")</script>';
  bySlug(m, "bitly").page.features[0].title = "<b>bold</b>";
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
  bySlug(m, "linktree").slug = "bitly";
  assert.throws(() => loadManifest(m), /bitly/);
});

test("validation: demo without out names the slug", () => {
  const m = clone();
  delete bySlug(m, "carrd").demo.out;
  assert.throws(() => loadManifest(m), /carrd.*demo\.out|demo\.out.*carrd/);
});

test("validation: both demo and page names the slug", () => {
  const m = clone();
  bySlug(m, "teleprompter").page = bySlug(clone(), "bitly").page;
  assert.throws(() => loadManifest(m), /teleprompter/);
});

test("validation: neither demo nor page names the slug", () => {
  const m = clone();
  delete bySlug(m, "zcal").page;
  assert.throws(() => loadManifest(m), /zcal/);
});

test("validation: bad colour names the slug", () => {
  const m = clone();
  bySlug(m, "qr").color = "purple";
  assert.throws(() => loadManifest(m), /qr.*colou?r|colou?r.*qr/);
});

test("validation: missing required field names the slug", () => {
  const m = clone();
  delete bySlug(m, "senja").description;
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
  assert.match(html, /pnpm bootstrap/);
  assert.match(html, /pnpm dev/);
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
  assert.deepEqual(cmds, ["cd zcal", "pnpm bootstrap", "pnpm dev"]);
  assert.match(html, /querySelectorAll\("\.cmd"\)/);
  assert.match(html, /copied ✓/);
});

test("no screenshot section when the list is empty, one when it isn't", () => {
  const m = real();
  assert.doesNotMatch(renderProjectPage(m, "zcal"), /class="shots"/);
  const withShots = clone();
  bySlug(withShots, "zcal").page.screenshots = [
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

for (const [label, load] of MANIFESTS) {
  test(`${label}: filter bar is hidden until JS, has a search box and three status chips with counts`, () => {
    const m = load();
    const { total, live, srv } = facts(m);
    const html = renderHub(m);
    const bar = html.match(/<form class="filter"[^>]*>[\s\S]*?<\/form>/)[0];
    assert.match(bar, /^<form class="filter" role="search" aria-label="filter projects" hidden>/);
    assert.match(bar, /<input type="search" name="q"/);
    assert.match(bar, /<span class="vh">search projects<\/span>/, "the input has a label");
    const chips = [...bar.matchAll(/<button type="button" class="chip" data-kind="(\w+)" aria-pressed="(\w+)">[\s\S]*?<span class="n">(\d+)<\/span>/g)];
    assert.deepEqual(chips.map((c) => [c[1], c[2], c[3]]), [
      ["all", "true", String(total)],
      ["live", "false", String(live.length)],
      ["srv", "false", String(srv.length)],
    ]);
    // Chip counts match the groups the hub actually renders.
    const items = [...html.matchAll(/<li data-kind="(live|srv)"/g)].map((x) => x[1]);
    assert.equal(Number(chips[0][3]), items.length);
    assert.equal(Number(chips[1][3]), items.filter((k) => k === "live").length);
    assert.equal(Number(chips[2][3]), items.filter((k) => k === "srv").length);
    assert.match(bar, /<p class="fcount" aria-live="polite"><\/p>/);
    assert.match(html, /<div class="empty" hidden>/);
  });

  test(`${label}: each card carries its kind and lowercase search text`, () => {
    const m = load();
    const html = renderHub(m);
    const items = [...html.matchAll(/<li data-kind="(live|srv)" data-q="([^"]*)">/g)];
    assert.equal(items.length, m.projects.length);
    assert.deepEqual(items.map((i) => i[1]), facts(m).order.map(kindOf));
    const zcal = items.find((i) => i[2].includes("zcal"))[2];
    assert.equal(zcal, zcal.toLowerCase());
    assert.match(zcal, /needs a server/);
    assert.match(items[0][2], /live demo/);
  });

  test(`${label}: filter script runs: terms AND together, chips narrow, empty sections hide`, () => {
    const m = load();
    const { total, live, srv } = facts(m);
    const html = renderHub(m);
    const js = html.match(/<script>([^]*?)<\/script>/)[1];
    // Minimal DOM stand-in, just enough for the script.
    const el = (props = {}) => ({ hidden: false, dataset: {}, textContent: "", attrs: {}, listeners: {},
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; }, focus() {}, select() {}, ...props });
    const items = [...html.matchAll(/<li data-kind="(\w+)" data-q="([^"]*)">/g)].map((x) => el({ dataset: { kind: x[1], q: x[2] } }));
    const secItems = { live: items.slice(0, live.length), srv: items.slice(live.length) };
    assert.equal(secItems.srv.length, srv.length);
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

    // What a search should match, worked out from the rendered search text.
    const matching = (term, list = items) => list.filter((i) => i.dataset.q.includes(term));
    const shownItems = () => items.filter((i) => !i.hidden);
    const shown = () => shownItems().map((i) => i.dataset.q.split(" ")[0]);

    assert.equal(form.hidden, false, "JS reveals the bar");
    assert.equal(input.value, "sqlite", "?q= restores the search");
    assert.ok(matching("sqlite").length > 0, "some project mentions sqlite");
    assert.deepEqual(shownItems(), matching("sqlite"));
    assert.equal(secs[0].hidden, matching("sqlite", secItems.live).length === 0, "live demos section hides when none match");
    assert.equal(cts.srv.textContent, matching("sqlite", secItems.srv).length);

    input.value = "  PROMPTER  "; input.listeners.input();
    assert.ok(shown().includes("teleprompter"));
    assert.deepEqual(shownItems(), matching("prompter"));
    assert.equal(out.textContent, `showing ${matching("prompter").length} of ${total}`);
    assert.equal(secs[1].hidden, matching("prompter", secItems.srv).length === 0);

    input.value = ""; chips[2].listeners.click();
    assert.equal(shown().length, srv.length);
    assert.ok(shownItems().every((i) => i.dataset.kind === "srv"));
    assert.equal(chips[2].attrs["aria-pressed"], "true");
    assert.equal(chips[0].attrs["aria-pressed"], "false");
    assert.match(urls.at(-1), /\?show=srv$/);

    input.value = "zzz nothing"; input.listeners.input();
    assert.equal(shown().length, 0);
    assert.equal(empty.hidden, false);
    assert.equal(eq.textContent, "“zzz nothing”");

    clear.listeners.click();
    assert.equal(shown().length, total);
    assert.equal(out.textContent, `all ${total} projects`);
    assert.equal(empty.hidden, true);
    assert.equal(urls.at(-1), "http://x/vibe/");
  });
}

test("external project: card links out, says own repo, sits under live demos; no project page", () => {
  const html = renderHub(real());
  const card = cards(html).find((c) => c[1] === "https://alifa20.github.io/myshot/");
  assert.ok(card, "myshot card links to its own site");
  assert.match(card[2], /live demo/);
  assert.match(card[2], /own repo ↗/);
  assert.match(html, /aria-label="myshot, live demo, in its own repo, screenshot beautifier/);
  const srv = html.indexOf(">run it yourself<");
  assert.ok(html.indexOf("alifa20.github.io/myshot/") < srv, "listed with the live demos");
  assert.match(html, new RegExp(`${SPELLED[real().projects.length]} things I built with AI`));
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
