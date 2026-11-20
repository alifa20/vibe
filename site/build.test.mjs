import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { assemble } from "./build.mjs";
import { planInstalls } from "./install-demos.mjs";
import { checkCsp } from "./check-csp.mjs";
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

// A repo-shaped fixture: a stub output folder for every demo in the manifest. teleprompter
// and carrd get pages shaped like their real builds; any other demo gets a CSP'd index.html.
function fixtureRoot(name, manifest = REAL) {
  const root = join(TMP, name);
  for (const p of manifest.projects.filter((p) => p.demo)) {
    const out = join(root, p.slug, p.demo.out);
    mkdirSync(out, { recursive: true });
    if (p.slug === "teleprompter") {
      mkdirSync(join(out, "assets"), { recursive: true });
      writeFileSync(join(out, "index.html"), TELEPROMPTER);
      writeFileSync(join(out, "favicon.svg"), "<svg/>");
      writeFileSync(join(out, "assets", "index-abc.js"), "console.log(1)");
    } else if (p.slug === "carrd") {
      for (const page of ["index", "thanks", "404"]) writeFileSync(join(out, `${page}.html`), carrdPage(page));
      writeFileSync(join(out, "favicon.svg"), "<svg/>");
    } else {
      writeFileSync(join(out, "index.html"), carrdPage(p.name));
    }
  }
  return root;
}

const demos = (m) => m.projects.filter((p) => p.demo);
const pageProjects = (m) => m.projects.filter((p) => p.page);

function tree(dir, base = dir) {
  const out = {};
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) Object.assign(out, tree(p, base));
    else out[p.slice(base.length + 1)] = readFileSync(p, "utf8");
  }
  return out;
}

test("assemble writes the hub, 404, every demo and a page per server project", () => {
  const root = fixtureRoot("full");
  const { outDir, pages } = assemble({ root, skipBuild: true, manifest: REAL });
  assert.equal(outDir, join(root, "_site"));
  for (const p of ["index.html", "404.html", "favicon.svg", "teleprompter/index.html", "carrd/index.html", "carrd/thanks.html", "carrd/404.html"]) {
    assert.ok(existsSync(join(outDir, p)), `${p} exists`);
  }
  for (const p of demos(REAL)) assert.ok(existsSync(join(outDir, p.slug, "index.html")), `${p.slug} demo`);
  assert.ok(pageProjects(REAL).length > 0);
  for (const p of pageProjects(REAL)) assert.ok(pages.includes(`${p.slug}/index.html`), `${p.slug} project page`);
  for (const p of REAL.projects.filter((p) => p.external)) assert.equal(existsSync(join(outDir, p.slug)), false, `${p.slug} is not built here`);
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

test("a new demo in the manifest gets the nav and a CSP hash, with no test edits", () => {
  const j = JSON.parse(readFileSync(new URL("./projects.json", import.meta.url), "utf8"));
  j.projects.push({ slug: "fake-demo", name: "fakedemo", description: "a fake demo.", stack: "none", color: "#ffd23f", demo: { build: "true", out: "dist" } });
  const m = loadManifest(j);
  assert.ok(demos(m).length >= 3, "at least a third demo");
  const root = fixtureRoot("extra-demo", m);
  const { outDir, pages } = assemble({ root, skipBuild: true, manifest: m });
  assert.ok(pages.includes("fake-demo/index.html"));
  const html = readFileSync(join(outDir, "fake-demo", "index.html"), "utf8");
  assert.match(html, /<nav class="vibe-nav"/);
  assert.match(html, /aria-current="page"[^>]*>[\s\S]*?fakedemo/);
  assert.match(html, /style-src &#39;sha256-PAGE&#39; &#39;sha256-[A-Za-z0-9+/=]+&#39;/, "nav hash appended to style-src");
  assert.deepEqual(checkCsp(outDir), []);
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

test("checkCsp passes the assembled site and names a page with an unhashed inline style", () => {
  const root = fixtureRoot("csp");
  const { outDir } = assemble({ root, skipBuild: true, manifest: REAL });
  assert.deepEqual(checkCsp(outDir), []);
  const page = join(outDir, "carrd", "thanks.html");
  writeFileSync(page, readFileSync(page, "utf8").replace("</head>", "<style>main{color:red}</style></head>"));
  const problems = checkCsp(outDir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /carrd\/thanks\.html: inline <style>/);
});

test("checkCsp requires inline scripts to be hashed too, and ignores external ones", () => {
  const dir = join(TMP, "csp-script");
  mkdirSync(dir, { recursive: true });
  const ok = "console.log(1)";
  const hash = createHash("sha256").update(ok).digest("base64");
  writeFileSync(join(dir, "a.html"), `<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; script-src &#39;sha256-${hash}&#39;"><script>${ok}</script><script src="x.js"></script>`);
  assert.deepEqual(checkCsp(dir), []);
  writeFileSync(join(dir, "b.html"), `<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;"><script>alert(1)</script>`);
  assert.match(checkCsp(dir).join("\n"), /b\.html: inline <script>/);
});

/* ── install-demos.mjs ── */

test("planInstalls lists demos with a lockfile and skips the rest", () => {
  const real = planInstalls({ manifest: REAL });
  assert.ok(real.install.includes("teleprompter"), "teleprompter has a lockfile");
  assert.ok(real.skip.includes("carrd"), "carrd has no lockfile");
  assert.deepEqual([...real.install, ...real.skip].sort(), demos(REAL).map((p) => p.slug).sort(), "only demos, each once");

  const root = fixtureRoot("install");
  writeFileSync(join(root, "teleprompter", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  assert.deepEqual(planInstalls({ root, manifest: REAL }), { install: ["teleprompter"], skip: demos(REAL).map((p) => p.slug).filter((s) => s !== "teleprompter") });
});

test("install-demos --dry-run lists teleprompter, skips carrd and installs nothing", () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL("./install-demos.mjs", import.meta.url)), "--dry-run"], { encoding: "utf8" });
  assert.match(out, /would install teleprompter/);
  assert.match(out, /skip carrd: no pnpm-lock\.yaml/);
  assert.doesNotMatch(out, /^install /m);
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

    // A decoded control character must never reach a response header.
    r = await get("/vibe/x%0A%2F..");
    assert.ok([301, 404].includes(r.status), `control-character path answered with ${r.status}`);
    if (r.status === 301) assert.doesNotMatch(r.headers.get("location"), /[\r\n]/);
    r = await get("/vibe/");
    assert.equal(r.status, 200, "server still up after the control-character request");

    r = await get("/vibe/nope");
    assert.equal(r.status, 404);
    assert.match(await r.text(), /href="\/vibe\/"/);

    for (const evil of ["/vibe/../secret.txt", "/vibe/%2e%2e/secret.txt", "/vibe/..%2fsecret.txt"]) {
      r = await get(evil);
      assert.equal(r.status === 200 && (await r.text()) === "nope", false, `${evil} must not escape _site/`);
    }
  });
});
