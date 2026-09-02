'use strict';

const { html, raw, toString } = require('../html');
const { fieldOptions } = require('../fields');
const config = require('../config');

const DEFAULT_ACCENT = '#2f6fed';

function normalizeColor(value) {
  const v = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : DEFAULT_ACCENT;
}

/** Picks black or white text for a button filled with `hex`. */
function contrastText(hex) {
  const c = normalizeColor(hex).slice(1);
  const channel = (i) => {
    const s = parseInt(c.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? '#16181d' : '#ffffff';
}

function page({ form, title, body }) {
  const accent = normalizeColor(form.accent_color);
  return toString(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="stylesheet" href="/static/form.css">
<style>:root { --accent: ${accent}; --accent-fg: ${contrastText(accent)}; }</style>
</head>
<body>
<div class="wrap">
  <header class="form-header">
    <h1>${form.title}</h1>
    ${form.description ? html`<p>${form.description}</p>` : ''}
  </header>
  ${body}
</div>
<script src="/static/form.js" defer></script>
</body>
</html>`);
}

function fieldControl(field, values, errors) {
  const key = field.key;
  const value = values[key];
  const invalid = Boolean(errors[key]);
  const required = field.required ? raw(' required') : '';
  const aria = invalid ? raw(' aria-invalid="true"') : '';
  const describedBy = field.help_text ? raw(` aria-describedby="help-${key}"`) : '';

  switch (field.type) {
    case 'textarea':
      return html`<textarea id="f-${key}" name="${key}" data-type="textarea" maxlength="10000"
        placeholder="${field.placeholder}"${required}${aria}${describedBy}>${value || ''}</textarea>`;

    case 'email':
      return html`<input id="f-${key}" name="${key}" type="email" inputmode="email"
        autocomplete="email" data-type="email" maxlength="500"
        value="${value || ''}" placeholder="${field.placeholder}"${required}${aria}${describedBy}>`;

    case 'select': {
      const options = fieldOptions(field);
      return html`<select id="f-${key}" name="${key}" data-type="select"${required}${aria}${describedBy}>
        <option value="">${field.placeholder || 'Choose…'}</option>
        ${options.map(
          (opt) =>
            html`<option value="${opt}"${value === opt ? raw(' selected') : ''}>${opt}</option>`
        )}
      </select>`;
    }

    case 'file':
      return html`<input id="f-${key}" name="${key}" type="file" data-type="file"${required}${aria}${describedBy}>`;

    case 'text':
    default:
      return html`<input id="f-${key}" name="${key}" type="text" data-type="text" maxlength="500"
        value="${value || ''}" placeholder="${field.placeholder}"${required}${aria}${describedBy}>`;
  }
}

function renderField(field, values, errors) {
  const key = field.key;
  const error = errors[key];
  const help = field.help_text
    ? html`<span class="help" id="help-${key}">${field.help_text}</span>`
    : '';
  const star = field.required ? html`<span class="req" aria-hidden="true">*</span>` : '';

  if (field.type === 'checkbox') {
    return html`<div class="field${error ? raw(' has-error') : ''}">
      ${help}
      <div class="checkbox-row">
        <input id="f-${key}" name="${key}" type="checkbox" value="yes" data-type="checkbox"
          ${values[key] ? raw('checked') : ''}${field.required ? raw(' required') : ''}
          ${error ? raw('aria-invalid="true"') : ''}>
        <label for="f-${key}">${field.label}${star}</label>
      </div>
      ${error ? html`<span class="error">${error}</span>` : ''}
    </div>`;
  }

  return html`<div class="field${error ? raw(' has-error') : ''}">
    <label for="f-${key}">${field.label}${star}</label>
    ${help}
    ${fieldControl(field, values, errors)}
    ${error ? html`<span class="error">${error}</span>` : ''}
  </div>`;
}

function renderForm({ form, fields, values = {}, errors = {}, formError = null }) {
  const hasFile = fields.some((f) => f.type === 'file');

  const body = html`
    <form class="card" method="post" action="/f/${form.slug}" data-validate
      data-max-bytes="${String(config.maxUploadBytes)}"
      ${hasFile ? raw('enctype="multipart/form-data"') : ''}>
      ${formError ? html`<div class="form-error" role="alert">${formError}</div>` : ''}
      ${fields.map((field) => renderField(field, values, errors))}

      <div class="hp" aria-hidden="true">
        <label for="f-website-url">Leave this field empty</label>
        <input id="f-website-url" type="text" name="website_url" tabindex="-1" autocomplete="off">
      </div>

      <button type="submit">${form.submit_label || 'Submit'}</button>
    </form>
    ${hasFile
      ? html`<p class="footnote">Files up to ${String(config.maxUploadMb)} MB.</p>`
      : ''}
  `;

  return page({ form, title: form.title, body });
}

function renderSuccess(form) {
  const body = html`<div class="card done">
    <div class="tick" aria-hidden="true">&check;</div>
    <p>${form.success_message}</p>
  </div>`;
  return page({ form, title: `${form.title} — thanks`, body });
}

function renderClosed(form) {
  const body = html`<div class="card closed">
    <p>This form is not accepting responses right now.</p>
  </div>`;
  return page({ form, title: form.title, body });
}

function renderNotFound() {
  const form = { title: 'Form not found', description: '', accent_color: DEFAULT_ACCENT };
  const body = html`<div class="card closed">
    <p>There is no form at this address.</p>
  </div>`;
  return page({ form, title: 'Not found', body });
}

module.exports = {
  renderForm,
  renderSuccess,
  renderClosed,
  renderNotFound,
  normalizeColor,
  contrastText,
};
