/** Page chrome for the admin: one stylesheet, one layout, shared bits. */
import { escapeHtml } from './util.js'

/**
 * Colour roles come from a validated categorical palette (5 slots, checked for
 * CVD separation and contrast in both modes). Dark is a selected set of steps
 * for the dark surface, not an automatic inversion.
 */
const CSS = `
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb;
  --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,.10); --wash: rgba(11,11,11,.03);
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; --series-4: #eda100; --series-5: #e87ba4;
  --spark-dim: #86b6ef;
  --good: #0ca30c; --warning: #fab219; --critical: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19;
    --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,.10); --wash: rgba(255,255,255,.04);
    --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500; --series-5: #d55181;
    --spark-dim: #1c5cab;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19;
  --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,.10); --wash: rgba(255,255,255,.04);
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500; --series-5: #d55181;
  --spark-dim: #1c5cab;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--series-1); }
.wrap { max-width: 1080px; margin: 0 auto; padding: 24px 20px 80px; }
header.top { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
header.top h1 { font-size: 17px; font-weight: 600; margin: 0; letter-spacing: -.01em; }
header.top .host { color: var(--muted); font-size: 13px; }
header.top .spacer { flex: 1; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
.card > h2 { font-size: 13px; font-weight: 600; color: var(--ink-2); margin: 0 0 2px; letter-spacing: .01em; }
.card > h2 + .sub { color: var(--muted); font-size: 12px; margin: 0 0 14px; }
.filters { display: flex; gap: 6px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.filters .label { color: var(--muted); font-size: 12px; margin-right: 4px; }
.filters a { display: inline-block; padding: 4px 10px; border-radius: 999px; text-decoration: none;
  color: var(--ink-2); border: 1px solid var(--border); font-size: 12px; }
.filters a[aria-current="true"] { background: var(--ink); color: var(--page); border-color: var(--ink); }
.hero { display: flex; gap: 28px; align-items: flex-start; flex-wrap: wrap; }
.hero .figure { min-width: 150px; }
.hero .figure .value { font-size: 48px; line-height: 1.05; font-weight: 600; letter-spacing: -.02em; }
.hero .figure .label { color: var(--ink-2); font-size: 13px; margin-top: 4px; }
.hero .plot { flex: 1 1 460px; min-width: 300px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.tile .label { color: var(--ink-2); font-size: 12px; }
.tile .value { font-size: 26px; font-weight: 600; letter-spacing: -.01em; margin-top: 2px; }
.tile .note { color: var(--muted); font-size: 12px; margin-top: 2px; }
.chart { width: 100%; height: auto; display: block; overflow: visible; }
.chart .grid { stroke: var(--grid); stroke-width: 1; }
.chart .axis { stroke: var(--axis); stroke-width: 1; }
.chart .col { fill: var(--series-1); }
.chart .hit { fill: transparent; }
.chart g:hover .col { opacity: .78; }
.chart .tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.chart .value { fill: var(--ink-2); font-size: 11px; font-weight: 600; }
.sparkline { width: 104px; height: 30px; display: block; }
.sparkline .spark { fill: var(--spark-dim); }
.sparkline .spark-now { fill: var(--series-1); }
.spark-empty { color: var(--muted); }
.stack { display: flex; height: 24px; border-radius: 4px; overflow: hidden; gap: 2px; background: var(--surface); }
.stack .seg:first-child { border-radius: 4px 0 0 4px; }
.stack .seg:last-child { border-radius: 0 4px 4px 0; }
.stack .seg:only-child { border-radius: 4px; }
ul.legend { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
ul.legend li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
ul.legend .swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
ul.legend .legend-label { color: var(--ink); }
ul.legend .legend-value { margin-left: auto; color: var(--ink-2); font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
thead th { color: var(--muted); font-weight: 500; font-size: 12px; border-bottom: 1px solid var(--axis); }
tbody tr:last-child td, tbody tr:last-child th { border-bottom: none; }
tbody tr:hover { background: var(--wash); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.pct, th.pct { color: var(--ink-2); width: 62px; }
table.bars th { font-weight: 400; color: var(--ink); white-space: nowrap; width: 1%; }
table.bars .bar-cell { width: 100%; padding-right: 16px; }
table.bars .bar { display: block; height: 14px; min-width: 2px; background: var(--series-1); border-radius: 0 4px 4px 0; }
.scroll { overflow-x: auto; }
.slug { font-weight: 600; text-decoration: none; }
.dest { color: var(--ink-2); display: inline-block; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--border); color: var(--ink-2); white-space: nowrap; }
.pill.active { color: var(--good); border-color: var(--good); }
.pill.expired, .pill.capped { color: var(--critical); border-color: var(--critical); }
.pill.disabled { color: var(--muted); }
.empty { color: var(--muted); font-size: 13px; margin: 8px 0; }
form.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; align-items: start; }
form.grid .actions { grid-column: 1 / -1; }
label.field { display: block; font-size: 12px; color: var(--ink-2); }
label.field span { display: block; margin-bottom: 4px; }
label.field .hint { color: var(--muted); font-size: 11px; margin: 4px 0 0; }
input[type=text], input[type=url], input[type=number], input[type=password], input[type=datetime-local] {
  width: 100%; padding: 8px 10px; border: 1px solid var(--axis); border-radius: 7px;
  background: var(--surface); color: var(--ink); font: inherit; font-size: 13px; }
input:focus-visible, button:focus-visible, a:focus-visible, summary:focus-visible {
  outline: 2px solid var(--series-1); outline-offset: 2px; }
button { font: inherit; font-size: 13px; padding: 8px 14px; border-radius: 7px; border: 1px solid var(--ink);
  background: var(--ink); color: var(--page); cursor: pointer; }
button.ghost { background: transparent; color: var(--ink-2); border-color: var(--axis); }
button.danger { background: transparent; color: var(--critical); border-color: var(--critical); }
.row-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.flash { border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; border: 1px solid; }
.flash.err { color: var(--critical); border-color: var(--critical); background: color-mix(in srgb, var(--critical) 8%, transparent); }
.flash.ok { color: var(--good); border-color: var(--good); background: color-mix(in srgb, var(--good) 8%, transparent); }
details.tableview { margin-top: 14px; }
details.tableview summary { cursor: pointer; color: var(--ink-2); font-size: 12px; }
details.tableview .scroll { margin-top: 10px; max-height: 280px; overflow-y: auto; }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
.two .card { margin: 0; align-self: start; }
.qr-panel { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
.qr-panel img { width: 148px; height: 148px; border-radius: 8px; border: 1px solid var(--border); background: #fff; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.login { max-width: 340px; margin: 14vh auto; }
.login .card { margin-bottom: 0; }
.login h1 { font-size: 16px; margin: 0 0 4px; }
.login p.sub { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
.login button { width: 100%; margin-top: 14px; }
`

export function layout (title, body, { host = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<title>${escapeHtml(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`
}

export const flash = (url) => {
  const error = url.searchParams.get('err')
  const ok = url.searchParams.get('ok')
  if (error) return `<p class="flash err">${escapeHtml(error)}</p>`
  if (ok) return `<p class="flash ok">${escapeHtml(ok)}</p>`
  return ''
}

export const filterRow = (base, days, ranges) =>
  `<nav class="filters" aria-label="Date range"><span class="label">Range</span>` +
  ranges.map((n) => `<a href="${base}?days=${n}"${n === days ? ' aria-current="true"' : ''}>Last ${n} days</a>`).join('') +
  `</nav>`
