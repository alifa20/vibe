import { esc } from './render.mjs';

/**
 * 1200x630 social card, rendered by headless Chrome into public/og.png.
 * Deliberately uses the dark palette: it holds up in both light and dark feeds.
 * Hardcoded tokens, no prefers-color-scheme — the screenshot has no viewer.
 */
export function renderOgHtml(site, { rows = 5 } = {}) {
  const shown = site.links.slice(0, rows);
  const rest = site.links.length - shown.length;
  const n = site.links.length;

  const row = (l) => `
    <li class="row">
      <span class="plate">${l.emoji ? esc(l.emoji) : esc((l.title.trim()[0] || '·').toUpperCase())}</span>
      <span class="label">${esc(l.title)}</span>
      <span class="leader"></span>
      <span class="host">${esc(l.host)}</span>
    </li>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --paper:#0a0c10;--raise:#171b23;--ink:#e7eaef;--soft:#8b94a3;--rule:#262c38;--leader:#39445a;--accent:#93a6ff;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,ui-serif,Georgia,serif;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --emoji:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;
}
html,body{width:1200px;height:630px}
body{
  background:var(--paper);color:var(--ink);font-family:var(--sans);
  display:grid;grid-template-columns:1fr 1fr;gap:72px;
  padding:70px 72px;align-content:center;
}
.id{display:flex;flex-direction:column;justify-content:center;min-width:0}
.avatar{width:104px;height:104px;border-radius:22px;object-fit:cover;
  background:var(--raise);border:1px solid var(--rule);margin-bottom:34px}
.name{font-family:var(--serif);font-weight:500;font-size:74px;line-height:1.02;letter-spacing:-.028em}
.bio{margin-top:22px;color:var(--soft);font-size:25px;line-height:1.5;max-width:24ch;
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.foot{margin-top:38px;font-family:var(--mono);font-size:17px;letter-spacing:.06em;color:var(--soft)}
.foot span{color:var(--accent)}

.index{display:flex;flex-direction:column;justify-content:center;min-width:0}
.eyebrow{display:flex;justify-content:space-between;align-items:baseline;
  font-family:var(--mono);font-size:16px;letter-spacing:.19em;text-transform:uppercase;color:var(--soft);
  padding-bottom:16px;border-bottom:1px solid var(--rule);margin-bottom:6px}
ul{list-style:none}
.row{display:flex;align-items:center;gap:18px;padding:19px 0;border-bottom:1px solid var(--rule)}
.row:last-child{border-bottom:0}
.plate{flex:none;width:44px;height:44px;border-radius:12px;display:flex;align-items:center;
  justify-content:center;background:var(--raise);border:1px solid var(--rule);
  font-family:var(--emoji);font-size:21px;line-height:1}
.label{flex:0 1 auto;min-width:0;font-size:24px;font-weight:500;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.leader{flex:1 1 auto;min-width:14px;height:3px;color:var(--leader);transform:translateY(6px);
  background-image:radial-gradient(circle at 1.5px 1.5px,currentColor 1.5px,transparent 1.7px);
  background-size:11px 3px}
.host{flex:none;font-family:var(--mono);font-size:17px;color:var(--soft);white-space:nowrap}
.more{margin-top:20px;font-family:var(--mono);font-size:16px;letter-spacing:.06em;color:var(--soft)}
</style></head>
<body>
  <div class="id">
    ${site.avatarData ? `<img class="avatar" src="${site.avatarData}" alt="">` : ''}
    <div class="name">${esc(site.name)}</div>
    ${site.bio ? `<div class="bio">${esc(site.bio)}</div>` : ''}
    <div class="foot">${esc(site.siteUrl ? site.siteUrl.replace(/^https?:\/\//, '') : 'links')} <span>↗</span></div>
  </div>
  <div class="index">
    <div class="eyebrow"><span>Index</span><span>${String(n).padStart(2, '0')} entries</span></div>
    <ul>${shown.map(row).join('')}</ul>
    ${rest > 0 ? `<div class="more">+ ${rest} more</div>` : ''}
  </div>
</body></html>`;
}

/** 180x180 apple-touch-icon: the same arrow as the index rows. */
export function renderIconHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:180px;height:180px}
body{background:#2440e8;display:grid;place-items:center}
svg{width:96px;height:96px}
</style></head><body>
<svg viewBox="0 0 24 24"><path d="M6.5 17.5 17.5 6.5M8.8 6.5h8.7v8.7" fill="none" stroke="#eef1ff"
  stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
</body></html>`;
}
