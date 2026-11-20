import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSample } from "../scripts/sample-report.mjs";
import { ISSUE_TYPES } from "../src/audit.mjs";

const run = async () => {
  const outDir = mkdtempSync(join(tmpdir(), "sitecrawl-sample-"));
  const hosts = new Set();
  const fetchImpl = (url, init) => {
    hosts.add(new URL(url).hostname);
    return fetch(url, init);
  };
  try {
    const out = await buildSample({ outDir, sleep: async () => {}, fetchImpl });
    return { ...out, written: readFileSync(join(outDir, "index.html"), "utf8"), hosts };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

test("the sample talks only to 127.0.0.1 and its report shows every issue type", async () => {
  const { issues, written, html, hosts } = await run();
  assert.deepEqual([...hosts], ["127.0.0.1"]);
  assert.equal(written, html);
  const found = new Set(issues.map((i) => i.type));
  for (const type of Object.keys(ISSUE_TYPES)) {
    assert.ok(found.has(type), `fixture has no ${type}`);
    assert.ok(html.includes(`id="issue-${type}"`), `report has no section for ${type}`);
  }
});

test("the sample report is identical across runs and never shows the local port", async () => {
  const a = await run();
  const b = await run();
  assert.equal(a.html, b.html);
  assert.ok(!a.html.includes("127.0.0.1"));
  assert.ok(a.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "the hostile fixture title is escaped");
});
