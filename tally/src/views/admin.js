'use strict';

const { html, raw, toString } = require('../html');
const { FIELD_TYPES, typeLabel, fieldOptions } = require('../fields');
const { displayValue, formatBytes } = require('../notify');
const config = require('../config');

const OPTION_TYPES = FIELD_TYPES.filter((t) => t.hasOptions).map((t) => t.type).join(',');

function layout({ title, body, narrow = false, flash = null }) {
  return toString(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — Forms admin</title>
<link rel="stylesheet" href="/static/admin.css">
</head>
<body>
<div class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="/admin">Forms</a>
    <span class="spacer"></span>
    <a class="plain" href="/admin/forms/new">New form</a>
    <form method="post" action="/admin/logout"><button class="linklike" type="submit">Log out</button></form>
  </div>
</div>
<main${narrow ? raw(' class="narrow"') : ''}>
  ${flash ? html`<div class="flash ${flash.type}">${flash.text}</div>` : ''}
  ${body}
</main>
<script src="/static/admin.js" defer></script>
</body>
</html>`);
}

function loginPage({ error = null, next = '/admin' } = {}) {
  return toString(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in — Forms admin</title>
<link rel="stylesheet" href="/static/admin.css">
</head>
<body>
<div class="login-wrap">
  <h1>Forms</h1>
  <p class="sub">Enter the admin token to continue.</p>
  ${error ? html`<div class="flash err">${error}</div>` : ''}
  <form method="post" action="/admin/login">
    <input type="hidden" name="next" value="${next}">
    <div class="row">
      <label class="lbl" for="token">Admin token</label>
      <input id="token" name="token" type="password" autocomplete="current-password" autofocus required>
    </div>
    <button class="btn btn-primary" type="submit">Sign in</button>
  </form>
</div>
</body>
</html>`);
}

/* ------------------------------------------------------------------ forms */

function formsIndex({ forms, flash }) {
  const body = html`
    <div class="page-head">
      <div>
        <h1>Forms</h1>
        <p class="sub">${String(forms.length)} form${forms.length === 1 ? '' : 's'}</p>
      </div>
      <span class="spacer"></span>
      <a class="btn btn-primary" href="/admin/forms/new">New form</a>
    </div>

    ${forms.length === 0
      ? html`<div class="empty">No forms yet. <a href="/admin/forms/new">Create the first one.</a></div>`
      : html`<div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Form</th>
                <th class="nowrap">Public link</th>
                <th class="nowrap">Responses</th>
                <th class="nowrap">Status</th>
                <th class="nowrap"></th>
              </tr>
            </thead>
            <tbody>
              ${forms.map(
                (f) => html`<tr>
                  <td>
                    <span class="swatch" style="background:${f.accent_color}"></span>
                    <a href="/admin/forms/${String(f.id)}">${f.title}</a>
                  </td>
                  <td class="nowrap mono"><a href="/f/${f.slug}" target="_blank" rel="noopener">/f/${f.slug}</a></td>
                  <td class="nowrap">
                    ${f.response_count > 0
                      ? html`<a href="/admin/forms/${String(f.id)}/responses">${String(f.response_count)}</a>`
                      : html`<span style="color:var(--muted)">0</span>`}
                  </td>
                  <td class="nowrap">
                    ${f.is_open
                      ? html`<span class="tag on">Open</span>`
                      : html`<span class="tag">Closed</span>`}
                  </td>
                  <td class="nowrap"><a href="/admin/forms/${String(f.id)}">Edit</a></td>
                </tr>`
              )}
            </tbody>
          </table>
        </div>`}
  `;
  return layout({ title: 'Forms', body, flash });
}

function newFormPage({ values = {}, error = null } = {}) {
  const body = html`
    <div class="crumb"><a href="/admin">Forms</a> / New</div>
    <div class="page-head"><h1>New form</h1></div>
    ${error ? html`<div class="flash err">${error}</div>` : ''}
    <form class="card" method="post" action="/admin/forms">
      <div class="row">
        <label class="lbl" for="title">Title</label>
        <input id="title" name="title" type="text" required maxlength="120" value="${values.title || ''}" autofocus>
      </div>
      <div class="row">
        <label class="lbl" for="slug">Slug</label>
        <input id="slug" name="slug" type="text" maxlength="60" value="${values.slug || ''}" placeholder="auto from title">
        <p class="hint">The form will live at ${config.baseUrl}/f/<strong>slug</strong>.</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Create form</button>
        <a class="btn" href="/admin">Cancel</a>
      </div>
    </form>
  `;
  return layout({ title: 'New form', body, narrow: true });
}

function fieldRow(form, field, index, total) {
  const options = fieldOptions(field);
  return html`<div class="field-row">
    <div class="order">
      <form method="post" action="/admin/fields/${String(field.id)}/move">
        <input type="hidden" name="dir" value="up">
        <button class="btn btn-icon" type="submit" title="Move up" ${index === 0 ? raw('disabled') : ''}>&uarr;</button>
      </form>
      <form method="post" action="/admin/fields/${String(field.id)}/move">
        <input type="hidden" name="dir" value="down">
        <button class="btn btn-icon" type="submit" title="Move down" ${index === total - 1 ? raw('disabled') : ''}>&darr;</button>
      </form>
    </div>
    <div class="grow">
      <div class="name">${field.label}</div>
      <div class="meta">
        <span class="mono">${field.key}</span> · ${typeLabel(field.type)}${options.length
          ? html` · ${String(options.length)} options`
          : ''}
      </div>
    </div>
    ${field.required ? html`<span class="tag req">Required</span>` : ''}
    <a class="btn btn-sm" href="/admin/fields/${String(field.id)}/edit">Edit</a>
    <form method="post" action="/admin/fields/${String(field.id)}/delete"
      data-confirm="Delete the field “${field.label}”? Existing responses keep their stored answers but this column disappears from the table.">
      <button class="btn btn-sm btn-danger" type="submit">Delete</button>
    </form>
  </div>`;
}

function formEditor({ form, fields, responseCount, flash, fieldError = null, fieldValues = {} }) {
  const publicUrl = `${config.baseUrl}/f/${form.slug}`;

  const body = html`
    <div class="crumb"><a href="/admin">Forms</a> / ${form.title}</div>
    <div class="page-head">
      <div>
        <h1>${form.title}</h1>
        <p class="sub">
          <span class="swatch" style="background:${form.accent_color}"></span>
          <a href="/f/${form.slug}" target="_blank" rel="noopener">${publicUrl}</a>
        </p>
      </div>
      <span class="spacer"></span>
      <div class="actions">
        <button class="btn" type="button" data-copy="${publicUrl}">Copy link</button>
        <a class="btn" href="/admin/forms/${String(form.id)}/responses">Responses (${String(responseCount)})</a>
      </div>
    </div>

    <div class="card">
      <h2>Fields</h2>
      ${fields.length === 0
        ? html`<div class="empty">No fields yet. Add the first one below.</div>`
        : fields.map((f, i) => fieldRow(form, f, i, fields.length))}
    </div>

    <div class="card">
      <h2>Add a field</h2>
      ${fieldError ? html`<div class="flash err">${fieldError}</div>` : ''}
      <form method="post" action="/admin/forms/${String(form.id)}/fields">
        <div class="grid-2">
          <div class="row">
            <label class="lbl" for="label">Label</label>
            <input id="label" name="label" type="text" required maxlength="120" value="${fieldValues.label || ''}">
          </div>
          <div class="row">
            <label class="lbl" for="type">Type</label>
            <select id="type" name="type" data-type-select="${OPTION_TYPES}">
              ${FIELD_TYPES.map(
                (t) =>
                  html`<option value="${t.type}"${fieldValues.type === t.type ? raw(' selected') : ''}>${t.label}</option>`
              )}
            </select>
          </div>
        </div>
        <div class="row" data-options-row hidden>
          <label class="lbl" for="options">Options</label>
          <textarea id="options" name="options" rows="4" placeholder="One per line">${fieldValues.options || ''}</textarea>
        </div>
        <div class="grid-2">
          <div class="row" data-placeholder-row>
            <label class="lbl" for="placeholder">Placeholder</label>
            <input id="placeholder" name="placeholder" type="text" maxlength="120" value="${fieldValues.placeholder || ''}">
          </div>
          <div class="row">
            <label class="lbl" for="help_text">Help text</label>
            <input id="help_text" name="help_text" type="text" maxlength="200" value="${fieldValues.help_text || ''}">
          </div>
        </div>
        <div class="row check">
          <input id="required" name="required" type="checkbox" value="1" ${fieldValues.required ? raw('checked') : ''}>
          <label for="required">Required</label>
        </div>
        <button class="btn btn-primary" type="submit">Add field</button>
      </form>
    </div>

    <div class="card">
      <h2>Settings</h2>
      <form method="post" action="/admin/forms/${String(form.id)}">
        <div class="row">
          <label class="lbl" for="f-title">Title</label>
          <input id="f-title" name="title" type="text" required maxlength="120" value="${form.title}">
        </div>
        <div class="row">
          <label class="lbl" for="description">Description</label>
          <textarea id="description" name="description" rows="3" maxlength="2000">${form.description}</textarea>
        </div>
        <div class="grid-2">
          <div class="row">
            <label class="lbl" for="slug">Slug</label>
            <input id="slug" name="slug" type="text" required maxlength="60" value="${form.slug}">
            <p class="hint">Changing this breaks links you have already shared.</p>
          </div>
          <div class="row">
            <label class="lbl" for="accent_color">Accent colour</label>
            <input id="accent_color" name="accent_color" type="color" value="${form.accent_color}">
            <span class="mono" style="margin-left:8px">${form.accent_color}</span>
          </div>
        </div>
        <div class="grid-2">
          <div class="row">
            <label class="lbl" for="submit_label">Submit button text</label>
            <input id="submit_label" name="submit_label" type="text" maxlength="40" value="${form.submit_label}">
          </div>
          <div class="row">
            <label class="lbl" for="success_message">Message after submitting</label>
            <input id="success_message" name="success_message" type="text" maxlength="300" value="${form.success_message}">
          </div>
        </div>
        <div class="row check">
          <input id="is_open" name="is_open" type="checkbox" value="1" ${form.is_open ? raw('checked') : ''}>
          <label for="is_open">Accepting responses</label>
        </div>
        <button class="btn btn-primary" type="submit">Save settings</button>
      </form>
    </div>

    <div class="card">
      <h2>Notifications</h2>
      <form method="post" action="/admin/forms/${String(form.id)}/notifications">
        <div class="row check">
          <input id="notify_email" name="notify_email" type="checkbox" value="1" ${form.notify_email ? raw('checked') : ''}>
          <label for="notify_email">Email me each response</label>
        </div>
        <div class="row">
          <label class="lbl" for="notify_email_to">Send to</label>
          <input id="notify_email_to" name="notify_email_to" type="email" maxlength="200"
            value="${form.notify_email_to}" placeholder="${config.notifyEmailTo || 'you@example.com'}">
          <p class="hint">
            ${config.smtp.enabled
              ? html`Blank uses NOTIFY_EMAIL_TO from .env. Sending via ${config.smtp.host}.`
              : html`SMTP is not configured — set SMTP_HOST in .env for this to do anything.`}
          </p>
        </div>
        <div class="row">
          <label class="lbl" for="webhook_url">Webhook URL</label>
          <input id="webhook_url" name="webhook_url" type="url" maxlength="500"
            value="${form.webhook_url}" placeholder="https://example.com/hook">
          <p class="hint">Each response is POSTed as JSON. Leave blank to disable.</p>
        </div>
        <button class="btn btn-primary" type="submit">Save notifications</button>
      </form>
    </div>

    <div class="card">
      <h2>Danger zone</h2>
      <form method="post" action="/admin/forms/${String(form.id)}/delete"
        data-confirm="Delete “${form.title}”, its ${String(responseCount)} response(s) and any uploaded files? This cannot be undone.">
        <button class="btn btn-danger" type="submit">Delete this form</button>
      </form>
    </div>
  `;

  return layout({ title: form.title, body, flash });
}

function fieldEditor({ form, field, error = null }) {
  const options = fieldOptions(field).join('\n');
  const body = html`
    <div class="crumb">
      <a href="/admin">Forms</a> / <a href="/admin/forms/${String(form.id)}">${form.title}</a> / Field
    </div>
    <div class="page-head"><h1>Edit field</h1></div>
    ${error ? html`<div class="flash err">${error}</div>` : ''}
    <form class="card" method="post" action="/admin/fields/${String(field.id)}">
      <div class="grid-2">
        <div class="row">
          <label class="lbl" for="label">Label</label>
          <input id="label" name="label" type="text" required maxlength="120" value="${field.label}">
        </div>
        <div class="row">
          <label class="lbl" for="type">Type</label>
          <select id="type" name="type" data-type-select="${OPTION_TYPES}">
            ${FIELD_TYPES.map(
              (t) => html`<option value="${t.type}"${field.type === t.type ? raw(' selected') : ''}>${t.label}</option>`
            )}
          </select>
        </div>
      </div>
      <div class="row" data-options-row hidden>
        <label class="lbl" for="options">Options</label>
        <textarea id="options" name="options" rows="5" placeholder="One per line">${options}</textarea>
      </div>
      <div class="grid-2">
        <div class="row" data-placeholder-row>
          <label class="lbl" for="placeholder">Placeholder</label>
          <input id="placeholder" name="placeholder" type="text" maxlength="120" value="${field.placeholder}">
        </div>
        <div class="row">
          <label class="lbl" for="help_text">Help text</label>
          <input id="help_text" name="help_text" type="text" maxlength="200" value="${field.help_text}">
        </div>
      </div>
      <div class="row">
        <label class="lbl" for="key">Key</label>
        <input id="key" name="key" type="text" required maxlength="60" value="${field.key}">
        <p class="hint">Used as the form input name, the CSV column header and the webhook JSON key.
          Changing it hides answers already stored under the old key.</p>
      </div>
      <div class="row check">
        <input id="required" name="required" type="checkbox" value="1" ${field.required ? raw('checked') : ''}>
        <label for="required">Required</label>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Save field</button>
        <a class="btn" href="/admin/forms/${String(form.id)}">Cancel</a>
      </div>
    </form>
  `;
  return layout({ title: 'Edit field', body, narrow: true, flash: null });
}

/* -------------------------------------------------------------- responses */

function sortLink(baseUrl, key, label, sort, dir, { nowrap = false } = {}) {
  const active = sort === key;
  const nextDir = active && dir === 'desc' ? 'asc' : 'desc';
  const arrow = active ? (dir === 'desc' ? '▼' : '▲') : '↕';
  const classes = ['sortable', nowrap ? 'nowrap' : '', active ? 'sorted' : '']
    .filter(Boolean)
    .join(' ');
  return html`<th class="${classes}">
    <a href="${baseUrl}?sort=${key}&amp;dir=${nextDir}" title="${label}"
      ><span class="th-label">${label}</span><span class="arrow">${arrow}</span></a>
  </th>`;
}

function cellValue(field, value) {
  if (field.type === 'file') {
    if (!value) return html`<span style="color:var(--muted)">—</span>`;
    return html`<a href="/admin/uploads/${encodeURIComponent(value.stored)}" download>${value.name}</a>
      <span style="color:var(--muted)"> (${formatBytes(value.size)})</span>`;
  }
  const text = displayValue(field, value);
  if (text === '—') return html`<span style="color:var(--muted)">—</span>`;
  return html`${text}`;
}

function responsesPage({ form, fields, rows, total, sort, dir, page, pages, flash }) {
  const base = `/admin/forms/${form.id}/responses`;

  const body = html`
    <div class="crumb">
      <a href="/admin">Forms</a> / <a href="/admin/forms/${String(form.id)}">${form.title}</a> / Responses
    </div>
    <div class="page-head">
      <div>
        <h1>Responses</h1>
        <p class="sub">${String(total)} response${total === 1 ? '' : 's'} to ${form.title}</p>
      </div>
      <span class="spacer"></span>
      <div class="actions">
        <a class="btn" href="/admin/forms/${String(form.id)}">Edit form</a>
        <a class="btn btn-primary" href="${base}.csv">Export CSV</a>
      </div>
    </div>

    ${total === 0
      ? html`<div class="empty">No responses yet.
          <a href="/f/${form.slug}" target="_blank" rel="noopener">Open the form</a>.</div>`
      : html`
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                ${sortLink(base, 'created_at', 'Submitted', sort, dir, { nowrap: true })}
                ${fields.map((f) => sortLink(base, f.key, f.label, sort, dir))}
                <th class="nowrap"></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(
                (row) => html`<tr>
                  <td class="nowrap">
                    <a href="${base}/${String(row.id)}">${row.created_at} UTC</a>
                  </td>
                  ${fields.map(
                    (f) => html`<td class="cell">${cellValue(f, row.values[f.key])}</td>`
                  )}
                  <td class="nowrap"><a href="${base}/${String(row.id)}">View</a></td>
                </tr>`
              )}
            </tbody>
          </table>
        </div>
        ${pages > 1
          ? html`<div class="actions" style="margin-top:16px">
              ${page > 1
                ? html`<a class="btn btn-sm" href="${base}?sort=${sort}&amp;dir=${dir}&amp;page=${String(page - 1)}">Previous</a>`
                : ''}
              <span style="color:var(--muted);font-size:13.5px">Page ${String(page)} of ${String(pages)}</span>
              ${page < pages
                ? html`<a class="btn btn-sm" href="${base}?sort=${sort}&amp;dir=${dir}&amp;page=${String(page + 1)}">Next</a>`
                : ''}
            </div>`
          : ''}
      `}
  `;

  return layout({ title: `${form.title} responses`, body, flash });
}

function responseDetail({ form, fields, response, values, orphans }) {
  const base = `/admin/forms/${form.id}/responses`;
  const body = html`
    <div class="crumb">
      <a href="/admin">Forms</a> / <a href="/admin/forms/${String(form.id)}">${form.title}</a> /
      <a href="${base}">Responses</a> / #${String(response.id)}
    </div>
    <div class="page-head">
      <div>
        <h1>Response #${String(response.id)}</h1>
        <p class="sub">${response.created_at} UTC · ${response.ip || 'unknown IP'}</p>
      </div>
      <span class="spacer"></span>
      <form method="post" action="${base}/${String(response.id)}/delete"
        data-confirm="Delete this response and any file it uploaded?">
        <button class="btn btn-danger" type="submit">Delete</button>
      </form>
    </div>

    <div class="card">
      <div class="table-wrap" style="border:none">
        <table>
          <tbody>
            ${fields.map(
              (f) => html`<tr>
                <td class="nowrap" style="color:var(--muted);width:1%">${f.label}</td>
                <td class="cell">${cellValue(f, values[f.key])}</td>
              </tr>`
            )}
            ${orphans.map(
              (o) => html`<tr>
                <td class="nowrap" style="color:var(--muted);width:1%">
                  <span class="mono">${o.key}</span><br><span class="tag">removed field</span>
                </td>
                <td class="cell">${o.text}</td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>Metadata</h2>
      <div class="table-wrap" style="border:none">
        <table>
          <tbody>
            <tr><td class="nowrap" style="color:var(--muted);width:1%">Submitted</td><td>${response.created_at} UTC</td></tr>
            <tr><td class="nowrap" style="color:var(--muted)">IP</td><td class="mono">${response.ip || '—'}</td></tr>
            <tr><td class="nowrap" style="color:var(--muted)">User agent</td><td class="cell mono">${response.user_agent || '—'}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
  return layout({ title: `Response #${response.id}`, body, narrow: true });
}

function errorPage({ status, message }) {
  const body = html`
    <div class="page-head"><h1>${String(status)}</h1></div>
    <div class="card"><p style="margin:0">${message}</p></div>
    <p style="margin-top:18px"><a href="/admin">Back to forms</a></p>
  `;
  return layout({ title: String(status), body, narrow: true });
}

module.exports = {
  layout,
  loginPage,
  formsIndex,
  newFormPage,
  formEditor,
  fieldEditor,
  responsesPage,
  responseDetail,
  errorPage,
};
