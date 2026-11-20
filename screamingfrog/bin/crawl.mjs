#!/usr/bin/env node
// sitecrawl <start-url> [options]  — crawl one site and write an HTML report.
// Run with --help for the options.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { crawl, DEFAULTS } from "../src/crawl.mjs";
import { audit } from "../src/audit.mjs";
import { renderReport } from "../src/report.mjs";

const HELP = `usage: sitecrawl <start-url> [options]

  --max-pages <n>       stop after this many URLs (default ${DEFAULTS.maxPages})
  --max-depth <n>       how many clicks from the start URL to follow (default: no limit)
  --concurrency <n>     requests in flight at once (default ${DEFAULTS.concurrency})
  --delay <ms>          pause after each request, per worker (default 0)
  --max-body-size <sz>  skip pages larger than this, e.g. 500kB or 5MB (default 5MB)
  --user-agent <ua>     user agent to send and to match in robots.txt
  --out <file>          where to write the report (default sitecrawl-report.html)
  -h, --help            show this help
`;

/** "5MB", "500kB", "1048576" -> bytes. */
export function parseSize(s) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g)?\s*$/i.exec(String(s));
  if (!m) throw new Error(`can't read size "${s}"`);
  const unit = (m[2] || "b").toLowerCase()[0];
  return Math.round(Number(m[1]) * { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[unit]);
}

const positiveInt = (name, v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < (name === "delay" || name === "max-depth" ? 0 : 1)) throw new Error(`--${name} needs a whole number, got "${v}"`);
  return n;
};

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "max-pages": { type: "string" },
      "max-depth": { type: "string" },
      concurrency: { type: "string" },
      delay: { type: "string" },
      "max-body-size": { type: "string" },
      "user-agent": { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length !== 1) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 2);
  }
  const start = positionals[0];
  if (!/^https?:\/\//i.test(start)) throw new Error(`start URL must begin with http:// or https://, got "${start}"`);

  const options = {};
  if (values["max-pages"]) options.maxPages = positiveInt("max-pages", values["max-pages"]);
  if (values["max-depth"]) options.maxDepth = positiveInt("max-depth", values["max-depth"]);
  if (values.concurrency) options.concurrency = positiveInt("concurrency", values.concurrency);
  if (values.delay) options.delay = positiveInt("delay", values.delay);
  if (values["max-body-size"]) options.maxBodySize = parseSize(values["max-body-size"]);
  if (values["user-agent"]) options.userAgent = values["user-agent"];
  options.onProgress = ({ depth, queued, done }) =>
    process.stderr.write(`depth ${depth}: ${queued} URL${queued === 1 ? "" : "s"} queued (${done} done)\n`);

  const result = await crawl(start, options);
  const issues = audit(result);
  const out = resolve(values.out ?? "sitecrawl-report.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderReport(result, issues, { generatedAt: new Date().toISOString() }));

  const crawled = result.pages.filter((p) => !p.blockedByRobots).length;
  const blocked = result.pages.length - crawled;
  console.log(
    `crawled ${crawled} page${crawled === 1 ? "" : "s"}` +
      (blocked ? ` (${blocked} blocked by robots.txt)` : "") +
      `, checked ${result.external.length} external link${result.external.length === 1 ? "" : "s"}, found ${issues.length} issue${issues.length === 1 ? "" : "s"}`,
  );
  console.log(`report: ${out}`);
}

main().catch((err) => {
  console.error(`sitecrawl: ${err.message}`);
  process.exit(1);
});
