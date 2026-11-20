// site/check-csp.mjs — verify every inline <style> and <script> in the assembled site
// is allowed by its page's Content-Security-Policy <meta>.
//
//   node site/check-csp.mjs [siteDir]    (default: _site/) exits 1 on any problem
//
// Exported for tests: checkCsp(siteDir) -> string[] of problems (empty when clean).
// Pages without a CSP meta are skipped. A page whose CSP has no style-src/script-src
// falls back to default-src, which never allows inline code, so every inline block
// must be hashed in the matching directive. This is the CI gate for the nav strip's
// CSP patch: if a demo's CSP ever takes a shape patchCsp can't patch, the build fails
// here instead of shipping an unstyled nav.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("base64");
const decode = (s) => s.replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(p));
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(p);
  }
  return out.sort();
}

function directive(csp, name) {
  const found = csp.split(";").map((d) => d.trim()).find((d) => d.split(/\s+/)[0] === name);
  return found ? found.split(/\s+/).slice(1) : null;
}

export function checkCsp(siteDir) {
  const problems = [];
  for (const file of htmlFiles(siteDir)) {
    const html = readFileSync(file, "utf8");
    const meta = /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=(["'])([^]*?)\1/i.exec(html);
    if (!meta) continue;
    const csp = decode(meta[2]);
    const page = relative(siteDir, file);
    const sources = {
      style: directive(csp, "style-src") ?? directive(csp, "default-src") ?? [],
      script: directive(csp, "script-src") ?? directive(csp, "default-src") ?? [],
    };
    for (const [, tag, attrs, body] of html.matchAll(/<(style|script)\b([^>]*)>([^]*?)<\/\1>/gi)) {
      const kind = tag.toLowerCase();
      if (kind === "script" && /\bsrc\s*=/i.test(attrs)) continue;
      if (sources[kind].includes(`'sha256-${sha256(body)}'`)) continue;
      problems.push(`${page}: inline <${kind}> (sha256-${sha256(body)}) is not allowed by its CSP ${kind}-src`);
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const siteDir = resolve(process.argv[2] ?? join(HERE, "..", "_site"));
  const problems = checkCsp(siteDir);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log("✓ every inline style and script is allowed by its page's CSP");
}
