import { config } from '../config.js';
import { avatarHtml, escapeHtml, formatDate, layout, starsHtml } from '../ui.js';

const css = `
h1 { font-size: 26px; letter-spacing: -.025em; margin: 0 0 6px; }
.sub { color: var(--ink-2); margin: 0 0 26px; font-size: 15px; }

.tabs { display: flex; gap: 6px; margin-bottom: 22px; flex-wrap: wrap; }
.tab {
  padding: 7px 13px; border-radius: 9px; border: 1px solid transparent;
  text-decoration: none; font-size: 14px; color: var(--ink-2);
}
.tab:hover { background: var(--bg-sunk); color: var(--ink); }
.tab[aria-current="page"] {
  background: var(--bg-elev); border-color: var(--line); color: var(--ink); font-weight: 550;
}
.tab .count {
  display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 20px;
  background: var(--bg-sunk); font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums;
}
.tab[aria-current="page"] .count { background: var(--accent); color: var(--accent-ink); }

.item {
  display: grid; gap: 16px; padding: 20px;
  grid-template-columns: 1fr; align-items: start;
  background: var(--bg-elev); border: 1px solid var(--line);
  border-radius: var(--radius); margin-bottom: 12px;
}
@media (min-width: 860px) { .item { grid-template-columns: 1fr auto; } }
.item--pending { border-left: 3px solid var(--star); }

.item-head { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; flex-wrap: wrap; }
.item-head .who { min-width: 0; flex: 1; }
.item-head .name { display: block; font-weight: 590; font-size: 15px; }
.item-head .role { display: block; font-size: 13px; color: var(--ink-2); }
.item-body {
  margin: 0; font-size: 15px; line-height: 1.6; white-space: pre-line;
  overflow-wrap: break-word; color: var(--ink);
}
.item-foot {
  margin-top: 12px; display: flex; gap: 10px; align-items: center;
  flex-wrap: wrap; font-size: 12.5px; color: var(--ink-3);
}
.badge {
  padding: 2px 8px; border-radius: 20px; font-size: 12px; font-weight: 550;
  border: 1px solid var(--line);
}
.badge--pending { color: var(--star); border-color: color-mix(in srgb, var(--star) 45%, var(--line)); }
.badge--live { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, var(--line)); }

.item-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start; }
.item-actions form { margin: 0; }

.embed { margin-top: 40px; padding-top: 28px; border-top: 1px solid var(--line); }
.embed h2 { font-size: 17px; margin: 0 0 6px; letter-spacing: -.015em; }
.embed p { color: var(--ink-2); font-size: 14px; margin: 0 0 14px; }
.snippet { position: relative; }
.snippet pre {
  margin: 0; padding: 15px 15px; overflow-x: auto;
  background: var(--bg-sunk); border: 1px solid var(--line); border-radius: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px; line-height: 1.65; color: var(--ink);
}
.snippet .btn { position: absolute; top: 9px; right: 9px; }
.snippet-note { margin-top: 10px; font-size: 13px; color: var(--ink-3); }

.empty { padding: 50px 20px; text-align: center; color: var(--ink-2); border: 1px dashed var(--line); border-radius: var(--radius); }
`;

const script = `
(function () {
  var copy = document.getElementById('copy-embed');
  if (copy) {
    copy.addEventListener('click', function () {
      var code = document.getElementById('embed-code').textContent;
      navigator.clipboard.writeText(code).then(function () {
        var was = copy.textContent;
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = was; }, 1600);
      });
    });
  }
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!confirm(form.dataset.confirm)) event.preventDefault();
    });
  });
})();`;

function itemHtml(row, filter) {
  const live = row.approved === 1;
  return `
<article class="item${live ? '' : ' item--pending'}">
  <div>
    <div class="item-head">
      ${avatarHtml(row)}
      <div class="who">
        <span class="name">${escapeHtml(row.name)}</span>
        ${row.role ? `<span class="role">${escapeHtml(row.role)}</span>` : ''}
      </div>
      ${starsHtml(row.rating)}
    </div>
    <p class="item-body">${escapeHtml(row.text)}</p>
    <div class="item-foot">
      <span class="badge ${live ? 'badge--live' : 'badge--pending'}">${live ? 'Live' : 'Pending'}</span>
      <span>#${row.id}</span>
      <span>Received ${escapeHtml(formatDate(row.created_at))}</span>
      ${row.avatar ? '<span>Photo attached</span>' : '<span>No photo</span>'}
    </div>
  </div>
  <div class="item-actions">
    ${
      live
        ? `<form method="post" action="/admin/${row.id}/unapprove">
             <input type="hidden" name="filter" value="${escapeHtml(filter)}">
             <button class="btn btn--sm" type="submit">Unpublish</button>
           </form>`
        : `<form method="post" action="/admin/${row.id}/approve">
             <input type="hidden" name="filter" value="${escapeHtml(filter)}">
             <button class="btn btn--sm btn--primary" type="submit">Approve</button>
           </form>`
    }
    <form method="post" action="/admin/${row.id}/delete"
          data-confirm="Delete the testimonial from ${escapeHtml(row.name).replace(/"/g, '&quot;')}? This cannot be undone.">
      <input type="hidden" name="filter" value="${escapeHtml(filter)}">
      <button class="btn btn--sm btn--danger" type="submit">Delete</button>
    </form>
  </div>
</article>`;
}

export function renderAdmin({ rows, filter, totals, origin, flash = '' }) {
  const tab = (key, label) => {
    const count = key === 'all' ? totals.total : totals[key];
    return `<a class="tab" href="/admin?filter=${key}"${filter === key ? ' aria-current="page"' : ''}>
      ${label}<span class="count">${count}</span>
    </a>`;
  };

  const embedCode = `<div id="senja-wall"></div>
<script src="${origin}/embed.js" async></script>`;

  const list = rows.length
    ? rows.map((row) => itemHtml(row, filter)).join('')
    : `<div class="empty">Nothing ${filter === 'all' ? 'here' : `in ${filter}`} right now.</div>`;

  const body = `
<h1>Moderation</h1>
<p class="sub">${totals.pending} awaiting review &middot; ${totals.approved} live on the wall</p>

${flash ? `<div class="flash flash--ok" role="status">${escapeHtml(flash)}</div>` : ''}

<div class="tabs">
  ${tab('pending', 'Pending')}
  ${tab('approved', 'Approved')}
  ${tab('all', 'All')}
</div>

${list}

<section class="embed">
  <h2>Embed the wall</h2>
  <p>Drop this into any page. It renders inline &mdash; no iframe &mdash; and inherits the host page&rsquo;s font.</p>
  <div class="snippet">
    <button class="btn btn--sm" type="button" id="copy-embed">Copy</button>
    <pre><code id="embed-code">${escapeHtml(embedCode)}</code></pre>
  </div>
  <p class="snippet-note">
    Options go on the div: <code>data-limit="12"</code>, <code>data-columns="3"</code>,
    <code>data-theme="light|dark|auto"</code>, <code>data-min-rating="4"</code>.
  </p>
</section>`;

  return layout({
    title: `Admin - ${config.siteName}`,
    head: css,
    body,
    script,
    wide: true,
    nav: `<a class="btn btn--sm btn--ghost" href="/wall">Wall</a><a class="btn btn--sm btn--ghost" href="/submit">Form</a>`,
  });
}
