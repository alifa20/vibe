'use strict';

const { fieldOptions } = require('./fields');

const MAX_TEXT = 500;
const MAX_TEXTAREA = 10000;

// Deliberately permissive: the goal is to catch typos, not to police the RFC.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Validates a submission against a form's field definitions.
 *
 * @param {Array} fields   field rows, ordered by position
 * @param {Object} body    parsed urlencoded/multipart text fields
 * @param {Object} files   map of field key -> multer file (may be empty)
 * @returns {{ ok: boolean, values: Object, errors: Object }}
 *          `values` is keyed by field key and safe to persist; for file
 *          fields the value is a descriptor object, for checkboxes a boolean.
 */
function validateSubmission(fields, body, files = {}) {
  const values = {};
  const errors = {};

  for (const field of fields) {
    const key = field.key;
    const required = Boolean(field.required);
    const rawValue = body[key];
    // Multipart bodies can repeat a key; take the last value rather than an array.
    const single = Array.isArray(rawValue) ? rawValue[rawValue.length - 1] : rawValue;
    const text = typeof single === 'string' ? single.trim() : '';

    switch (field.type) {
      case 'text':
      case 'textarea': {
        const limit = field.type === 'text' ? MAX_TEXT : MAX_TEXTAREA;
        if (!text) {
          if (required) errors[key] = 'This field is required.';
          values[key] = '';
        } else if (text.length > limit) {
          errors[key] = `Please keep this under ${limit} characters.`;
          values[key] = text.slice(0, limit);
        } else {
          values[key] = text;
        }
        break;
      }

      case 'email': {
        if (!text) {
          if (required) errors[key] = 'This field is required.';
          values[key] = '';
        } else if (text.length > MAX_TEXT || !EMAIL_RE.test(text)) {
          errors[key] = 'Please enter a valid email address.';
          values[key] = text.slice(0, MAX_TEXT);
        } else {
          values[key] = text;
        }
        break;
      }

      case 'select': {
        const allowed = fieldOptions(field);
        if (!text) {
          if (required) errors[key] = 'Please choose an option.';
          values[key] = '';
        } else if (!allowed.includes(text)) {
          errors[key] = 'Please choose one of the listed options.';
          values[key] = '';
        } else {
          values[key] = text;
        }
        break;
      }

      case 'checkbox': {
        // An unchecked box submits nothing at all.
        const checked = single !== undefined && single !== '' && single !== '0';
        if (required && !checked) errors[key] = 'This box must be checked.';
        values[key] = checked;
        break;
      }

      case 'file': {
        const file = files[key];
        if (!file) {
          if (required) errors[key] = 'A file is required.';
          values[key] = null;
        } else {
          values[key] = {
            name: file.originalname,
            size: file.size,
            type: file.mimetype,
            stored: file.storedRelPath,
          };
        }
        break;
      }

      default:
        // Unknown type in the DB: record nothing rather than guessing.
        values[key] = '';
    }
  }

  return { ok: Object.keys(errors).length === 0, values, errors };
}

module.exports = { validateSubmission, EMAIL_RE, MAX_TEXT, MAX_TEXTAREA };
