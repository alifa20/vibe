'use strict';

const FIELD_TYPES = [
  { type: 'text', label: 'Short text', hasOptions: false, hasPlaceholder: true },
  { type: 'textarea', label: 'Long text', hasOptions: false, hasPlaceholder: true },
  { type: 'email', label: 'Email', hasOptions: false, hasPlaceholder: true },
  { type: 'select', label: 'Dropdown', hasOptions: true, hasPlaceholder: true },
  { type: 'checkbox', label: 'Checkbox', hasOptions: false, hasPlaceholder: false },
  { type: 'file', label: 'File upload', hasOptions: false, hasPlaceholder: false },
];

const TYPE_MAP = new Map(FIELD_TYPES.map((t) => [t.type, t]));

function isValidType(type) {
  return TYPE_MAP.has(type);
}

function typeLabel(type) {
  return TYPE_MAP.get(type)?.label || type;
}

function typeHasOptions(type) {
  return Boolean(TYPE_MAP.get(type)?.hasOptions);
}

/** Lowercase, dash-separated, ASCII-only identifier. */
function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

/**
 * Returns a slug not already present in `taken`, appending -2, -3, ... as needed.
 */
function uniqueSlug(base, taken) {
  const existing = new Set(taken);
  if (!existing.has(base)) return base;
  for (let n = 2; n < 10000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** Splits the admin textarea for select options into a clean array. */
function parseOptions(raw) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function fieldOptions(field) {
  try {
    const parsed = JSON.parse(field.options || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = {
  FIELD_TYPES,
  isValidType,
  typeLabel,
  typeHasOptions,
  slugify,
  uniqueSlug,
  parseOptions,
  fieldOptions,
};
