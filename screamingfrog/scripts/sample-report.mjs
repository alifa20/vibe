#!/usr/bin/env node
// Build the sample report that the hub publishes: serve fixtures/site/ on
// 127.0.0.1, crawl it, write sample/index.html, stop the server.
//
// Nothing leaves the machine: the "external" links in the fixture point at a
// second local server on another port.
//
// The servers listen on ephemeral ports, so before rendering, the two local
// origins are swapped for fixed placeholder hosts (bakery.example and
// elsewhere.example, reserved names that never resolve) and response times
// are dropped. URLs are shown as text, not links, since the placeholders go
// nowhere. The result: the same report byte for byte on every run.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureSites } from "../fixtures/server.mjs";
import { crawl } from "../src/crawl.mjs";
import { audit } from "../src/audit.mjs";
import { renderReport, relabel } from "../src/report.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SITE_HOST = "https://bakery.example";
export const EXTERNAL_HOST = "https://elsewhere.example";

export async function buildSample({ outDir = join(ROOT, "sample"), sleep, fetchImpl } = {}) {
  const sites = await startFixtureSites();
  try {
    const raw = await crawl(sites.origin + "/", { sleep, fetchImpl });
    const result = relabel(raw, { [sites.origin]: SITE_HOST, [sites.externalOrigin]: EXTERNAL_HOST });
    for (const p of result.pages) if ("timeMs" in p) p.timeMs = null;
    const issues = audit(result);
    const html = renderReport(result, issues, { linkUrls: false, showTimings: false });
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, "index.html");
    writeFileSync(file, html);
    return { file, result, issues, html };
  } finally {
    await sites.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { file, result, issues } = await buildSample();
  console.log(`sample: crawled ${result.pages.length} URLs, ${issues.length} issues → ${file}`);
}
