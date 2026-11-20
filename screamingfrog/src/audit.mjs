// Audits: pure functions over a crawl result, each returning issues.
//
//   audit(result) -> [{ type, severity, url, urls?, detail, sources? }]
//
// `result` is what crawl() returns (origin, pages, external, sitemaps.urls).
// Issues come out ordered by ISSUE_TYPES, then by URL, so the same crawl
// always produces the same list.

import { compareUrls } from "./url.mjs";

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;

export const ISSUE_TYPES = {
  "broken-internal-link": { severity: "error", label: "Broken internal links", help: "Pages on this site that return an error or could not be fetched, with the pages that link to them." },
  "broken-external-link": { severity: "error", label: "Broken external links", help: "Links to other sites that return an error or could not be reached." },
  "redirect-loop": { severity: "error", label: "Redirect loops", help: "Redirects that lead back to a URL already in the chain, so the page never loads." },
  "canonical-to-error": { severity: "error", label: "Canonical points at an error page", help: "The canonical URL returns an error, so search engines cannot use it." },
  "canonical-to-redirect": { severity: "warning", label: "Canonical points at a redirect", help: "The canonical URL redirects. Point it at the final URL instead." },
  "canonical-to-noindex": { severity: "warning", label: "Canonical points at a noindex page", help: "The canonical URL asks not to be indexed, which sends mixed signals." },
  "redirect-chain": { severity: "warning", label: "Redirect chains", help: "Redirects that take two or more hops. Link straight to the final URL." },
  "missing-title": { severity: "warning", label: "Missing title", help: "Pages with no <title>, or an empty one." },
  "duplicate-title": { severity: "warning", label: "Duplicate titles", help: "Pages that share the same title." },
  "title-too-long": { severity: "notice", label: `Title over ${TITLE_MAX} characters`, help: "Long titles are usually cut short in search results." },
  "missing-meta-description": { severity: "warning", label: "Missing meta description", help: "Pages with no meta description, or an empty one." },
  "duplicate-meta-description": { severity: "notice", label: "Duplicate meta descriptions", help: "Pages that share the same meta description." },
  "meta-description-too-long": { severity: "notice", label: `Meta description over ${DESCRIPTION_MAX} characters`, help: "Long descriptions are usually cut short in search results." },
  "missing-h1": { severity: "warning", label: "Missing H1", help: "Pages with no <h1> heading." },
  "multiple-h1": { severity: "notice", label: "More than one H1", help: "Pages with several <h1> headings." },
  "noindex": { severity: "notice", label: "Noindex pages", help: "Pages that ask search engines not to index them, through a meta tag or an X-Robots-Tag header." },
  "sitemap-orphan": { severity: "warning", label: "In the sitemap, never reached", help: "Sitemap URLs that no crawled page links to (within the crawl limits)." },
  "sitemap-non-indexable": { severity: "warning", label: "Non-indexable URLs in the sitemap", help: "Sitemap URLs that redirect, error, are blocked, are noindex, or name another canonical." },
  "image-missing-alt": { severity: "notice", label: "Images without alt text", help: "Pages with <img> elements that have no alt attribute." },
};

const ORDER = Object.keys(ISSUE_TYPES);
const issue = (type, fields) => ({ type, severity: ISSUE_TYPES[type].severity, ...fields });

/** A page whose HTML was parsed: a direct 2xx HTML response. */
const parsed = (p) => p.title !== undefined;
const isBroken = (status) => status === 0 || status >= 400;
/** The error when the request failed outright, else the status (or `shown`). */
const statusText = (p, shown = p.status) => (p.error && !p.status ? p.error : String(shown));
const blank = (s) => s == null || String(s).trim() === "";

function linkSources(pages) {
  const sources = new Map();
  for (const p of pages) {
    for (const link of p.links ?? []) {
      if (!sources.has(link)) sources.set(link, []);
      sources.get(link).push(p.url);
    }
  }
  return sources;
}

function duplicates(pages, field, type) {
  const groups = Map.groupBy(pages.filter((p) => !blank(p[field])), (p) => p[field]);
  return [...groups]
    .filter(([, group]) => group.length > 1)
    .map(([value, group]) => {
      const urls = group.map((p) => p.url).sort();
      return issue(type, { url: urls[0], urls, detail: value });
    });
}

export function whyNotIndexable(p) {
  if (p.blockedByRobots) return "blocked by robots.txt";
  if (p.redirects?.length) return `redirects (${p.status})`;
  if (p.status !== 200) return p.error && !p.status ? p.error : `status ${p.status}`;
  if (p.noindex) return "noindex";
  if (p.canonical && p.canonical !== p.url) return `canonicalised to ${p.canonical}`;
  return null;
}

export function audit(result) {
  const pages = result.pages ?? [];
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const sources = linkSources(pages);
  const content = pages.filter(parsed);
  const out = [];

  // links
  for (const p of pages) {
    if (p.blockedByRobots || p.redirectLoop) continue;
    // Only linked URLs count as broken links; a canonical-only target has its own check.
    const linked = sources.has(p.url) || p.url === result.startUrl;
    const status = p.redirects?.length ? p.finalStatus : p.status;
    if (linked && (isBroken(status) || p.tooManyRedirects)) {
      out.push(issue("broken-internal-link", { url: p.url, detail: p.tooManyRedirects ? "too many redirects" : statusText(p), sources: sources.get(p.url) ?? [] }));
    }
  }
  for (const e of result.external ?? []) {
    if (e.redirectLoop) {
      out.push(issue("redirect-loop", { url: e.url, detail: e.redirects.map((h) => h.url).join(" → ") + " → " + e.redirects.at(-1).location, sources: sources.get(e.url) ?? [] }));
    } else if (isBroken(e.finalStatus ?? e.status)) {
      out.push(issue("broken-external-link", { url: e.url, detail: statusText(e, e.finalStatus ?? e.status), sources: sources.get(e.url) ?? [] }));
    }
  }

  // redirects
  for (const p of pages) {
    const hops = p.redirects ?? [];
    const path = hops.map((h) => `${h.url} (${h.status})`).join(" → ") + (hops.length ? " → " + hops.at(-1).location : "");
    if (p.redirectLoop) out.push(issue("redirect-loop", { url: p.url, detail: path, sources: sources.get(p.url) ?? [] }));
    else if (hops.length >= 2) out.push(issue("redirect-chain", { url: p.url, detail: `${hops.length} hops: ${path}` }));
  }

  // titles, descriptions, headings
  for (const p of content) {
    if (blank(p.title)) out.push(issue("missing-title", { url: p.url, detail: "" }));
    else if (p.title.length > TITLE_MAX) out.push(issue("title-too-long", { url: p.url, detail: `${p.title.length} characters: ${p.title}` }));
    if (blank(p.metaDescription)) out.push(issue("missing-meta-description", { url: p.url, detail: "" }));
    else if (p.metaDescription.length > DESCRIPTION_MAX) {
      out.push(issue("meta-description-too-long", { url: p.url, detail: `${p.metaDescription.length} characters` }));
    }
    const h1s = p.h1s ?? [];
    if (!h1s.length) out.push(issue("missing-h1", { url: p.url, detail: "" }));
    else if (h1s.length > 1) out.push(issue("multiple-h1", { url: p.url, detail: h1s.join(" | ") }));
    if (p.noindex) out.push(issue("noindex", { url: p.url, detail: [p.metaRobots && `meta: ${p.metaRobots}`, p.xRobotsTag && `X-Robots-Tag: ${p.xRobotsTag}`].filter(Boolean).join("; ") }));
    if (p.imagesMissingAlt?.length) {
      const n = p.imagesMissingAlt.length;
      out.push(issue("image-missing-alt", { url: p.url, detail: `${n} image${n === 1 ? "" : "s"}: ${p.imagesMissingAlt.join(", ")}` }));
    }
  }
  out.push(...duplicates(content, "title", "duplicate-title"));
  out.push(...duplicates(content, "metaDescription", "duplicate-meta-description"));

  // canonicals
  for (const p of content) {
    if (!p.canonical || p.canonical === p.url) continue;
    const target = byUrl.get(p.canonical);
    if (!target || target.blockedByRobots) continue;
    if (target.redirects?.length) out.push(issue("canonical-to-redirect", { url: p.url, detail: `${p.canonical} (${target.status})` }));
    else if (isBroken(target.status)) out.push(issue("canonical-to-error", { url: p.url, detail: `${p.canonical} (${statusText(target)})` }));
    else if (target.noindex) out.push(issue("canonical-to-noindex", { url: p.url, detail: p.canonical }));
  }

  // sitemaps
  for (const url of result.sitemaps?.urls ?? []) {
    const p = byUrl.get(url);
    if (!p) {
      out.push(issue("sitemap-orphan", { url, detail: "" }));
      continue;
    }
    const why = whyNotIndexable(p);
    if (why) out.push(issue("sitemap-non-indexable", { url, detail: why }));
  }

  return out.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || compareUrls(a, b));
}
