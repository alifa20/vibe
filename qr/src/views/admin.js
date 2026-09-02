import { html, page, raw, esc } from './layout.js';

const NOTICES = {
  created: 'Code created.',
  updated: 'Code updated.',
  deleted: 'Code deleted.',
  cleared: 'Scan history cleared.'
};

export function noticeText(key) {
  return NOTICES[key] || null;
}

function banner({ ok, err }) {
  const text = noticeText(ok);
  if (text) return html`<p class="banner banner-ok">${text}</p>`;
  if (err) return html`<p class="banner banner-err">${err}</p>`;
  return '';
}

function shortUrl(target) {
  try {
    const url = new URL(target);
    const rest = `${url.pathname}${url.search}`.replace(/\/$/, '');
    return url.host + (rest.length > 28 ? `${rest.slice(0, 28)}…` : rest);
  } catch {
    return target;
  }
}

function stamp(ts) {
  if (!ts) return html`<span class="muted">—</span>`;
  return html`<time datetime="${ts}">${raw(esc(ts).replace('T', ' ').replace('Z', ''))}</time>`;
}

export function listPage({ rows, stats, baseUrl, ok, err, form = {} }) {
  const body = html`
${banner({ ok, err })}

<section class="panel">
  <div class="panel-head">
    <h1>Dynamic codes</h1>
    <p class="muted">
      ${stats.codes} ${stats.codes === 1 ? 'code' : 'codes'} ·
      ${stats.scans_total} total ${stats.scans_total === 1 ? 'scan' : 'scans'} ·
      ${stats.scans_30d} in the last 30 days
    </p>
  </div>

  <form class="newcode" method="post" action="/admin/codes">
    <div class="field grow">
      <label for="new-target">Target URL</label>
      <input id="new-target" name="target" type="text" inputmode="url" required
             placeholder="https://example.com/spring-menu" value="${form.target || ''}">
    </div>
    <div class="field">
      <label for="new-label">Label <span class="muted">optional</span></label>
      <input id="new-label" name="label" type="text" placeholder="Table tent" value="${form.label || ''}">
    </div>
    <div class="field">
      <label for="new-slug">Slug <span class="muted">auto</span></label>
      <input id="new-slug" name="slug" type="text" class="mono" placeholder="auto" pattern="[A-Za-z0-9_-]{1,64}"
             value="${form.slug || ''}">
    </div>
    <button class="btn btn-primary" type="submit">Create code</button>
  </form>
</section>

${rows.length === 0
  ? html`<p class="empty">No dynamic codes yet. Create one above — its printed QR keeps working even after you change where it points.</p>`
  : html`<div class="table-wrap">
  <table class="codes">
    <thead>
      <tr>
        <th>Code</th>
        <th>Target</th>
        <th class="num">Scans</th>
        <th class="num">30 days</th>
        <th>Last scan</th>
        <th><span class="sr-only">Actions</span></th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => html`
      <tr${raw(row.active ? '' : ' class="is-inactive"')}>
        <td data-label="Code">
          <a class="slug mono" href="/admin/codes/${row.id}">/r/${row.slug}</a>
          ${row.label ? html`<span class="label-text">${row.label}</span>` : ''}
          ${row.active ? '' : html`<span class="pill pill-off">disabled</span>`}
        </td>
        <td data-label="Target">
          <a class="target" href="${row.target}" rel="noreferrer noopener nofollow" target="_blank"
             title="${row.target}">${shortUrl(row.target)}</a>
        </td>
        <td data-label="Scans" class="num">${row.scans_total}</td>
        <td data-label="30 days" class="num">${row.scans_30d}</td>
        <td data-label="Last scan">${stamp(row.last_scan)}</td>
        <td class="row-actions">
          <a class="btn btn-quiet" href="/?data=${encodeURIComponent(`${baseUrl}/r/${row.slug}`)}">Design</a>
          <a class="btn btn-quiet" href="/admin/codes/${row.id}">Edit</a>
        </td>
      </tr>`)}
    </tbody>
  </table>
</div>`}

<p class="hint">Short links resolve at <code class="mono">${baseUrl}/r/&lt;slug&gt;</code> with a 302, so the printed code never has to change.</p>
`;

  return page({ title: 'Dynamic codes · QRForge', nav: 'admin', body, wide: true });
}

function chart(daily) {
  const days = [];
  const today = new Date();
  const byDay = new Map(daily.map((d) => [d.day, d.hits]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    days.push({ key, hits: byDay.get(key) || 0 });
  }
  const peak = Math.max(1, ...days.map((d) => d.hits));
  const barW = 8;
  const gap = 2;
  const height = 56;
  const width = days.length * (barW + gap) - gap;

  const bars = days.map((d, i) => {
    const h = d.hits === 0 ? 1 : Math.max(2, Math.round((d.hits / peak) * height));
    const x = i * (barW + gap);
    const y = height - h;
    const cls = d.hits === 0 ? 'bar bar-empty' : 'bar';
    return `<rect class="${cls}" x="${x}" y="${y}" width="${barW}" height="${h}" rx="2"><title>${esc(d.key)}: ${d.hits}</title></rect>`;
  }).join('');

  return html`
<figure class="chart">
  <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"
       aria-label="Scans per day over the last 30 days">${raw(bars)}</svg>
  <figcaption class="muted">Last 30 days · peak ${peak}/day</figcaption>
</figure>`;
}

export function detailPage({ code, recent, daily, totals, baseUrl, ok, err }) {
  const shortLink = `${baseUrl}/r/${code.slug}`;
  const body = html`
<p class="crumbs"><a href="/admin">&larr; All codes</a></p>
${banner({ ok, err })}

<section class="panel">
  <div class="panel-head">
    <h1 class="mono">/r/${code.slug}</h1>
    <p class="muted">
      Created ${stamp(code.created_at)} · updated ${stamp(code.updated_at)}
    </p>
  </div>

  <div class="stat-row">
    <div class="stat"><span class="stat-num">${totals.scans_total}</span><span class="stat-label">total scans</span></div>
    <div class="stat"><span class="stat-num">${totals.scans_30d}</span><span class="stat-label">last 30 days</span></div>
    <div class="stat"><span class="stat-num">${stamp(totals.last_scan)}</span><span class="stat-label">last scan</span></div>
  </div>

  ${chart(daily)}

  <form class="editform" method="post" action="/admin/codes/${code.id}">
    <div class="field">
      <label for="target">Target URL</label>
      <input id="target" name="target" type="text" inputmode="url" required value="${code.target}">
      <p class="field-hint">Change this any time — printed codes keep pointing at <code class="mono">${shortLink}</code>.</p>
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="label">Label</label>
        <input id="label" name="label" type="text" value="${code.label}" placeholder="Where this code lives">
      </div>
      <div class="field">
        <label for="slug">Slug</label>
        <input id="slug" name="slug" type="text" class="mono" required value="${code.slug}" pattern="[A-Za-z0-9_-]{1,64}">
        <p class="field-hint">Changing the slug breaks already-printed codes.</p>
      </div>
    </div>
    <label class="check">
      <input type="checkbox" name="active" value="1"${raw(code.active ? ' checked' : '')}>
      <span>Active — when off, scans return 410 Gone instead of redirecting.</span>
    </label>
    <div class="actions">
      <button class="btn btn-primary" type="submit">Save changes</button>
      <a class="btn btn-quiet" href="/?data=${encodeURIComponent(shortLink)}">Design this QR</a>
      <a class="btn btn-quiet" href="${shortLink}" target="_blank" rel="noreferrer noopener">Test redirect</a>
    </div>
  </form>
</section>

<section class="panel">
  <div class="panel-head"><h2>Recent scans</h2><p class="muted">Most recent ${recent.length} of ${totals.scans_total}</p></div>
  ${recent.length === 0
    ? html`<p class="empty">No scans logged yet.</p>`
    : html`<div class="table-wrap">
    <table class="scans">
      <thead><tr><th>When</th><th>User agent</th><th>Referer</th></tr></thead>
      <tbody>
        ${recent.map((s) => html`
        <tr>
          <td data-label="When">${stamp(s.ts)}</td>
          <td data-label="User agent" class="ua" title="${s.user_agent}">${s.user_agent || '—'}</td>
          <td data-label="Referer">${s.referer ? html`<span class="mono">${shortUrl(s.referer)}</span>` : html`<span class="muted">direct</span>`}</td>
        </tr>`)}
      </tbody>
    </table>
  </div>`}
</section>

<section class="panel danger">
  <div class="panel-head"><h2>Danger zone</h2></div>
  <div class="actions">
    <form method="post" action="/admin/codes/${code.id}/scans/clear">
      <button class="btn btn-danger-quiet" type="submit"
              data-confirm="Delete all ${totals.scans_total} scan records for /r/${code.slug}?">Clear scan history</button>
    </form>
    <form method="post" action="/admin/codes/${code.id}/delete">
      <button class="btn btn-danger" type="submit"
              data-confirm="Delete /r/${code.slug}? Printed codes pointing at it will stop working.">Delete code</button>
    </form>
  </div>
</section>
`;

  return page({ title: `/r/${code.slug} · QRForge`, nav: 'admin', body });
}

export function errorPage({ status, title, message }) {
  return page({
    title: `${status} · QRForge`,
    nav: '',
    body: html`<section class="panel center">
      <h1>${title}</h1>
      <p class="muted">${message}</p>
      <p><a class="btn btn-quiet" href="/">Back to the generator</a></p>
    </section>`
  });
}
