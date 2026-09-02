const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Markup that is already safe to emit verbatim. */
class Html {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export function raw(value) {
  return value instanceof Html ? value : new Html(String(value ?? ''));
}

function render(value) {
  if (value == null || value === false) return '';
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

/** Tagged template that escapes every interpolation. Nested html`` and raw() pass through. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + strings[i + 1];
  }
  return new Html(out);
}

export function page({ title, nav = '', body, wide = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">
    <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22"><path fill="currentColor" d="M3 3h8v8H3V3Zm2 2v4h4V5H5Zm8-2h8v8h-8V3Zm2 2v4h4V5h-4ZM3 13h8v8H3v-8Zm2 2v4h4v-4H5Zm8-2h3v3h-3v-3Zm5 0h3v3h-3v-3Zm-5 5h3v3h-3v-3Zm5 0h3v3h-3v-3Z"/></svg>
    <span>QR<b>Forge</b></span>
  </a>
  <nav class="topnav">
    <a href="/"${nav === 'generator' ? ' aria-current="page"' : ''}>Generator</a>
    <a href="/admin"${nav === 'admin' ? ' aria-current="page"' : ''}>Dynamic codes</a>
  </nav>
</header>
<main class="${wide ? 'wrap wide' : 'wrap'}">
${body}
</main>
${nav === 'admin' ? '<script src="/admin.js" defer></script>' : ''}
</body>
</html>`;
}
