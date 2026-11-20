/**
 * HTML for the dashboard. Every value that came from outside (collected paths,
 * referrers, UTM values, typed-in domains) goes through escapeHtml. No page
 * carries a script or a style attribute; the CSS is /app.css.
 */
import { BREAKDOWNS, RANGE_PRESETS } from './reports.mjs';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const nf = new Intl.NumberFormat('en-US');
export const fmt = (n) => nf.format(n);

export function layout(title, body, { signedIn = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)} · analytics</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/">analytics</a>
  ${signedIn ? '<form method="post" action="/logout"><button class="ghost" type="submit">Sign out</button></form>' : ''}
</header>
<main class="wrap">
${body}
</main>
</body>
</html>
`;
}

export function loginPage({ error = null, unavailable = false } = {}) {
  if (unavailable) {
    return layout('Sign in', `<section class="card narrow">
  <h1>Dashboard unavailable</h1>
  <p>Set <code>ADMIN_PASSWORD</code> in <code>.env</code> and restart the server.</p>
</section>`);
  }
  return layout('Sign in', `<section class="card narrow">
  <h1>Sign in</h1>
  ${error ? `<p class="flash err" role="alert">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="/login" class="stack">
    <label class="field"><span>Password</span>
      <input type="password" name="password" autocomplete="current-password" autofocus required></label>
    <button type="submit">Sign in</button>
  </form>
</section>`);
}

export function snippet(origin, domain) {
  return `<script defer data-domain="${domain}" src="${origin}/script.js"></script>`;
}

function snippetBlock(origin, domain) {
  return `<pre class="snippet"><code>${escapeHtml(snippet(origin, domain))}</code></pre>
  <p class="hint">Paste it into the <code>&lt;head&gt;</code> of every page on ${escapeHtml(domain)}.
  Add <code>data-respect-dnt</code> to the tag to skip visitors whose browser sends Do Not Track.</p>`;
}

function addSiteForm({ value = '', error = null } = {}) {
  return `<form method="post" action="/sites" class="add-site" novalidate>
    <label class="field"><span>Add a site</span>
      <input type="text" name="domain" placeholder="example.com" value="${escapeHtml(value)}"
        autocomplete="off" spellcheck="false" required${error ? ' aria-invalid="true" aria-describedby="domain-error"' : ''}></label>
    <button type="submit">Add</button>
    ${error ? `<p class="field-error" id="domain-error">${escapeHtml(error)}</p>` : ''}
  </form>`;
}

export function sitesPage({ sites, today, form = {} }) {
  const rows = sites.map((site) => `<tr>
      <td><a href="/sites/${encodeURIComponent(site.domain)}">${escapeHtml(site.domain)}</a></td>
      <td class="num" data-today="${site.pageviews}">${fmt(site.pageviews)}</td>
      <td class="num">${fmt(site.visitors)}</td>
    </tr>`).join('');
  const body = `<h1>Sites</h1>
  ${sites.length
    ? `<section class="card"><div class="scroll"><table>
      <thead><tr><th>Site</th><th class="num">Pageviews today</th><th class="num">Visitors today</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="hint">Today is ${escapeHtml(today)} (UTC).</p></section>`
    : '<p class="empty">No sites yet. Add one below to get a tracking snippet.</p>'}
  <section class="card">${addSiteForm(form)}</section>`;
  return layout('Sites', body, { signedIn: true });
}

function rangeControls(domain, range) {
  const base = `/sites/${encodeURIComponent(domain)}`;
  const chips = RANGE_PRESETS.map(({ key, label }) =>
    `<a class="chip" href="${base}?range=${key}"${range.preset === key ? ' aria-current="true"' : ''}>${label}</a>`).join('');
  return `<div class="filters">
    ${chips}
    <form method="get" action="${base}" class="custom${range.preset === 'custom' ? ' active' : ''}">
      <input type="hidden" name="range" value="custom">
      <label><span class="sr">From</span><input type="date" name="from" value="${escapeHtml(range.from)}"></label>
      <span aria-hidden="true">–</span>
      <label><span class="sr">To</span><input type="date" name="to" value="${escapeHtml(range.to)}"></label>
      <button class="ghost" type="submit">Apply</button>
    </form>
  </div>`;
}

function breakdown({ name, heading, label }, rows) {
  const table = rows.length
    ? `<table data-breakdown="${name}">
      <thead><tr><th>${label}</th><th class="num">Visitors</th><th class="num">Pageviews</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td class="key">${escapeHtml(row.key)}</td><td class="num">${fmt(row.visitors)}</td><td class="num">${fmt(row.pageviews)}</td></tr>`).join('')}</tbody>
    </table>`
    : '<p class="empty">None in this range.</p>';
  return `<section class="card breakdown"><h2>${heading}</h2><div class="scroll">${table}</div></section>`;
}

export function sitePage({ domain, origin, range, flash, hasEvents, totals, chart, breakdowns }) {
  const days = range.days;
  const header = `<div class="site-head"><p class="kicker"><a href="/">Sites</a> /</p><h1>${escapeHtml(domain)}</h1></div>`;

  if (!hasEvents) {
    return layout(domain, `${header}
    <section class="card waiting">
      <h2>Waiting for the first pageview</h2>
      ${snippetBlock(origin, domain)}
      <p class="hint">Once the snippet is live, load a page on your site and refresh this one.</p>
    </section>`, { signedIn: true });
  }

  const visitorsNote = days > 1
    ? 'sum of daily uniques: someone who visits on two days counts twice'
    : 'unique visitors for the day';

  return layout(domain, `${header}
    ${rangeControls(domain, range)}
    ${flash ? `<p class="flash err" role="alert">${escapeHtml(flash)}</p>` : ''}
    <section class="card">
      <dl class="tiles">
        <div class="tile"><dt>Visitors</dt><dd data-metric="visitors">${fmt(totals.visitors)}</dd><dd class="note">${visitorsNote}</dd></div>
        <div class="tile"><dt>Pageviews</dt><dd data-metric="pageviews">${fmt(totals.pageviews)}</dd><dd class="note">${escapeHtml(range.from)} to ${escapeHtml(range.to)} (UTC)</dd></div>
      </dl>
      <ul class="legend">
        <li><span class="swatch pv" aria-hidden="true"></span>Pageviews</li>
        <li><span class="swatch uv" aria-hidden="true"></span>Visitors</li>
      </ul>
      ${chart}
    </section>
    <div class="grid">
      ${BREAKDOWNS.map((b) => breakdown(b, breakdowns[b.name])).join('')}
    </div>
    <details class="card">
      <summary>Tracking snippet</summary>
      ${snippetBlock(origin, domain)}
    </details>`, { signedIn: true });
}

export function notFoundPage(message) {
  return layout('Not found', `<section class="card narrow"><h1>Not found</h1><p>${escapeHtml(message)}</p><p><a href="/">Back to sites</a></p></section>`, { signedIn: true });
}
