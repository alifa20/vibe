// Tests for site/nav.mjs: nav markup, style, injection, CSP patch, icon link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadManifest } from "./hub.mjs";
import { navStyle, renderNav, injectNav, patchCsp, styleHash, ensureIconLink } from "./nav.mjs";

const m = loadManifest(readFileSync(new URL("./projects.json", import.meta.url), "utf8"));
const b64sha = (s) => createHash("sha256").update(s, "utf8").digest("base64");

// The strip covers on-site projects only (demo and page), in manifest order; external ones are left out.
const onSite = (man) => man.projects.filter((p) => !p.external);
const reRaw = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stepRe = (dir, p) => new RegExp(`<a class="vibe-step vibe-${dir}" href="\\.\\./${reRaw(p.slug)}/" aria-label="${dir === "prev" ? "previous" : "next"}: ${reRaw(p.name)}">`);

/** A copy of the real manifest with one fake `page` and one fake `demo` project appended. */
const grown = () => {
  const j = JSON.parse(readFileSync(new URL("./projects.json", import.meta.url), "utf8"));
  const page = structuredClone(j.projects.find((p) => p.page));
  j.projects.push({ ...page, slug: "fake-page", name: "fakepage", color: "#ffd23f" });
  j.projects.push({ slug: "fake-demo", name: "fakedemo", description: "a fake demo.", stack: "none", color: "#ffd23f", demo: { build: "true", out: "dist" } });
  return loadManifest(j);
};

for (const [label, man] of [["real manifest", m], ["manifest plus a fake page and demo", grown()]]) {
  test(`${label}: first project's prev wraps to the last, last project's next wraps to the first`, () => {
    const ps = onSite(man);
    const [first, second] = ps;
    const [last, beforeLast] = [ps.at(-1), ps.at(-2)];
    const a = renderNav(man, first.slug);
    assert.match(a, /<nav class="vibe-nav" aria-label="vibe projects">/);
    assert.match(a, stepRe("prev", last));
    assert.match(a, stepRe("next", second));
    const z = renderNav(man, last.slug);
    assert.match(z, stepRe("prev", beforeLast));
    assert.match(z, stepRe("next", first));
  });

  test(`${label}: every on-site project steps to its neighbours in manifest order`, () => {
    const ps = onSite(man);
    ps.forEach((p, i) => {
      const html = renderNav(man, p.slug);
      assert.match(html, stepRe("prev", ps[(i - 1 + ps.length) % ps.length]), `${p.slug} prev`);
      assert.match(html, stepRe("next", ps[(i + 1) % ps.length]), `${p.slug} next`);
    });
  });

  test(`${label}: switcher menu lists the on-site projects in two groups, current marked (external ones left out)`, () => {
    const ps = onSite(man);
    const cur = ps[0];
    const html = renderNav(man, cur.slug);
    const items = [...html.matchAll(/<a class="vibe-item vibe-p-([a-z0-9-]+)"[^>]*href="([^"]+)"([^>]*)>/g)];
    assert.equal(items.length, ps.length);
    const demos = ps.filter((p) => p.demo);
    const rest = ps.filter((p) => !p.demo);
    assert.deepEqual(items.map((i) => i[2]), [...demos, ...rest].map((p) => `../${p.slug}/`), "live demos first, each group in manifest order");
    for (const p of man.projects.filter((p) => p.external)) assert.doesNotMatch(html, new RegExp(reRaw(p.slug)));
    const current = items.filter((i) => /aria-current="page"/.test(i[3]));
    assert.equal(current.length, 1);
    assert.equal(current[0][2], `../${cur.slug}/`);
    assert.match(html, /you're here/);
    const groups = [...html.matchAll(/<ul class="vibe-group"[^>]*>([\s\S]*?)<\/ul>/g)];
    assert.equal(groups.length, 2);
    assert.equal((groups[0][1].match(/vibe-item/g) || []).length, demos.length);
    assert.equal((groups[1][1].match(/vibe-item/g) || []).length, rest.length);
    assert.match(html, />live demos</);
    assert.match(html, />run it yourself</);
  });
}

test("teleprompter nav: crumb, back link, switcher label and source link", () => {
  const html = renderNav(m, "teleprompter");
  assert.match(html, /href="\.\.\/"[^>]*>← vibe</);
  assert.match(html, /\/ teleprompter</);
  assert.match(html, /aria-label="switch project, current: teleprompter"/);
  assert.match(html, /href="https:\/\/github\.com\/alifa20\/vibe\/tree\/main\/teleprompter"[^>]*>[\s\S]*source on github/);
});

test("nav markup has no inline style and no script", () => {
  for (const p of m.projects.filter((p) => !p.external)) {
    const html = renderNav(m, p.slug);
    assert.doesNotMatch(html, /style="/);
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /<style/);
  }
});

test("skip link option renders 'skip to <name>' before the nav", () => {
  const html = renderNav(m, "bitly", { skipTarget: "main" });
  assert.match(html, /^<a class="vibe-skip" href="#main">skip to golinks<\/a><nav/);
  assert.doesNotMatch(renderNav(m, "bitly"), /vibe-skip/);
});

test("unknown slug throws", () => {
  assert.throws(() => renderNav(m, "nope"), /nope/);
});

test("navStyle: namespaced, colour classes, KTD4 rule, both schemes the same", () => {
  const css = navStyle(m);
  for (const p of m.projects) assert.ok(css.includes(`.vibe-p-${p.slug}{--vibe-c:${p.color}}`), p.slug);
  assert.match(css, /--vibe-nav-h:\s*56px/);
  assert.match(css, /\.vibe-nav ?~ ?#root\{height:calc\(100% - var\(--vibe-nav-h\)\)\}/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /prefers-color-scheme/, "the strip looks the same in both schemes");
  // every selector touches a vibe- class or the #root rule / :root var
  const selectors = css.replace(/@media[^{]+\{/g, "").match(/(^|\})[^{}@]+\{/g) || [];
  for (const s of selectors) {
    const sel = s.replace(/^\}/, "").replace(/\{$/, "").trim();
    if (!sel) continue;
    assert.ok(/vibe-|^:root$/.test(sel), `unnamespaced selector: ${sel}`);
  }
});

test("styleHash is sha256 of the exact style text", () => {
  assert.equal(styleHash(m), b64sha(navStyle(m)));
});

const MINIMAL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>T</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/x.js"></script>
  </body>
</html>
`;

test("injectNav: skip link + nav + target first in body, style in head, rest byte-identical", () => {
  const out = injectNav(MINIMAL, m, "teleprompter");
  const style = `<style>${navStyle(m)}</style>`;
  const block = `<a class="vibe-skip" href="#vibe-skip">skip to teleprompter</a>` +
    renderNav(m, "teleprompter").replace(/^<a class="vibe-skip"[^]*?<\/a>/, "") +
    `<span id="vibe-skip" class="vibe-skip-target" tabindex="-1"></span>`;
  assert.ok(out.includes(`<body>${block}`), "skip link, nav, target are the first children of body");
  assert.ok(out.includes(`${style}</head>`), "style is the last thing in head");
  // Removing exactly what was inserted gives the original bytes back
  assert.equal(out.replace(style, "").replace(block, ""), MINIMAL);
});

test("injectNav is idempotent", () => {
  const once = injectNav(MINIMAL, m, "carrd");
  assert.equal(injectNav(once, m, "carrd"), once);
});

test("injectNav handles a body tag with attributes", () => {
  const html = MINIMAL.replace("<body>", '<body class="x">');
  const out = injectNav(html, m, "carrd");
  assert.match(out, /<body class="x"><a class="vibe-skip" href="#vibe-skip">skip to personal-site<\/a><nav/);
});

test("injectNav throws without a head or body", () => {
  assert.throws(() => injectNav("<p>hi</p>", m, "carrd"), /carrd/);
});

test("patchCsp: entity-encoded quotes keep A and add the hash", () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; style-src &#39;sha256-A&#39;; script-src &#39;sha256-B&#39;">`;
  const out = patchCsp(meta, styleHash(m));
  assert.equal(
    out,
    `<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; style-src &#39;sha256-A&#39; &#39;sha256-${styleHash(m)}&#39;; script-src &#39;sha256-B&#39;">`,
  );
});

test("patchCsp: literal quotes keep A and add the hash", () => {
  const meta = `<meta content="style-src 'sha256-A'; img-src 'self'" http-equiv="content-security-policy">`;
  const out = patchCsp(meta, "XYZ=");
  assert.equal(out, `<meta content="style-src 'sha256-A' 'sha256-XYZ='; img-src 'self'" http-equiv="content-security-policy">`);
});

test("patchCsp: style-src as the last directive", () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'sha256-A'">`;
  assert.match(patchCsp(meta, "H"), /style-src 'sha256-A' 'sha256-H'">/);
});

test("patchCsp: no CSP, or no style-src, leaves the page unchanged", () => {
  assert.equal(patchCsp(MINIMAL, "H"), MINIMAL);
  const noStyle = `<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;">`;
  assert.equal(patchCsp(noStyle, "H"), noStyle);
});

test("patchCsp: 'unsafe-inline' without hashes is left alone (a hash would disable it)", () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="style-src 'self' 'unsafe-inline'">`;
  assert.equal(patchCsp(meta, "H"), meta);
});

test("patchCsp: does not touch style-src-elem, and does not add the hash twice", () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="style-src-elem 'sha256-A'">`;
  assert.equal(patchCsp(meta, "H"), meta);
  const once = patchCsp(`<meta http-equiv="Content-Security-Policy" content="style-src 'sha256-A'">`, "H");
  assert.equal(patchCsp(once, "H"), once);
});

test("injectNav patches CSP with the hash of the injected style", () => {
  const html = MINIMAL.replace(
    "<title>",
    `<meta http-equiv="Content-Security-Policy" content="style-src &#39;sha256-A&#39;">\n    <title>`,
  );
  const out = injectNav(html, m, "carrd");
  const injected = out.match(/<style>([^]*?)<\/style>/)[1];
  assert.ok(out.includes(`&#39;sha256-A&#39; &#39;sha256-${b64sha(injected)}&#39;`));
});

test("real carrd page: injected nav style is allowed by its CSP", (t) => {
  let page;
  try {
    page = readFileSync(new URL("../carrd/dist/index.html", import.meta.url), "utf8");
  } catch {
    t.skip("carrd/dist not built; CI checks the assembled site with site/check-csp.mjs");
    return;
  }
  const out = injectNav(page, m, "carrd");
  const csp = out.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].replace(/&#39;/g, "'");
  const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"));
  for (const [, css] of out.matchAll(/<style>([^]*?)<\/style>/g)) {
    assert.ok(styleSrc.includes(`'sha256-${b64sha(css)}'`), "every inline style is hashed");
  }
});

test("ensureIconLink adds a relative icon only when missing", () => {
  const out = ensureIconLink(MINIMAL);
  assert.match(out, /<link rel="icon" href="\.\/favicon\.svg" type="image\/svg\+xml"><\/head>/);
  assert.equal(out.replace(/<link rel="icon"[^>]*>/, ""), MINIMAL);
  const has = MINIMAL.replace("</head>", '<link rel="icon" href="/x.png"></head>');
  assert.equal(ensureIconLink(has), has);
  const hasShortcut = MINIMAL.replace("</head>", "<link rel='shortcut icon' href='x.ico'></head>");
  assert.equal(ensureIconLink(hasShortcut), hasShortcut);
  assert.match(ensureIconLink(MINIMAL, "../favicon.svg"), /href="\.\.\/favicon\.svg"/);
});

test("nav style hides the strip while the teleprompter's full-screen prompter is mounted (R5)", () => {
  // Descendants too: the strip's reset sets visibility:visible on every child,
  // which would otherwise override the inherited hidden.
  assert.match(navStyle(m), /body:has\(\.prompter\) \.vibe-nav,body:has\(\.prompter\) \.vibe-nav \*,body:has\(\.prompter\) \.vibe-skip\{visibility:hidden\}/);
});
