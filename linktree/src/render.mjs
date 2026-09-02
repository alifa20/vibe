import { createHash } from 'node:crypto';

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Design tokens + reset, shared by the index page and /stats. */
export const TOKENS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0}
:root{
  color-scheme:light;
  --paper:#e8eaee;
  --raise:#fbfbfd;
  --ink:#0f1319;
  --soft:#616a79;
  --rule:#d3d7df;
  --leader:#c2c7d2;
  --accent:#2440e8;
  --wash:rgba(36,64,232,.07);
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",ui-serif,Georgia,serif;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --emoji:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    color-scheme:dark;
    --paper:#0a0c10;
    --raise:#171b23;
    --ink:#e7eaef;
    --soft:#8b94a3;
    --rule:#232833;
    --leader:#333c4d;
    --accent:#93a6ff;
    --wash:rgba(147,166,255,.09);
  }
}
body{
  background:var(--paper);
  color:var(--ink);
  font-family:var(--sans);
  font-size:15px;
  line-height:1.55;
  -webkit-font-smoothing:antialiased;
  display:flex;
  justify-content:center;
  padding:2.75rem 1.25rem 3.5rem;
  padding-top:max(2.75rem,env(safe-area-inset-top));
}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
`;

const PAGE_CSS = `
.col{width:100%;max-width:33rem}

/* --- identity --- */
.id{display:flex;flex-direction:column;gap:1.15rem;margin-bottom:2.5rem}
.avatar{
  width:4.5rem;height:4.5rem;border-radius:14px;display:block;object-fit:cover;
  background:var(--raise);border:1px solid var(--rule);
}
.name{
  margin:0;font-family:var(--serif);font-weight:500;
  font-size:clamp(2.1rem,10vw,2.7rem);line-height:1.04;letter-spacing:-.022em;
}
.bio{margin:.6rem 0 0;color:var(--soft);font-size:.97rem;max-width:29rem;text-wrap:pretty}

/* --- index header rule --- */
.eyebrow{
  display:flex;align-items:baseline;justify-content:space-between;gap:1rem;
  font-family:var(--mono);font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;
  color:var(--soft);padding-bottom:.6rem;border-bottom:1px solid var(--rule);
}
.eyebrow b{font-weight:400;font-variant-numeric:tabular-nums}

/* --- the index --- */
.index{display:flex;flex-direction:column}
.row{
  position:relative;display:flex;align-items:center;gap:.7rem;
  padding:.8rem .8rem;margin:0 -.8rem;border-radius:11px;
  color:inherit;text-decoration:none;
  transition:background-color .18s ease;
}
.row + .row{box-shadow:inset 0 1px 0 var(--rule)}
.row::before{
  content:"";position:absolute;left:0;top:.5rem;bottom:.5rem;width:2px;border-radius:2px;
  background:var(--accent);opacity:0;transform:scaleY(.35);
  transition:opacity .18s ease,transform .18s ease;
}
.plate{
  flex:none;width:2.2rem;height:2.2rem;border-radius:9px;
  display:grid;place-items:center;line-height:1;
  background:var(--raise);border:1px solid var(--rule);
  font-family:var(--emoji);font-size:1.05rem;
  transition:border-color .18s ease;
}
.plate.initial{font-family:var(--mono);font-size:.8rem;color:var(--soft);text-transform:uppercase}
.label{
  flex:0 1 auto;min-width:0;font-weight:500;font-size:.97rem;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.leader{
  flex:1 1 auto;min-width:.6rem;height:2px;color:var(--leader);
  transform:translateY(4px);
  background-image:radial-gradient(circle at 1px 1px,currentColor 1px,transparent 1.15px);
  background-size:7px 2px;
  transition:color .18s ease;
}
.host{
  flex:none;font-family:var(--mono);font-size:.7rem;letter-spacing:.01em;
  color:var(--soft);white-space:nowrap;transition:color .18s ease;
}
.arrow{flex:none;color:var(--soft);transition:transform .18s ease,color .18s ease}

.row:hover{background:var(--wash)}
.row:hover::before,.row:focus-visible::before{opacity:1;transform:scaleY(1)}
.row:hover .leader{color:var(--accent)}
.row:hover .host,.row:hover .arrow{color:var(--accent)}
.row:hover .arrow{transform:translate(2px,-2px)}
.row:hover .plate{border-color:var(--accent)}
.row:focus-visible{outline:2px solid var(--accent);outline-offset:0;background:var(--wash)}
.row:active{background:var(--wash);transform:translateY(1px)}

/* --- foot --- */
.foot{
  display:flex;flex-wrap:wrap;justify-content:space-between;gap:.4rem 1.25rem;
  margin-top:2.5rem;padding-top:1.1rem;border-top:1px solid var(--rule);
  font-family:var(--mono);font-size:.68rem;letter-spacing:.05em;color:var(--soft);
}
.foot a{color:inherit;text-decoration:none;border-bottom:1px solid var(--rule)}
.foot a:hover{color:var(--accent);border-bottom-color:var(--accent)}

/* --- one orchestrated entrance --- */
@media (prefers-reduced-motion:no-preference){
  .id,.eyebrow,.row,.foot{
    animation:rise .55s cubic-bezier(.22,.85,.3,1) backwards;
    animation-delay:calc(var(--i,0) * 45ms);
  }
  @keyframes rise{from{opacity:0;transform:translateY(9px)}}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
}
`;

const ARROW = '<svg class="arrow" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">' +
  '<path d="M3.2 8.8 8.8 3.2M4.4 3.2H8.8V7.6" fill="none" stroke="currentColor" ' +
  'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderRow(link, i) {
  const plate = link.emoji
    ? `<span class="plate" aria-hidden="true">${esc(link.emoji)}</span>`
    : `<span class="plate initial" aria-hidden="true">${esc(link.title.trim()[0] || '·')}</span>`;
  return (
    `<a class="row" style="--i:${i}" href="/go/${esc(link.slug)}" rel="noopener">` +
    plate +
    `<span class="label">${esc(link.title)}</span>` +
    `<span class="leader" aria-hidden="true"></span>` +
    `<span class="host">${esc(link.host)}</span>` +
    ARROW +
    `</a>`
  );
}

/** Short content hash so social scrapers refetch og.png when links.json changes. */
export function contentVersion(site) {
  return createHash('sha256')
    .update(JSON.stringify([site.name, site.bio, site.avatar, site.links]))
    .digest('hex')
    .slice(0, 8);
}

/**
 * Render the full index page.
 * Returns the HTML plus the CSP hash for its one inline <style> block.
 */
export function renderPage(site, { origin = '' } = {}) {
  const base = (site.siteUrl || origin || '').replace(/\/+$/, '');
  const abs = (p) => (base ? base + p : p);
  const v = contentVersion(site);
  const title = `${site.name} — links`;
  const desc = site.bio || `Links from ${site.name}.`;
  const css = TOKENS + PAGE_CSS;
  const n = site.links.length;

  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    base ? `<link rel="canonical" href="${esc(base)}/">` : '',
    `<meta property="og:type" content="profile">`,
    `<meta property="og:site_name" content="${esc(site.name)}">`,
    `<meta property="og:title" content="${esc(site.name)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    base ? `<meta property="og:url" content="${esc(base)}/">` : '',
    `<meta property="og:image" content="${esc(abs(`/og.png?v=${v}`))}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(`${site.name} — an index of ${n} link${n === 1 ? '' : 's'}`)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(site.name)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(abs(`/og.png?v=${v}`))}">`,
    `<meta name="theme-color" content="#e8eaee" media="(prefers-color-scheme:light)">`,
    `<meta name="theme-color" content="#0a0c10" media="(prefers-color-scheme:dark)">`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
    `<style>${css}</style>`,
  ].filter(Boolean).join('\n');

  const html =
`<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body>
<main class="col">
  <header class="id" style="--i:0">
    ${site.avatar ? `<img class="avatar" src="${esc(site.avatar)}" width="72" height="72" alt="" decoding="async">` : ''}
    <div>
      <h1 class="name">${esc(site.name)}</h1>
      ${site.bio ? `<p class="bio">${esc(site.bio)}</p>` : ''}
    </div>
  </header>

  <div class="eyebrow" style="--i:1"><span>Index</span><b>${String(n).padStart(2, '0')} entries</b></div>

  <nav class="index" aria-label="Links">
${site.links.map((l, i) => '    ' + renderRow(l, i + 2)).join('\n')}
  </nav>

  <footer class="foot" style="--i:${n + 2}">
    <span>${esc(base ? base.replace(/^https?:\/\//, '') : 'self-hosted')}</span>
    <span>No third-party trackers</span>
  </footer>
</main>
</body>
</html>
`;

  const styleHash = 'sha256-' + createHash('sha256').update(css).digest('base64');
  return { html, styleHash, version: v };
}
