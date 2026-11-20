/** Server-rendered HTML. Every value from outside goes through esc(). No inline styles or scripts. */

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const iso = (ms) => (ms ? new Date(ms).toISOString().replace('.000Z', 'Z').replace('T', ' ') : '—');

export function ago(ms, now) {
  if (!ms) return 'never';
  const s = Math.round((now - ms) / 1000);
  if (s < 0) return until(ms, now);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function until(ms, now) {
  if (!ms) return '—';
  const s = Math.round((ms - now) / 1000);
  if (s <= 0) return 'now';
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
}

const STATE_LABEL = {
  pending: 'pending', up: 'up', down: 'down', paused: 'paused', new: 'waiting for first ping', late: 'late',
};

export function stateBadge(state) {
  const key = Object.hasOwn(STATE_LABEL, state) ? state : 'pending';
  return `<span class="badge badge-${key}">${esc(STATE_LABEL[key])}</span>`;
}

export function layout(title, body, { nav = true } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · uptime</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
${nav ? `<header class="top"><a class="brand" href="/">uptime</a>
<nav><a href="/">Dashboard</a><a href="/monitors/new">New monitor</a><a href="/heartbeats/new">New heartbeat</a>
<form method="post" action="/logout" class="inline"><button class="link" type="submit">Sign out</button></form></nav></header>` : ''}
<main>
${body}
</main>
</body>
</html>`;
}

export function loginPage({ error } = {}) {
  return layout('Sign in', `<div class="card narrow">
<h1>uptime</h1>
<p class="muted">Sign in with the admin password.</p>
${error ? `<p class="flash err" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/login">
<label class="field"><span>Password</span>
<input type="password" name="password" autocomplete="current-password" autofocus required></label>
<button type="submit">Sign in</button>
</form>
</div>`, { nav: false });
}

function field({ name, label, value, error, type = 'text', hint = '', attrs = '' }) {
  const id = `f-${name}`;
  return `<label class="field${error ? ' has-error' : ''}" for="${id}"><span>${esc(label)}</span>
<input id="${id}" type="${type}" name="${name}" value="${esc(value)}" ${attrs}${error ? ` aria-invalid="true" aria-describedby="${id}-err"` : ''}>
${hint ? `<small class="muted">${hint}</small>` : ''}
${error ? `<small class="error" id="${id}-err">${esc(error)}</small>` : ''}
</label>`;
}

export function monitorForm({ title, action, values = {}, errors = {} }) {
  const v = {
    name: '', url: 'https://', interval_s: 60, timeout_s: 10, expected: '200-299', down_after: 2, up_after: 1, ...values,
  };
  return layout(title, `<h1>${esc(title)}</h1>
${Object.keys(errors).length ? '<p class="flash err" role="alert">Fix the highlighted fields.</p>' : ''}
<form method="post" action="${esc(action)}" class="card form">
${field({ name: 'name', label: 'Name', value: v.name, error: errors.name, attrs: 'required maxlength="100"' })}
${field({ name: 'url', label: 'URL', value: v.url, error: errors.url, type: 'url', attrs: 'required' })}
<div class="row">
${field({ name: 'interval_s', label: 'Check every (seconds)', value: v.interval_s, error: errors.interval_s, type: 'number', attrs: 'min="30" max="86400" required' })}
${field({ name: 'timeout_s', label: 'Timeout (seconds)', value: v.timeout_s, error: errors.timeout_s, type: 'number', hint: 'Must be shorter than the interval.', attrs: 'min="1" max="60" required' })}
</div>
${field({ name: 'expected', label: 'Expected status codes', value: v.expected, error: errors.expected, hint: 'Ranges or a list, e.g. 200-299 or 200,301.' })}
<div class="row">
${field({ name: 'down_after', label: 'Failures before down', value: v.down_after, error: errors.down_after, type: 'number', attrs: 'min="1" max="10" required' })}
${field({ name: 'up_after', label: 'Successes before up', value: v.up_after, error: errors.up_after, type: 'number', attrs: 'min="1" max="10" required' })}
</div>
<div class="actions"><button type="submit">Save</button> <a href="/">Cancel</a></div>
</form>`);
}

export function confirmDelete({ what, name, action, back }) {
  return layout(`Delete ${what}`, `<div class="card narrow">
<h1>Delete ${esc(what)}?</h1>
<p>This removes <strong>${esc(name)}</strong> and all of its history. It cannot be undone.</p>
<form method="post" action="${esc(action)}">
<div class="actions"><button type="submit" class="danger">Delete</button> <a href="${esc(back)}">Cancel</a></div>
</form>
</div>`);
}

export function notFoundPage() {
  return layout('Not found', '<div class="card narrow"><h1>Not found</h1><p><a href="/">Back to the dashboard</a></p></div>');
}

/** Latency sparkline as SVG with presentation attributes only (CSP: no style=""). */
export function sparkline(values, { width = 120, height = 28 } = {}) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return '<span class="muted">—</span>';
  const max = Math.max(...pts, 1);
  const step = width / (pts.length - 1);
  const coords = pts.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="latency, max ${Math.round(max)} ms"><polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

const pct = (n) => (n === null || n === undefined ? '—' : `${n >= 99.995 ? '100' : n.toFixed(2)}%`);

function tlsLine(m, now) {
  if (!m.url.startsWith('https:')) return '';
  if (m.tls_error) return `<p><strong>TLS:</strong> <span class="badge badge-down">TLS error</span> ${esc(m.tls_error)}</p>`;
  if (!m.tls_expires_at) return '<p><strong>TLS:</strong> <span class="muted">not checked yet</span></p>';
  const days = Math.floor((m.tls_expires_at - now) / 86_400_000);
  const cls = days <= 14 ? 'badge-late' : 'badge-up';
  return `<p><strong>TLS:</strong> <span class="badge ${cls}">expires in ${days} days</span> ${esc(iso(m.tls_expires_at))}</p>`;
}

export function monitorDetail({ monitor: m, checks, incidents, uptime, now }) {
  const rows = checks.slice().reverse().slice(0, 30).map((c) => `<tr>
<td>${esc(iso(c.ts))}</td><td>${c.ok ? '<span class="badge badge-up">ok</span>' : '<span class="badge badge-down">fail</span>'}</td>
<td>${esc(c.status_code ?? '—')}</td><td>${esc(c.latency_ms ?? '—')} ms</td><td>${esc(c.error ?? '')}</td></tr>`).join('');
  return layout(m.name, `<h1>${esc(m.name)} ${stateBadge(m.paused ? 'paused' : m.state)}</h1>
<p class="muted break">${esc(m.url)}</p>
<div class="card">
<p>Every ${esc(m.interval_s)}s, timeout ${esc(m.timeout_s)}s, expects ${esc(m.expected)}. Down after ${esc(m.down_after)} failures, up after ${esc(m.up_after)} successes.</p>
<p>Uptime (24h): <strong>${pct(uptime)}</strong> · Last check: ${esc(ago(m.last_checked_at, now))}${m.last_error ? ` · <span class="error">${esc(m.last_error)}</span>` : ''}</p>
${tlsLine(m, now)}
<p>${sparkline(checks.map((c) => c.latency_ms))}</p>
<div class="actions">
<a class="button" href="/monitors/${m.id}/edit">Edit</a>
<form method="post" action="/monitors/${m.id}/${m.paused ? 'resume' : 'pause'}" class="inline"><button type="submit" class="secondary">${m.paused ? 'Resume' : 'Pause'}</button></form>
<a class="button danger" href="/monitors/${m.id}/delete">Delete</a>
</div>
</div>
${incidentTable(incidents, now)}
<h2>Recent checks</h2>
${rows ? `<div class="scroll"><table><thead><tr><th>Time (UTC)</th><th>Result</th><th>Status</th><th>Latency</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No checks yet.</p>'}`);
}

export function incidentTable(incidents, now, { withName = false } = {}) {
  if (!incidents.length) return '<h2>Incidents</h2><p class="muted">No incidents.</p>';
  const rows = incidents.map((i) => `<tr>
${withName ? `<td><a href="/${i.kind === 'monitor' ? 'monitors' : 'heartbeats'}/${i.ref_id}">${esc(i.name ?? '(deleted)')}</a></td>` : ''}
<td>${esc(iso(i.started_at))}</td>
<td>${i.ended_at ? esc(iso(i.ended_at)) : '<span class="badge badge-down">ongoing</span>'}</td>
<td>${esc(durationText((i.ended_at ?? now) - i.started_at))}</td>
<td>${esc(i.cause)}</td></tr>`).join('');
  return `<h2>Incidents</h2><div class="scroll"><table><thead><tr>${withName ? '<th>Check</th>' : ''}<th>Started (UTC)</th><th>Ended</th><th>Duration</th><th>Cause</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function durationText(ms) {
  let s = Math.max(0, Math.round(ms / 1000));
  const parts = [];
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    const n = Math.floor(s / size);
    s -= n * size;
    if (n) parts.push(`${n}${unit}`);
  }
  return parts.slice(0, 2).join(' ') || '0s';
}

export function scheduleText(hb) {
  if (hb.mode === 'cron') return `cron ${hb.cron} (${hb.tz})`;
  const min = Math.round(hb.period_s / 60);
  return min % 60 === 0 ? `every ${min / 60}h` : `every ${min}m`;
}

function summaryCard(label, n) {
  return `<div class="card"><strong>${esc(n)}</strong><span class="muted">${esc(label)}</span></div>`;
}

export function dashboard({ monitors, heartbeats, incidents, now }) {
  const all = [...monitors, ...heartbeats];
  const count = (state) => all.filter((x) => !x.paused && x.state === state).length;
  const monitorRows = monitors.map((m) => `<tr>
<td><a href="/monitors/${m.id}">${esc(m.name)}</a><div class="muted small break">${esc(m.url)}</div></td>
<td>${stateBadge(m.paused ? 'paused' : m.state)}${m.tls_error ? ' <span class="badge badge-down">TLS error</span>' : ''}</td>
<td>${esc(ago(m.last_checked_at, now))}</td>
<td>${pct(m.uptime)}</td>
<td>${sparkline(m.latencies)}</td>
</tr>`).join('');
  const heartbeatRows = heartbeats.map((h) => `<tr>
<td><a href="/heartbeats/${h.id}">${esc(h.name)}</a><div class="muted small">${esc(scheduleText(h))}</div></td>
<td>${stateBadge(h.paused ? 'paused' : h.state)}</td>
<td>${esc(ago(h.last_ping_at, now))}</td>
<td>${h.paused || h.state === 'new' ? '—' : esc(until(h.due_at, now))}</td>
</tr>`).join('');
  return layout('Dashboard', `<div class="summary">
${summaryCard('up', count('up'))}${summaryCard('down', count('down'))}${summaryCard('late', count('late'))}${summaryCard('paused', all.filter((x) => x.paused).length)}
</div>
<h2>Monitors</h2>
${monitorRows ? `<div class="scroll"><table><thead><tr><th>Name</th><th>State</th><th>Last check</th><th>Uptime 24h</th><th>Latency</th></tr></thead><tbody>${monitorRows}</tbody></table></div>` : '<p class="muted">No monitors yet. <a href="/monitors/new">Add one</a>.</p>'}
<h2>Heartbeats</h2>
${heartbeatRows ? `<div class="scroll"><table><thead><tr><th>Name</th><th>State</th><th>Last ping</th><th>Next expected</th></tr></thead><tbody>${heartbeatRows}</tbody></table></div>` : '<p class="muted">No heartbeats yet. <a href="/heartbeats/new">Add one</a>.</p>'}
${incidentTable(incidents, now, { withName: true }).replace('<h2>Incidents</h2>', '<h2>Recent incidents</h2>')}`);
}

export function heartbeatForm({ title, action, values = {}, errors = {} }) {
  const v = { name: '', mode: 'period', period_min: 60, cron: '0 3 * * *', tz: 'UTC', grace_min: 10, ...values };
  const opt = (value, label) => `<option value="${value}"${v.mode === value ? ' selected' : ''}>${label}</option>`;
  return layout(title, `<h1>${esc(title)}</h1>
${Object.keys(errors).length ? '<p class="flash err" role="alert">Fix the highlighted fields.</p>' : ''}
<form method="post" action="${esc(action)}" class="card form">
${field({ name: 'name', label: 'Name', value: v.name, error: errors.name, attrs: 'required maxlength="100"' })}
<label class="field${errors.mode ? ' has-error' : ''}" for="f-mode"><span>Schedule type</span>
<select id="f-mode" name="mode">${opt('period', 'Fixed period')}${opt('cron', 'Cron schedule')}</select>
${errors.mode ? `<small class="error">${esc(errors.mode)}</small>` : ''}</label>
${field({ name: 'period_min', label: 'Period (minutes), for a fixed period', value: v.period_min, error: errors.period_min, type: 'number', attrs: 'min="1"' })}
<div class="row">
${field({ name: 'cron', label: 'Cron expression, for a cron schedule', value: v.cron, error: errors.cron, hint: 'Five fields, e.g. <code>0 3 * * *</code> for 03:00 every day.' })}
${field({ name: 'tz', label: 'Timezone', value: v.tz, error: errors.tz, hint: 'IANA name, e.g. Australia/Melbourne.' })}
</div>
${field({ name: 'grace_min', label: 'Grace period (minutes)', value: v.grace_min, error: errors.grace_min, type: 'number', hint: 'How long after the expected time before it counts as down.', attrs: 'min="1" required' })}
<div class="actions"><button type="submit">Save</button> <a href="/">Cancel</a></div>
</form>`);
}

export function heartbeatDetail({ hb, pings, incidents, pingBase, now }) {
  const url = `${pingBase}/ping/${hb.token}`;
  const rows = pings.map((p) => `<tr><td>${esc(iso(p.ts))}</td><td>${esc(p.kind)}</td><td>${p.duration_ms === null ? '' : esc(durationText(p.duration_ms))}</td></tr>`).join('');
  return layout(hb.name, `<h1>${esc(hb.name)} ${stateBadge(hb.paused ? 'paused' : hb.state)}</h1>
<div class="card">
<p>${esc(scheduleText(hb))}, ${esc(Math.round(hb.grace_s / 60))} minutes grace.
Last ping: ${esc(ago(hb.last_ping_at, now))}${hb.last_duration_ms !== null ? ` (ran for ${esc(durationText(hb.last_duration_ms))})` : ''}.
${hb.state !== 'new' && !hb.paused ? `Next expected: ${esc(iso(hb.due_at))} UTC.` : ''}</p>
<p><strong>Ping URLs</strong> (GET or POST, no login needed):</p>
<pre>${esc(url)}          success
${esc(url)}/start    run started (measures duration)
${esc(url)}/fail     run failed (alerts at once)</pre>
<p>Example crontab line:</p>
<pre>${esc(hb.mode === 'cron' ? hb.cron : '0 * * * *')} /usr/local/bin/backup.sh &amp;&amp; curl -fsS -m 10 --retry 3 ${esc(url)} &gt;/dev/null || curl -fsS -m 10 --retry 3 ${esc(url)}/fail &gt;/dev/null</pre>
<p class="muted small">Treat this URL like a password: anyone who has it can ping this heartbeat.</p>
<div class="actions">
<a class="button" href="/heartbeats/${hb.id}/edit">Edit</a>
<form method="post" action="/heartbeats/${hb.id}/${hb.paused ? 'resume' : 'pause'}" class="inline"><button type="submit" class="secondary">${hb.paused ? 'Resume' : 'Pause'}</button></form>
<a class="button danger" href="/heartbeats/${hb.id}/delete">Delete</a>
</div>
</div>
${incidentTable(incidents, now)}
<h2>Recent pings</h2>
${rows ? `<div class="scroll"><table><thead><tr><th>Time (UTC)</th><th>Kind</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No pings yet.</p>'}`);
}
