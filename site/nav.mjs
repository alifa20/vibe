// site/nav.mjs — the vibe nav strip: markup, style, injection and CSP patch.
// Pure functions, Node stdlib only. `manifest` is the object from hub.mjs loadManifest().
//
//   navStyle(manifest)                  -> string  exact CSS text of the strip's <style> (no tags)
//   styleHash(manifest)                 -> string  base64 sha256 of navStyle(manifest), for CSP
//   renderNav(manifest, slug, {skipTarget}) -> string  [skip link +] <nav class="vibe-nav">…</nav>
//                                          skipTarget is an element id; omit it for no skip link
//   injectNav(html, manifest, slug)     -> string  demo page with <style> before </head>, and
//                                          skip link + nav + <span id="vibe-skip"> as the first
//                                          children of <body>; also adds the style hash to a CSP
//                                          meta's style-src. Idempotent. Throws (naming the slug)
//                                          when the page has no </head> or <body>.
//   patchCsp(html, hash)                -> string  appends 'sha256-<hash>' to style-src in a CSP
//                                          meta; literal or &#39;-encoded quotes. Unchanged when
//                                          there is no CSP meta, no style-src, the hash is already
//                                          there, or style-src relies on 'unsafe-inline' alone
//                                          (adding a hash would switch unsafe-inline off).
//   ensureIconLink(html, href="./favicon.svg") -> string  adds <link rel="icon"> before </head>
//                                          when the page has none. The build decides when to call it.
//   esc(s)                              -> string  HTML-escape (& < > " ')
//
// Links are relative to a page at /<base>/<slug>/: hub "../", projects "../<slug>/".
// No inline style attributes and no script: personal-site's CSP blocks both.

import { createHash } from "node:crypto";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("base64");

export const SANS = '-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif';
export const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';

const find = (manifest, slug) => {
  const i = manifest.projects.findIndex((p) => p.slug === slug);
  if (i < 0) throw new Error(`nav: unknown project slug "${slug}"`);
  return i;
};

/** Exact CSS text for the strip. Same bytes every call for the same manifest. */
export function navStyle(manifest) {
  const colours = manifest.projects.map((p) => `.vibe-p-${p.slug}{--vibe-c:${p.color}}`).join("\n");
  return `
:root{--vibe-nav-h:56px}
.vibe-nav ~ #root{height:calc(100% - var(--vibe-nav-h))}
${colours}
.vibe-nav,.vibe-nav *,.vibe-nav *::before,.vibe-nav *::after,.vibe-skip,.vibe-skip-target{box-sizing:border-box;margin:0;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:inherit;font:inherit;line-height:1;letter-spacing:normal;text-transform:none;text-decoration:none;text-align:left;text-indent:0;float:none;list-style:none;min-height:0;max-width:none;transform:none;opacity:1;visibility:visible;-webkit-font-smoothing:antialiased}
.vibe-nav{--vibe-y:#ffd23f;--vibe-k:#121212;position:relative;display:flex;align-items:center;gap:6px;width:100%;height:var(--vibe-nav-h);padding:0 8px;background:var(--vibe-y);color:var(--vibe-k);border-bottom:3px solid var(--vibe-k);font:800 15px/1 ${SANS};white-space:nowrap;color-scheme:light;overflow:visible}
.vibe-nav a,.vibe-nav .vibe-sum{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;color:var(--vibe-k);cursor:pointer;transition:transform .12s,box-shadow .12s,background-color .12s}
.vibe-nav a:focus-visible,.vibe-nav .vibe-sum:focus-visible{outline:3px dashed var(--vibe-k);outline-offset:2px}
.vibe-nav .vibe-back{flex:none;gap:8px;padding:0 14px;background:var(--vibe-k);color:var(--vibe-y);border:2px solid var(--vibe-k);border-radius:999px}
.vibe-nav .vibe-back:hover{background:#fff;color:var(--vibe-k)}
.vibe-nav .vibe-crumb{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;padding:0 8px;font:700 13px/1 ${MONO}}
.vibe-nav .vibe-sw{display:flex;align-items:center;gap:6px;margin-left:auto;min-width:0}
.vibe-nav .vibe-step{flex:0 4 auto;min-width:44px;padding:0 10px;background:#fff;border:2px solid var(--vibe-k);box-shadow:3px 3px 0 var(--vibe-k);font-size:18px}
.vibe-nav .vibe-step:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--vibe-k)}
.vibe-nav .vibe-step:active{transform:translate(3px,3px);box-shadow:none}
.vibe-nav .vibe-lbl{min-width:0;max-width:130px;overflow:hidden;text-overflow:ellipsis;margin:0 6px;font:800 14px/1.2 ${SANS}}
.vibe-nav .vibe-details{display:flex;flex:0 1 auto;min-width:0}
.vibe-nav .vibe-sum{gap:8px;min-width:0;padding:0 14px;list-style:none;background:#fff;border:2px solid var(--vibe-k);border-radius:999px;box-shadow:3px 3px 0 var(--vibe-k)}
.vibe-nav .vibe-sum::-webkit-details-marker{display:none}
.vibe-nav .vibe-sum::marker{content:""}
.vibe-nav .vibe-sum:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--vibe-k)}
.vibe-nav .vibe-details[open] .vibe-sum{transform:translate(3px,3px);box-shadow:none}
.vibe-nav .vibe-dot{flex:none;width:14px;height:14px;border:2px solid var(--vibe-k);border-radius:50%;background:var(--vibe-c)}
.vibe-nav .vibe-nm{min-width:0;max-width:160px;overflow:hidden;text-overflow:ellipsis;line-height:1.2}
.vibe-nav .vibe-tri{flex:none;font-size:11px}
.vibe-nav .vibe-menu{position:absolute;top:calc(100% + 6px);right:8px;z-index:1000;width:330px;max-height:calc(100vh - 72px);overflow:auto;padding:10px;background:#fff;border:3px solid var(--vibe-k);box-shadow:6px 6px 0 var(--vibe-k);white-space:normal}
.vibe-nav .vibe-gh{padding:8px 4px 6px;font:800 11px/1 ${MONO};letter-spacing:.08em;color:#4b4740}
.vibe-nav .vibe-group{display:grid;gap:6px;margin:0 0 4px}
.vibe-nav .vibe-item{display:flex;justify-content:flex-start;gap:10px;width:100%;padding:0 10px;border:2px solid transparent;font-size:16px}
.vibe-nav .vibe-item:hover{border-color:var(--vibe-k)}
.vibe-nav .vibe-item[aria-current="page"]{background:var(--vibe-c);border-color:var(--vibe-k);box-shadow:3px 3px 0 var(--vibe-k)}
.vibe-nav .vibe-sq{flex:none;width:18px;height:18px;border:2px solid var(--vibe-k);background:var(--vibe-c)}
.vibe-nav .vibe-here{margin-left:auto;padding:5px 8px;border-radius:999px;background:var(--vibe-k);color:#fff;font:800 11px/1 ${MONO}}
.vibe-nav .vibe-mfoot{margin-top:8px;padding-top:8px;border-top:3px solid var(--vibe-k)}
.vibe-nav .vibe-src{display:flex;justify-content:space-between;width:100%;padding:0 10px;background:#fff3d6;border:2px solid var(--vibe-k);font:800 13px/1 ${MONO}}
.vibe-skip{position:absolute;top:6px;left:-10000px;z-index:1001;display:inline-flex;align-items:center;min-height:44px;padding:0 16px;background:#121212;color:#ffd23f;border:2px solid #ffd23f;border-radius:999px;font:800 15px/1 ${SANS};text-decoration:none;white-space:nowrap}
.vibe-skip:focus{left:8px;outline:3px dashed #121212;outline-offset:2px}
.vibe-skip-target{display:block;height:0;overflow:hidden;outline:none}
body:has(.prompter) .vibe-nav,body:has(.prompter) .vibe-nav *,body:has(.prompter) .vibe-skip{visibility:hidden}
@media (max-width:599.98px){.vibe-nav .vibe-crumb,.vibe-nav .vibe-lbl{display:none}.vibe-nav .vibe-nm{max-width:none}.vibe-nav .vibe-menu{left:8px;right:8px;width:auto}}
@media (prefers-reduced-motion:reduce){.vibe-nav a,.vibe-nav .vibe-sum,.vibe-nav a:hover,.vibe-nav a:active,.vibe-nav .vibe-sum:hover,.vibe-nav .vibe-details[open] .vibe-sum{transform:none;transition:box-shadow .12s}}
`;
}

/** base64 sha256 of the exact injected style text. */
export const styleHash = (manifest) => sha256(navStyle(manifest));

/** Skip link (optional) + the <nav> strip, for the page at /<base>/<currentSlug>/. */
export function renderNav(manifest, currentSlug, { skipTarget } = {}) {
  const ps = manifest.projects;
  const i = find(manifest, currentSlug);
  const cur = ps[i];
  const prev = ps[(i - 1 + ps.length) % ps.length];
  const next = ps[(i + 1) % ps.length];
  const href = (p) => `../${esc(p.slug)}/`;
  const repo = String(manifest.repo || "").replace(/\/+$/, "");

  const item = (p) =>
    `<li><a class="vibe-item vibe-p-${esc(p.slug)}" href="${href(p)}"${p.slug === cur.slug ? ' aria-current="page"' : ""}>` +
    `<span class="vibe-sq" aria-hidden="true"></span>${esc(p.name)}` +
    `${p.slug === cur.slug ? '<span class="vibe-here">you\'re here</span>' : ""}</a></li>`;
  const group = (id, label, list) =>
    list.length
      ? `<p class="vibe-gh" id="vibe-g-${id}">${label}</p><ul class="vibe-group" aria-labelledby="vibe-g-${id}">${list.map(item).join("")}</ul>`
      : "";

  const skip = skipTarget ? `<a class="vibe-skip" href="#${esc(skipTarget)}">skip to ${esc(cur.name)}</a>` : "";
  return (
    skip +
    `<nav class="vibe-nav" aria-label="vibe projects">` +
    `<a class="vibe-back" href="../">← vibe</a>` +
    `<span class="vibe-crumb">/ ${esc(cur.name)}</span>` +
    `<div class="vibe-sw">` +
    `<a class="vibe-step vibe-prev" href="${href(prev)}" aria-label="previous: ${esc(prev.name)}">‹<span class="vibe-lbl">${esc(prev.name)}</span></a>` +
    `<details class="vibe-details">` +
    `<summary class="vibe-sum vibe-p-${esc(cur.slug)}" aria-label="switch project, current: ${esc(cur.name)}">` +
    `<span class="vibe-dot" aria-hidden="true"></span><span class="vibe-nm">${esc(cur.name)}</span><span class="vibe-tri" aria-hidden="true">▾</span></summary>` +
    `<div class="vibe-menu">` +
    group("live", "live demos", ps.filter((p) => p.demo)) +
    group("srv", "run it yourself", ps.filter((p) => !p.demo)) +
    `<div class="vibe-mfoot"><a class="vibe-src" href="${esc(repo)}/tree/main/${esc(cur.slug)}"><span>source on github</span><span aria-hidden="true">↗</span></a></div>` +
    `</div></details>` +
    `<a class="vibe-step vibe-next" href="${href(next)}" aria-label="next: ${esc(next.name)}"><span class="vibe-lbl">${esc(next.name)}</span>›</a>` +
    `</div></nav>`
  );
}

/** Put the skip link, nav, skip target and style into a built demo page. */
export function injectNav(html, manifest, slug) {
  find(manifest, slug);
  if (html.includes('<nav class="vibe-nav"')) return html;
  const head = /<\/head\s*>/i.exec(html);
  const body = /<body\b[^>]*>/i.exec(html);
  if (!head || !body || body.index < head.index) {
    throw new Error(`injectNav(${slug}): page has no </head> followed by <body>`);
  }
  const css = navStyle(manifest);
  const style = `<style>${css}</style>`;
  const block =
    renderNav(manifest, slug, { skipTarget: "vibe-skip" }) +
    `<span id="vibe-skip" class="vibe-skip-target" tabindex="-1"></span>`;
  const bodyEnd = body.index + body[0].length;
  const out =
    html.slice(0, head.index) + style + html.slice(head.index, bodyEnd) + block + html.slice(bodyEnd);
  return patchCsp(out, sha256(css));
}

const QUOTE_FORMS = ["&#39;", "&#x27;", "&apos;"];

/** Append 'sha256-<hash>' to style-src in any CSP <meta>. */
export function patchCsp(html, hash) {
  return html.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!/http-equiv\s*=\s*["']?content-security-policy\b/i.test(tag)) return tag;
    return tag.replace(/(\bcontent\s*=\s*")([^"]*)(")/i, (all, pre, value, post) => {
      const form = QUOTE_FORMS.find((f) => value.toLowerCase().includes(f));
      const plain = form ? value.split(new RegExp(form, "gi")).join("'") : value;
      const re = /(^|;)(\s*style-src)(?![-\w])([^;]*)/i;
      const m = re.exec(plain);
      if (!m) return all;
      const sources = m[3];
      const token = `'sha256-${hash}'`;
      if (sources.includes(token)) return all;
      const hasHashOrNonce = /'(sha(256|384|512)-|nonce-)/i.test(sources);
      if (/'unsafe-inline'/i.test(sources) && !hasHashOrNonce) return all;
      const trimmed = sources.replace(/\s+$/, "");
      const trailing = sources.slice(trimmed.length);
      const patched =
        plain.slice(0, m.index) + m[1] + m[2] + trimmed + " " + token + trailing + plain.slice(m.index + m[0].length);
      return pre + (form ? patched.replace(/'/g, form) : patched) + post;
    });
  });
}

/** Add <link rel="icon"> before </head> when the page has no icon link. */
export function ensureIconLink(html, href = "./favicon.svg") {
  if (/<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bicon\b/i.test(html)) return html;
  const head = /<\/head\s*>/i.exec(html);
  if (!head) return html;
  const link = `<link rel="icon" href="${esc(href)}" type="image/svg+xml">`;
  return html.slice(0, head.index) + link + html.slice(head.index);
}
