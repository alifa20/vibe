'use strict';

/**
 * Tiny tagged-template renderer. Every interpolated value is HTML-escaped
 * unless it is wrapped with raw() or is the result of another html`` call.
 * Arrays are joined with no separator so `${items.map(...)}` works.
 */

const RAW = Symbol('raw-html');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function raw(value) {
  return { [RAW]: true, value: String(value) };
}

function isRaw(value) {
  return value !== null && typeof value === 'object' && value[RAW] === true;
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (isRaw(value)) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1];
  }
  return raw(out);
}

/** Turns an html`` result (or string) into a plain string for res.send(). */
function toString(value) {
  return render(value);
}

/** Escapes a value for embedding inside a <script> JSON blob. */
function jsonScript(value) {
  return raw(
    JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
  );
}

module.exports = { html, raw, escapeHtml, toString, jsonScript };
