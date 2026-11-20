import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { assemble } from "./build.mjs";
import { loadManifest } from "./hub.mjs";
import { createServer } from "./serve.mjs";

const REAL = loadManifest(readFileSync(new URL("./projects.json", import.meta.url), "utf8"));
const TMP = mkdtempSync(join(tmpdir(), "vibe-site-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

const TELEPROMPTER = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Teleprompter</title>
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
const CSP = "default-src &#39;self&#39;; style-src &#39;sha256-PAGE&#39;; script-src &#39;sha256-JS&#39;";
const carrdPage = (title) => `<!doctype html>
<html lang="en">
<head>
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<title>${title}</title>
</head>
<body>
<main>${title}</main>
</body>
</html>
`;

// A repo-shaped fixture: real manifest, fake demo output folders.
function fixtureRoot(name) {
  const root = join(TMP, name);
  mkdirSync(join(root, "teleprompter", "dist", "assets"), { recursive: true });
  writeFileSync(join(root, "teleprompter", "dist", "index.html"), TELEPROMPTER);
  writeFileSync(join(root, "teleprompter", "dist", "favicon.svg"), "<svg/>");
  writeFileSync(join(root, "teleprompter", "dist", "assets", "index-abc.js"), "console.log(1)");
  mkdirSync(join(root, "carrd", "dist"), { recursive: true });
  for (const page of ["index", "thanks", "404"]) writeFileSync(join(root, "carrd", "dist", `${page}.html`), carrdPage(page));
  writeFileSync(join(root, "carrd", "dist", "favicon.svg"), "<svg/>");
  return root;
}

function tree(dir, base = dir) {
  const out = {};
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) Object.assign(out, tree(p, base));
    else out[p.slice(base.length + 1)] = readFileSync(p, "utf8");
  }
  return out;
}

test("assemble writes the hub, 404, both demos and six project pages", () => {
  const root = fixtureRoot("full");
  const { outDir, pages } = assemble({ root, skipBuild: true, manifest: REAL });
  assert.equal(outDir, join(root, "_site"));
  for (const p of ["index.html", "404.html", "favicon.svg", "teleprompter/index.html", "carrd/index.html", "carrd/thanks.html", "carrd/404.html"]) {
    assert.ok(existsSync(join(outDir, p)), `${p} exists`);
  }
  for (const slug of ["bitly", "linktree", "qr", "senja", "tally", "zcal"]) {
    assert.ok(pages.includes(`${slug}/index.html`), `${slug} project page`);
  }
  assert.equal(readFileSync(join(outDir, "teleprompter", "assets", "index-abc.js"), "utf8"), "console.log(1)");
  assert.equal(existsSync(join(root, "_site.tmp")), false, "temp folder cleaned up");
});

test("every demo page gets the nav, the right current project, and a CSP hash", () => {
  const root = fixtureRoot("nav");
  const { outDir } = assemble({ root, skipBuild: true, manifest: REAL });
  for (const page of ["index", "thanks", "404"]) {
    const html = readFileSync(join(outDir, "carrd", `${page}.html`), "utf8");
    assert.match(html, /<nav class="vibe-nav"/, `carrd/${page}.html has the nav`);
    assert.match(html, /aria-current="page"[^>]*>[\s\S]*?personal-site/);
    assert.match(html, /style-src &#39;sha256-PAGE&#39; &#39;sha256-[A-Za-z0-9+/=]+&#39;/, "nav hash appended to style-src");
  }
  const tp = readFileSync(join(outDir, "teleprompter", "index.html"), "utf8");
  assert.match(tp, /<nav class="vibe-nav"/);
  assert.match(tp, /<link rel="icon" href="\.\/favicon\.svg"/, "teleprompter gains a relative icon link");
  assert.equal((readFileSync(join(outDir, "carrd", "index.html"), "utf8").match(/rel="icon"/g) || []).length, 1, "carrd keeps its single icon link");
});

test("running assemble twice gives the same tree", () => {
  const root = fixtureRoot("twice");
  const first = tree(assemble({ root, skipBuild: true, manifest: REAL }).outDir);
  const second = tree(assemble({ root, skipBuild: true, manifest: REAL }).outDir);
  assert.deepEqual(second, first);
});

test("a failing demo build names the project and leaves the old _site/ alone", () => {
  const root = fixtureRoot("fail");
  const { outDir } = assemble({ root, skipBuild: true, manifest: REAL });
  const before = tree(outDir);
  const broken = structuredClone(REAL);
  broken.projects.find((p) => p.slug === "carrd").demo.build = "exit 3";
  assert.throws(() => assemble({ root, manifest: { ...broken, projects: broken.projects.map((p) => (p.slug === "teleprompter" ? { ...p, demo: { ...p.demo, build: "true" } } : p)) } }), /carrd/);
  assert.deepEqual(tree(outDir), before, "_site/ untouched");
  assert.equal(existsSync(join(root, "_site.tmp")), false);
});

test("a missing demo output names the project", () => {
  const root = fixtureRoot("missing");
  rmSync(join(root, "teleprompter", "dist"), { recursive: true });
  assert.throws(() => assemble({ root, skipBuild: true, manifest: REAL }), /teleprompter/);
});

test("screenshots are copied next to their project page", () => {
  const root = fixtureRoot("shots");
  mkdirSync(join(root, "zcal", "docs"), { recursive: true });
  writeFileSync(join(root, "zcal", "docs", "booking.png"), "png");
  const m = structuredClone(REAL);
  m.projects.find((p) => p.slug === "zcal").page.screenshots = [{ src: "docs/booking.png", alt: "zcal booking page" }];
  const { outDir } = assemble({ root, skipBuild: true, manifest: m });
  assert.equal(readFileSync(join(outDir, "zcal", "docs", "booking.png"), "utf8"), "png");
  assert.match(readFileSync(join(outDir, "zcal", "index.html"), "utf8"), /src="docs\/booking\.png"/);
});

/* ── serve.mjs ── */

async function withServer(siteDir, fn) {
  const server = createServer({ siteDir });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn((path) => fetch(base + path, { redirect: "manual" }));
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("serve: hub, assets, redirects, 404 and no path escape", async () => {
  const root = fixtureRoot("serve");
  const { outDir } = assemble({ root, skipBuild: true, manifest: REAL });
  writeFileSync(join(root, "secret.txt"), "nope");
  await withServer(outDir, async (get) => {
    let r = await get("/vibe/");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
    assert.match(await r.text(), /run it yourself/);

    r = await get("/vibe/teleprompter/assets/index-abc.js");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/javascript/);

    r = await get("/");
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("location"), "/vibe/");

    r = await get("/vibe/zcal");
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("location"), "/vibe/zcal/");

    r = await get("/vibe/nope");
    assert.equal(r.status, 404);
    assert.match(await r.text(), /href="\/vibe\/"/);

    for (const evil of ["/vibe/../secret.txt", "/vibe/%2e%2e/secret.txt", "/vibe/..%2fsecret.txt"]) {
      r = await get(evil);
      assert.equal(r.status === 200 && (await r.text()) === "nope", false, `${evil} must not escape _site/`);
    }
  });
});
