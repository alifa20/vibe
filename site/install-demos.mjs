// site/install-demos.mjs — installs dependencies for every demo the hub builds (KTD2).
//
//   node site/install-demos.mjs              pnpm install --frozen-lockfile in each demo with a lockfile
//   node site/install-demos.mjs --dry-run    print what would be installed and skipped, install nothing
//   node site/install-demos.mjs --lockfiles  print each demo lockfile path, one per line (for CI caching)
//
//   planInstalls({ root, manifest }) -> { install: [slug], skip: [slug] }
//     Demos come from site/projects.json. A demo without a pnpm-lock.yaml (carrd, which has
//     no dependencies) is skipped. Page and external projects are never installed here.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./hub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const LOCKFILE = "pnpm-lock.yaml";

export function planInstalls({ root = ROOT, manifest } = {}) {
  const m = manifest ?? loadManifest(readFileSync(join(HERE, "projects.json"), "utf8"));
  const install = [];
  const skip = [];
  for (const p of m.projects) {
    if (!p.demo) continue;
    (existsSync(join(root, p.slug, LOCKFILE)) ? install : skip).push(p.slug);
  }
  return { install, skip };
}

function main(argv) {
  const { install, skip } = planInstalls();
  if (argv.includes("--lockfiles")) {
    for (const slug of install) console.log(`${slug}/${LOCKFILE}`);
    return;
  }
  const dry = argv.includes("--dry-run");
  for (const slug of skip) console.log(`skip ${slug}: no ${LOCKFILE}`);
  for (const slug of install) {
    console.log(`${dry ? "would install" : "install"} ${slug}: pnpm install --frozen-lockfile`);
    if (!dry) execSync("pnpm install --frozen-lockfile", { cwd: join(ROOT, slug), stdio: "inherit" });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
