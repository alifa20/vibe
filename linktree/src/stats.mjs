import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { TOKENS, esc } from './render.mjs';

/* ------------------------------------------------------------------ *
 * Log format: one tab-separated line per click, append-only.
 *   ts <TAB> slug <TAB> kind <TAB> ref <TAB> visitor <TAB> ua
 * Greppable on purpose:  cut -f2 data/clicks.log | sort | uniq -c | sort -rn
 * ------------------------------------------------------------------ */
export const LOG_COLUMNS = ['ts', 'slug', 'kind', 'ref', 'visitor', 'ua'];

const cell = (v) =>
  v == null || v === '' ? '-' : String(v).replace(/[\t\r\n]+/g, ' ').slice(0, 200);

export function logLine(fields) {
  return LOG_COLUMNS.map((k) => cell(fields[k])).join('\t') + '\n';
}

const BOT_RE =
  /bot\b|bot\/|crawl|spider|slurp|preview|monitor|scanner|curl\/|wget|python-requests|go-http-client|headless|facebookexternalhit|whatsapp|telegram|slack|discord|twitterbot|linkedinbot|embedly|quora link|redditbot|applebot|semrush|ahrefs|petal|yandex|duckduck|lighthouse|pingdom|uptime|node-fetch|axios|okhttp/i;

export const classifyUA = (ua) => (!ua || BOT_RE.test(ua) ? 'bot' : 'human');

/** Daily-rotating visitor key. Never stores or derives back to an IP. */
export function visitorKey(ip, salt, now = new Date()) {
  if (!ip) return '-';
  const day = now.toISOString().slice(0, 10);
  return createHash('sha256').update(`${salt}|${day}|${ip}`).digest('hex').slice(0, 12);
}

export async function readClicks(file, { since = 0 } = {}) {
  if (!existsSync(file)) return [];
  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const out = [];
  for await (const line of rl) {
    if (!line) continue;
    const p = line.split('\t');
    if (p.length < 2) continue;
    const t = Date.parse(p[0]);
    if (!Number.isFinite(t) || t < since) continue;
    out.push({ t, slug: p[1], kind: p[2] || 'human', ref: p[3] || '-', visitor: p[4] || '-', ua: p[5] || '-' });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */
const nf = new Intl.NumberFormat('en-US');
const localDay = (d) => new Date(d).toLocaleDateString('en-CA');

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const RANGES = [
  { days: 1, label: '24h' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 0, label: 'All' },
];

const STATS_CSS = `
/* charts get their own mark token: the interactive accent is too light for a fill in dark mode */
:root{--mark:#2440e8;--track:rgba(36,64,232,.13)}
@media (prefers-color-scheme:dark){:root{--mark:#7488f0;--track:rgba(116,136,240,.16)}}

body{display:block;padding:2.5rem 1.25rem 4rem}
.wrap{max-width:54rem;margin:0 auto}
.head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:1rem;margin-bottom:1.75rem}
h1{margin:0;font-family:var(--serif);font-weight:500;font-size:2.1rem;letter-spacing:-.02em;line-height:1.05}
.kicker{font-family:var(--mono);font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--soft);margin:0 0 .45rem}
.back{font-family:var(--mono);font-size:.7rem;color:var(--soft);text-decoration:none;border-bottom:1px solid var(--rule)}
.back:hover{color:var(--accent);border-bottom-color:var(--accent)}

/* filter row, above the charts */
.filters{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin-bottom:1.75rem}
.chip{
  font-family:var(--mono);font-size:.7rem;letter-spacing:.04em;text-decoration:none;
  color:var(--soft);background:var(--raise);border:1px solid var(--rule);
  padding:.34rem .6rem;border-radius:7px;transition:color .15s ease,border-color .15s ease;
}
.chip:hover{color:var(--ink);border-color:var(--soft)}
.chip[aria-current="true"]{color:var(--paper);background:var(--mark);border-color:var(--mark)}
.chip.alt{margin-left:auto}

/* stat tiles: hero numbers, no plot */
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:1px;background:var(--rule);
  border:1px solid var(--rule);border-radius:12px;overflow:hidden;margin-bottom:2rem}
.tile{background:var(--paper);padding:1rem 1.05rem}
.tile dt{font-family:var(--mono);font-size:.65rem;letter-spacing:.13em;text-transform:uppercase;color:var(--soft);margin:0 0 .4rem}
.tile dd{margin:0;font-size:1.6rem;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.tile dd small{font-size:.72rem;color:var(--soft);letter-spacing:0;font-variant-numeric:normal}

section{margin-bottom:2.25rem}
h2{font-family:var(--mono);font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--soft);
  font-weight:400;margin:0 0 .9rem;padding-bottom:.6rem;border-bottom:1px solid var(--rule)}

/* daily columns: 2px surface gap, 3px rounded data-end, anchored to the baseline */
.days{display:flex;align-items:flex-end;gap:2px;height:88px;margin-bottom:.5rem}
.day{flex:1 1 0;min-width:0;display:flex;align-items:flex-end;height:100%}
.day i{display:block;width:100%;background:var(--mark);border-radius:3px 3px 0 0;min-height:2px}
.day.zero i{background:var(--track);height:2px!important}
.axis{display:flex;justify-content:space-between;font-family:var(--mono);font-size:.65rem;color:var(--soft)}

/* per-link magnitude: single series, so one hue and direct labels */
table{width:100%;border-collapse:collapse;font-size:.9rem}
th{font-family:var(--mono);font-size:.63rem;letter-spacing:.12em;text-transform:uppercase;color:var(--soft);
  font-weight:400;text-align:left;padding:0 .6rem .55rem 0}
th.num,td.num{text-align:right;padding-right:0;font-variant-numeric:tabular-nums}
td{padding:.6rem .6rem .6rem 0;border-top:1px solid var(--rule);vertical-align:middle}
tbody tr:hover td{background:var(--wash)}
.link-cell{display:flex;align-items:center;gap:.55rem;min-width:0}
.dot{flex:none;width:1.5rem;height:1.5rem;border-radius:6px;display:grid;place-items:center;
  background:var(--raise);border:1px solid var(--rule);font-family:var(--emoji);font-size:.8rem}
.t{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slug{font-family:var(--mono);font-size:.65rem;color:var(--soft)}
.bar{width:100%;min-width:3rem;height:6px;background:var(--mark);border-radius:0 4px 4px 0}
.bar-cell{width:36%}
.pct{font-family:var(--mono);font-size:.7rem;color:var(--soft)}
.when{font-family:var(--mono);font-size:.7rem;color:var(--soft);white-space:nowrap}

.recent{font-family:var(--mono);font-size:.72rem;line-height:1.9;color:var(--soft);
  overflow-x:auto;white-space:pre;margin:0}
.recent b{color:var(--ink);font-weight:500}

.empty{color:var(--soft);font-size:.9rem;padding:1.25rem 0;border-top:1px solid var(--rule)}
.note{color:var(--soft);font-size:.75rem;font-family:var(--mono);margin-top:2.5rem;
  padding-top:1rem;border-top:1px solid var(--rule);line-height:1.8}
@media (max-width:34rem){.bar-cell{display:none}.hide-sm{display:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

/**
 * Render the /stats page. Everything is server-rendered; the page ships no script.
 */
export function renderStats({ site, clicks, days, includeBots, logPath }) {
  const shown = includeBots ? clicks : clicks.filter((c) => c.kind !== 'bot');
  const botCount = clicks.length - clicks.filter((c) => c.kind !== 'bot').length;

  const byslug = new Map();
  const visitors = new Set();
  const byDay = new Map();
  for (const c of shown) {
    const e = byslug.get(c.slug) || { clicks: 0, last: 0, visitors: new Set() };
    e.clicks++;
    e.last = Math.max(e.last, c.t);
    if (c.visitor !== '-') e.visitors.add(c.visitor);
    byslug.set(c.slug, e);
    if (c.visitor !== '-') visitors.add(c.visitor);
    const d = localDay(c.t);
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }

  // Known links first (so a zero-click link still shows), then retired slugs.
  const known = site.links.map((l) => ({ ...l, ...(byslug.get(l.slug) || { clicks: 0, last: 0, visitors: new Set() }) }));
  const retired = [...byslug.entries()]
    .filter(([s]) => !site.links.some((l) => l.slug === s))
    .map(([slug, e]) => ({ slug, title: slug, emoji: '', host: 'retired', ...e }));
  const rows = [...known, ...retired].sort((a, b) => b.clicks - a.clicks || a.title.localeCompare(b.title));

  const total = shown.length;
  const max = Math.max(1, ...rows.map((r) => r.clicks));

  // Last 30 local days ending today.
  const span = Math.min(days || 30, 30) || 30;
  const cols = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDay(d);
    cols.push({ key, n: byDay.get(key) || 0 });
  }
  const dayMax = Math.max(1, ...cols.map((c) => c.n));
  const peak = cols.reduce((a, b) => (b.n > a.n ? b : a), cols[0] || { key: '-', n: 0 });

  const qs = (d, b) => `/stats?days=${d}${b ? '&bots=1' : ''}`;
  const filters =
    RANGES.map(
      (r) =>
        `<a class="chip" href="${qs(r.days, includeBots)}"${r.days === days ? ' aria-current="true"' : ''}>${r.label}</a>`
    ).join('') +
    `<a class="chip alt" href="${qs(days, !includeBots)}"${includeBots ? ' aria-current="true"' : ''}>` +
    `${includeBots ? 'Bots included' : `Bots hidden (${nf.format(botCount)})`}</a>`;

  const tiles = [
    ['Clicks', nf.format(total)],
    ['Visitors', nf.format(visitors.size), 'unique per day'],
    ['Links clicked', `${rows.filter((r) => r.clicks > 0).length}<small> / ${site.links.length}</small>`],
    ['Busiest day', peak.n ? `${nf.format(peak.n)}<small> · ${peak.key.slice(5)}</small>` : '—'],
  ]
    .map(([k, v, sub]) => `<div class="tile"><dt>${k}</dt><dd>${v}${sub && !String(v).includes('<small>') ? `<small> ${sub}</small>` : ''}</dd></div>`)
    .join('');

  const chart = cols
    .map(
      (c) =>
        `<div class="day${c.n ? '' : ' zero'}" title="${c.key}: ${c.n} click${c.n === 1 ? '' : 's'}">` +
        `<i style="height:${c.n ? Math.max(3, Math.round((c.n / dayMax) * 100)) : 0}%"></i></div>`
    )
    .join('');

  const tableRows = rows
    .map(
      (r) => `<tr>
      <td><span class="link-cell">
        <span class="dot" aria-hidden="true">${esc(r.emoji || '·')}</span>
        <span style="min-width:0">
          <span class="t">${esc(r.title)}</span><br>
          <span class="slug">/go/${esc(r.slug)}</span>
        </span>
      </span></td>
      <td class="bar-cell">${r.clicks ? `<div class="bar" style="width:${Math.max(2, Math.round((r.clicks / max) * 100))}%"></div>` : ''}</td>
      <td class="num">${nf.format(r.clicks)}</td>
      <td class="num hide-sm"><span class="pct">${total ? ((r.clicks / total) * 100).toFixed(0) : 0}%</span></td>
      <td class="num hide-sm"><span class="when">${r.last ? ago(r.last) : '—'}</span></td>
    </tr>`
    )
    .join('');

  const recent = shown
    .slice(-20)
    .reverse()
    .map((c) => {
      const t = new Date(c.t).toLocaleString('en-CA', { hour12: false }).replace(',', '');
      return `${esc(t)}  <b>${esc(c.slug)}</b>  ${esc(c.ref === '-' ? 'direct' : c.ref)}${c.kind === 'bot' ? '  [bot]' : ''}`;
    })
    .join('\n');

  const rangeLabel = days ? `last ${RANGES.find((r) => r.days === days)?.label ?? days + 'd'}` : 'all time';
  const css = TOKENS + STATS_CSS;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clicks — ${esc(site.name)}</title>
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${css}</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div>
      <p class="kicker">${esc(site.name)} · ${esc(rangeLabel)}</p>
      <h1>Clicks</h1>
    </div>
    <a class="back" href="/">&larr; back to index</a>
  </div>

  <div class="filters">${filters}</div>

  <dl class="tiles">${tiles}</dl>

  <section>
    <h2>Clicks per day</h2>
    <div class="days">${chart}</div>
    <div class="axis"><span>${esc(cols[0]?.key ?? '')}</span><span>peak ${nf.format(dayMax)}</span><span>${esc(cols.at(-1)?.key ?? '')}</span></div>
  </section>

  <section>
    <h2>By link</h2>
    ${
      rows.length
        ? `<table>
      <thead><tr><th>Link</th><th class="bar-cell"></th><th class="num">Clicks</th><th class="num hide-sm">Share</th><th class="num hide-sm">Last</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`
        : `<p class="empty">No links defined in links.json yet.</p>`
    }
  </section>

  <section>
    <h2>Recent activity</h2>
    ${recent ? `<pre class="recent">${recent}</pre>` : `<p class="empty">No clicks recorded ${esc(rangeLabel === 'all time' ? 'yet' : `in the ${rangeLabel}`)}.</p>`}
  </section>

  <p class="note">Log: ${esc(logPath)} · ${nf.format(clicks.length)} lines in range<br>
  Visitor counts use a hash of IP + salt + date that rotates daily. Raw IPs are never written.<br>
  Same numbers from the shell: <b>cut -f2 ${esc(logPath)} | sort | uniq -c | sort -rn</b></p>
</div>
</body>
</html>
`;
}
