// site/build.mjs — builds the demos and assembles the GitHub Pages artifact in _site/.
//
//   node site/build.mjs              build every demo from source, then assemble _site/
//   node site/build.mjs --skip-build reuse each demo's existing output folder
//
// Exported for tests:
//   assemble({ root, outDir, skipBuild, manifest }) -> { outDir, pages }
//     root      repo root (project folders live at <root>/<slug>/)
//     outDir    where the site lands (default <root>/_site)
//     manifest  a loadManifest() result (default <root>/site/projects.json)
//   Everything is written to a sibling temp folder first and swapped in at the
//   end, so a failed demo build never leaves a partial _site/ behind.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, render404, renderHub, renderProjectPage } from "./hub.mjs";
import { ensureIconLink, injectNav } from "./nav.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const toPosix = (p) => p.split(sep).join(posix.sep);

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(p));
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(p);
  }
  return out.sort();
}

function buildDemo(root, project) {
  const cwd = join(root, project.slug);
  try {
    execSync(project.demo.build, { cwd, stdio: "inherit" });
  } catch (err) {
    throw new Error(`build failed for "${project.slug}": \`${project.demo.build}\` exited with ${err.status ?? err.message}`);
  }
}

export function assemble({ root = resolve(HERE, ".."), outDir, skipBuild = false, manifest } = {}) {
  const m = manifest ?? loadManifest(readFileSync(join(root, "site", "projects.json"), "utf8"));
  const out = outDir ?? join(root, "_site");
  const tmp = `${out}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const pages = [];
  const write = (rel, html) => {
    const p = join(tmp, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, html);
    pages.push(toPosix(rel));
  };

  try {
    for (const p of m.projects) {
      if (p.demo) {
        if (!skipBuild) buildDemo(root, p);
        const src = join(root, p.slug, p.demo.out);
        if (!existsSync(src)) throw new Error(`"${p.slug}": demo output ${toPosix(relative(root, src))} not found (build it, or drop --skip-build)`);
        const dest = join(tmp, p.slug);
        cpSync(src, dest, { recursive: true });
        // Prefer the demo's own favicon; fall back to the hub's at the site root.
        const demoIcon = join(dest, "favicon.svg");
        const iconTarget = existsSync(demoIcon) ? demoIcon : join(tmp, "favicon.svg");
        for (const file of htmlFiles(dest)) {
          const href = toPosix(relative(dirname(file), iconTarget));
          const html = ensureIconLink(injectNav(readFileSync(file, "utf8"), m, p.slug), href.startsWith(".") ? href : `./${href}`);
          writeFileSync(file, html);
          pages.push(toPosix(relative(tmp, file)));
        }
      } else if (p.page) {
        write(join(p.slug, "index.html"), renderProjectPage(m, p.slug));
        for (const shot of p.page.screenshots) {
          const from = join(root, p.slug, shot.src);
          if (!existsSync(from)) throw new Error(`"${p.slug}": screenshot ${shot.src} not found in ${p.slug}/`);
          const to = join(tmp, p.slug, shot.src);
          mkdirSync(dirname(to), { recursive: true });
          cpSync(from, to);
        }
      }
    }
    write("index.html", renderHub(m));
    write("404.html", render404(m));
    cpSync(join(HERE, "favicon.svg"), join(tmp, "favicon.svg"));
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }

  rmSync(out, { recursive: true, force: true });
  renameSync(tmp, out);
  return { outDir: out, pages: pages.sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { outDir, pages } = assemble({ skipBuild: process.argv.includes("--skip-build") });
    console.log(`✓ ${toPosix(relative(process.cwd(), outDir)) || "."}: ${pages.length} pages`);
    for (const p of pages) console.log(`  ${p}`);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
