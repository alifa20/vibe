// XML sitemaps: urlsets, sitemap index files, and gzip.
//
//   decodeSitemapBody(buffer)  -> string  gunzips when the body starts with the gzip magic bytes
//   parseSitemap(xml)          -> { kind: "index" | "urlset" | "unknown", locs: [string] }
//   loadSitemaps(urls, fetcher, { maxFiles }) -> { files: [{ url, status, error, kind, count }], urls: [string] }
//     fetcher(url) -> { final: { status, body, error } } (fetchFollowing's shape)

import { gunzipSync } from "node:zlib";
import { load } from "cheerio";
import { normaliseUrl } from "./url.mjs";

export function decodeSitemapBody(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? "");
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return gunzipSync(b).toString("utf8");
  return b.toString("utf8");
}

export function parseSitemap(xml) {
  const $ = load(String(xml ?? ""), { xml: true });
  const kind = $("sitemapindex").length ? "index" : $("urlset").length ? "urlset" : "unknown";
  const locs = $(kind === "index" ? "sitemap > loc" : "url > loc")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  return { kind, locs };
}

export async function loadSitemaps(startUrls, fetcher, { maxFiles = 50 } = {}) {
  const queue = [...new Set(startUrls)];
  const done = new Set();
  const files = [];
  const urls = [];
  const seenUrls = new Set();
  while (queue.length && files.length < maxFiles) {
    const url = queue.shift();
    if (done.has(url)) continue;
    done.add(url);
    const { final } = await fetcher(url);
    const entry = { url, status: final.status, error: final.error, kind: "unknown", count: 0 };
    files.push(entry);
    if (final.status !== 200) continue;
    let parsed;
    try {
      parsed = parseSitemap(decodeSitemapBody(final.body));
    } catch (err) {
      entry.error = `could not read sitemap: ${err.message}`;
      continue;
    }
    entry.kind = parsed.kind;
    entry.count = parsed.locs.length;
    for (const loc of parsed.locs) {
      let abs;
      try {
        abs = normaliseUrl(new URL(loc, url));
      } catch {
        continue;
      }
      if (parsed.kind === "index") queue.push(abs);
      else if (!seenUrls.has(abs)) {
        seenUrls.add(abs);
        urls.push(abs);
      }
    }
  }
  return { files, urls };
}
