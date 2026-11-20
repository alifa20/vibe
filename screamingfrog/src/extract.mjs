// Pull the SEO fields out of one HTML page. Only plain values come back; the
// cheerio DOM is dropped as soon as this returns.
//
//   extract(html, { url, headers }) -> {
//     title, metaDescription, h1s, canonical, metaRobots, xRobotsTag,
//     noindex, nofollow, imagesMissingAlt, links: [url], base
//   }

import { load } from "cheerio";
import { resolveLink } from "./url.mjs";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Directives that apply to us: unprefixed ones, or ones for "robots"/"*". */
function robotsTokens(...values) {
  const tokens = new Set();
  for (const value of values) {
    for (const part of String(value ?? "").toLowerCase().split(/,/)) {
      // X-Robots-Tag may carry a "googlebot: noindex" prefix; keep only the directive.
      const directive = part.includes(":") && !/^\s*(unavailable_after|max-)/.test(part) ? part.split(":").pop() : part;
      if (directive.trim()) tokens.add(directive.trim());
    }
  }
  return tokens;
}

export function extract(html, { url, headers = {} } = {}) {
  const $ = load(String(html ?? ""));
  const baseHref = $("base[href]").first().attr("href");
  let base = url;
  if (baseHref) {
    try {
      base = new URL(baseHref, url).href;
    } catch {
      base = url;
    }
  }

  const titleEl = $("title").first();
  const title = titleEl.length ? clean(titleEl.text()) : null;
  const descEl = $('meta[name="description" i]').first();
  const metaDescription = descEl.length ? clean(descEl.attr("content")) : null;
  const h1s = $("h1").map((_, el) => clean($(el).text())).get();
  const canonicalHref = $('link[rel~="canonical" i][href]').first().attr("href");
  const canonical = canonicalHref ? resolveLink(canonicalHref, base) : null;
  const metaRobots = $('meta[name="robots" i]').map((_, el) => clean($(el).attr("content"))).get().join(", ") || null;
  const xRobotsTag = headers["x-robots-tag"] ?? null;
  const tokens = robotsTokens(metaRobots, xRobotsTag);

  const imagesMissingAlt = $("img")
    .filter((_, el) => $(el).attr("alt") === undefined)
    .map((_, el) => clean($(el).attr("src")) || "(no src)")
    .get();

  const links = [];
  const seen = new Set();
  $("a[href], area[href]").each((_, el) => {
    const link = resolveLink($(el).attr("href"), base);
    if (link && !seen.has(link)) {
      seen.add(link);
      links.push(link);
    }
  });

  return {
    title,
    metaDescription,
    h1s,
    canonical,
    metaRobots,
    xRobotsTag,
    noindex: tokens.has("noindex") || tokens.has("none"),
    nofollow: tokens.has("nofollow") || tokens.has("none"),
    imagesMissingAlt,
    links,
    base,
  };
}
