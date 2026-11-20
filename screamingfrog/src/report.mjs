// The report: one self-contained HTML file.
//
//   renderReport(result, issues, options) -> string
//     options.linkUrls     (default true)  link crawled URLs; false shows them as text
//     options.showTimings  (default true)  false hides response times
//     options.generatedAt  (default none)  a date string for the header
//   relabel(result, { [realOrigin]: shownOrigin }) -> copy of result with origins swapped
//
// No script and no external requests. All CSS sits in one <style> whose
// sha256 is the only style-src in the page's own CSP meta, and there are no
// style="" attributes. Every value that came from the crawl goes through esc().

import { createHash } from "node:crypto";
import { ISSUE_TYPES, whyNotIndexable } from "./audit.mjs";
import { compareUrls } from "./url.mjs";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("base64");

/** Deep copy of `value` with every origin key in `map` swapped for its value, inside every string. */
export function relabel(value, map) {
  const pairs = Object.entries(map);
  const walk = (v) => {
    if (typeof v === "string") return pairs.reduce((s, [from, to]) => s.replaceAll(from, to), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

const CSS = `
:root{--bg:#f7f6f2;--fg:#1d1c19;--muted:#6b675e;--line:#dcd8cc;--card:#fff;--accent:#2f8f5b;
--error:#c2410c;--warning:#a16207;--notice:#47669e;--chip:#efece3}
@media (prefers-color-scheme:dark){:root{--bg:#141412;--fg:#ecebe6;--muted:#a19d92;--line:#34322c;
--card:#1c1b18;--accent:#5fc48c;--error:#fb8a5c;--warning:#e7b84b;--notice:#8fb0ec;--chip:#2a2924}}
*{box-sizing:border-box}
html{color-scheme:light dark}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;margin:0 0 4px;letter-spacing:-.01em}
h1 .mark{color:var(--accent)}
h2{font-size:20px;margin:40px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:16px;margin:0}
a{color:var(--accent)}
code,.url{font:13px/1.4 ui-monospace,"SF Mono",Menlo,Consolas,monospace;overflow-wrap:anywhere}
.lede{color:var(--muted);margin:0 0 20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.stat b{display:block;font-size:24px}
.stat span{color:var(--muted);font-size:13px}
.stat.error b{color:var(--error)}.stat.warning b{color:var(--warning)}.stat.notice b{color:var(--notice)}
.meta{color:var(--muted);font-size:13px;margin:4px 0}
.sev{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:1px 8px;background:var(--chip);text-transform:uppercase;letter-spacing:.04em}
.sev.error{color:var(--error)}.sev.warning{color:var(--warning)}.sev.notice{color:var(--notice)}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;white-space:nowrap}
td.status{font-weight:600;white-space:nowrap}
td.s2{color:var(--accent)}td.s3{color:var(--warning)}td.s4,td.s5,td.s0{color:var(--error)}td.sx{color:var(--muted)}
tr.zero td{color:var(--muted)}
.issue{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 14px}
.issue header{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.issue .count{color:var(--muted)}
.issue p.help{color:var(--muted);margin:6px 0 10px;font-size:14px}
.issue ul{margin:0;padding:0;list-style:none}
.issue li{padding:8px 0;border-top:1px solid var(--line)}
.issue li .detail{display:block;color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.issue li .from{display:block;font-size:13px;color:var(--muted)}
.ok{color:var(--muted)}
footer{margin-top:48px;color:var(--muted);font-size:13px}
`.trim();

const SEVERITIES = ["error", "warning", "notice"];

const formatSize = (n) => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const statusKey = (p) => (p.blockedByRobots || p.status == null ? Infinity : p.status);

export function renderReport(result, issues, options = {}) {
  const { linkUrls = true, showTimings = true, generatedAt = null } = options;
  const url = (u) =>
    linkUrls && /^https?:\/\//i.test(u ?? "")
      ? `<a class="url" href="${esc(u)}" rel="nofollow noopener noreferrer">${esc(u)}</a>`
      : `<span class="url">${esc(u)}</span>`;

  const pages = [...result.pages].sort((a, b) => statusKey(a) - statusKey(b) || compareUrls(a, b));
  const byType = new Map(Object.keys(ISSUE_TYPES).map((t) => [t, []]));
  for (const i of issues) byType.get(i.type)?.push(i);
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, issues.filter((i) => i.severity === s).length]));
  const crawled = result.pages.filter((p) => !p.blockedByRobots).length;
  const blocked = result.pages.length - crawled;

  const stats = [
    ["", crawled, "pages crawled"],
    ["", blocked, "blocked by robots.txt"],
    ["", result.external.length, "external links checked"],
    ...SEVERITIES.map((s) => [s, bySeverity[s], `${s}${bySeverity[s] === 1 ? "" : "s"}`]),
  ]
    .map(([cls, n, label]) => `<div class="stat${cls ? " " + cls : ""}"><b>${n}</b><span>${esc(label)}</span></div>`)
    .join("");

  const limits = result.limits ?? {};
  const meta = [
    `Start URL: ${url(result.startUrl)}`,
    `User agent: <code>${esc(result.userAgent)}</code>`,
    `Limits: ${esc(limits.maxPages)} pages, depth ${Number.isFinite(limits.maxDepth) ? esc(limits.maxDepth) : "unlimited"}, ${esc(formatSize(limits.maxBodySize))} per page`,
    `robots.txt: ${result.robots.status ? `HTTP ${esc(result.robots.status)}` : "unreachable"}${result.robots.note ? ` (${esc(result.robots.note)})` : ""}`,
    `Sitemaps: ${result.sitemaps.files.length} file${result.sitemaps.files.length === 1 ? "" : "s"}, ${result.sitemaps.urls.length} URLs on this site`,
    generatedAt ? `Generated: ${esc(generatedAt)}` : "",
  ]
    .filter(Boolean)
    .map((line) => `<p class="meta">${line}</p>`)
    .join("\n");

  const summaryRows = [...byType]
    .map(([type, list]) => {
      const t = ISSUE_TYPES[type];
      const name = list.length ? `<a href="#issue-${type}">${esc(t.label)}</a>` : esc(t.label);
      return `<tr${list.length ? "" : ' class="zero"'}><td>${name}</td><td><span class="sev ${t.severity}">${t.severity}</span></td><td class="num">${list.length}</td></tr>`;
    })
    .join("\n");

  const issueSections = [...byType]
    .filter(([, list]) => list.length)
    .map(([type, list]) => {
      const t = ISSUE_TYPES[type];
      const items = list
        .map((i) => {
          const target = i.urls ? i.urls.map(url).join("<br>") : url(i.url);
          const detail = i.detail ? `<span class="detail">${esc(i.detail)}</span>` : "";
          const from = i.sources?.length ? `<span class="from">linked from ${i.sources.map(url).join(", ")}</span>` : "";
          return `<li>${target}${detail}${from}</li>`;
        })
        .join("\n");
      return `<section class="issue" id="issue-${type}">
<header><h3>${esc(t.label)}</h3><span class="sev ${t.severity}">${t.severity}</span><span class="count">${list.length}</span></header>
<p class="help">${esc(t.help)}</p>
<ul>
${items}
</ul>
</section>`;
    })
    .join("\n");

  const pageRows = pages
    .map((p) => {
      const status = p.blockedByRobots ? "blocked" : p.status === 0 ? "failed" : p.status;
      const cls = p.blockedByRobots ? "sx" : `s${String(p.status ?? "x")[0]}`;
      const target = p.redirects?.length
        ? `<span class="detail">→ ${p.redirectLoop ? "loop" : url(p.finalUrl)} (${p.redirects.length} hop${p.redirects.length === 1 ? "" : "s"})</span>`
        : "";
      const why = p.blockedByRobots || p.status ? whyNotIndexable(p) : p.error;
      const time = showTimings && p.timeMs != null ? `${esc(p.timeMs)} ms` : "—";
      return `<tr><td class="status ${cls}">${esc(status)}</td><td>${url(p.url)}${target ? "<br>" + target : ""}</td><td class="num">${esc(p.depth)}</td><td class="num">${esc(formatSize(p.size))}</td><td class="num">${time}</td><td>${p.title == null ? "" : esc(p.title)}</td><td class="num">${p.h1s ? p.h1s.length : ""}</td><td>${why ? esc(why) : '<span class="ok">yes</span>'}</td></tr>`;
    })
    .join("\n");

  const externalRows = [...result.external]
    .sort(compareUrls)
    .map((e) => {
      const status = e.finalStatus ?? e.status;
      return `<tr><td class="status s${String(status)[0]}">${status ? esc(status) : "failed"}</td><td>${url(e.url)}</td><td>${esc(e.error ?? (e.redirects?.length ? `${e.redirects.length} redirect${e.redirects.length === 1 ? "" : "s"}` : ""))}</td></tr>`;
    })
    .join("\n");

  const sitemapRows = result.sitemaps.files
    .map((f) => `<tr><td class="status s${String(f.status)[0]}">${f.status ? esc(f.status) : "failed"}</td><td>${url(f.url)}</td><td>${esc(f.kind)}</td><td class="num">${esc(f.count)}</td></tr>`)
    .join("\n");

  const csp = `default-src 'none'; img-src 'self'; style-src 'sha256-${sha256(CSS)}'; base-uri 'none'; form-action 'none'`;
  const title = `sitecrawl report: ${result.startUrl}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main id="main">
<h1><span class="mark">sitecrawl</span> report</h1>
<p class="lede">An SEO crawl of ${esc(result.origin)}: what was found, what is broken, and every page visited.</p>
${meta}
<div class="stats">${stats}</div>

<h2 id="summary">Summary</h2>
<div class="scroll"><table>
<thead><tr><th>Check</th><th>Severity</th><th class="num">Found</th></tr></thead>
<tbody>
${summaryRows}
</tbody>
</table></div>

<h2 id="issues">Issues</h2>
${issueSections || '<p class="ok">No issues found.</p>'}

<h2 id="pages">Pages</h2>
<div class="scroll"><table>
<thead><tr><th>Status</th><th>URL</th><th class="num">Depth</th><th class="num">Size</th><th class="num">Time</th><th>Title</th><th class="num">H1s</th><th>Indexable</th></tr></thead>
<tbody>
${pageRows}
</tbody>
</table></div>

<h2 id="external">External links</h2>
${externalRows ? `<div class="scroll"><table>
<thead><tr><th>Status</th><th>URL</th><th>Note</th></tr></thead>
<tbody>
${externalRows}
</tbody>
</table></div>` : '<p class="ok">No external links checked.</p>'}

<h2 id="sitemaps">Sitemaps</h2>
${sitemapRows ? `<div class="scroll"><table>
<thead><tr><th>Status</th><th>URL</th><th>Kind</th><th class="num">Entries</th></tr></thead>
<tbody>
${sitemapRows}
</tbody>
</table></div>` : '<p class="ok">No sitemap found.</p>'}

<footer>Made with sitecrawl. This file loads nothing and runs no script.</footer>
</main>
</body>
</html>
`;
}
