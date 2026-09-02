import { config } from './config.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

export const initials = (name) =>
  [...String(name).trim().split(/\s+/).slice(0, 2)]
    .map((word) => [...word][0] ?? '')
    .join('')
    .toUpperCase() || '?';

/** Deterministic hue so a given name always gets the same fallback swatch. */
export const nameHue = (name) => {
  let hash = 0;
  for (const char of String(name)) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return hash;
};

export const avatarUrl = (filename) => (filename ? `/uploads/${filename}` : null);

export function avatarHtml(row, extraClass = '') {
  const cls = `avatar ${extraClass}`.trim();
  if (row.avatar) {
    return `<img class="${cls}" src="${escapeHtml(avatarUrl(row.avatar))}" alt="" width="${config.avatarSize}" height="${config.avatarSize}" loading="lazy" decoding="async">`;
  }
  return `<span class="${cls} avatar--fallback" style="--hue:${nameHue(row.name)}" aria-hidden="true">${escapeHtml(initials(row.name))}</span>`;
}

export function starsHtml(rating) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  const stars = Array.from({ length: 5 }, (_, i) =>
    `<span class="star${i < value ? ' star--on' : ''}">&#9733;</span>`,
  ).join('');
  return `<span class="stars" role="img" aria-label="${value} out of 5 stars">${stars}</span>`;
}

export const formatDate = (iso) => {
  const date = new Date(iso?.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const baseCss = `
:root {
  --bg: #faf9f7;
  --bg-elev: #ffffff;
  --bg-sunk: #f2f0ec;
  --line: #e6e2da;
  --ink: #191817;
  --ink-2: #6e6a63;
  --ink-3: #98928a;
  --accent: #191817;
  --accent-ink: #ffffff;
  --star: #d99b1f;
  --danger: #b4402f;
  --ok: #2f7a52;
  --shadow: 0 1px 2px rgba(24,23,22,.05), 0 10px 28px -16px rgba(24,23,22,.22);
  --radius: 14px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d0d0f;
    --bg-elev: #16161a;
    --bg-sunk: #101013;
    --line: #27272c;
    --ink: #f0efec;
    --ink-2: #a49f98;
    --ink-3: #726d67;
    --accent: #f0efec;
    --accent-ink: #131315;
    --star: #f0b537;
    --danger: #e2705d;
    --ok: #5cbd8a;
    --shadow: 0 1px 2px rgba(0,0,0,.5), 0 12px 32px -18px rgba(0,0,0,.9);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0d0d0f;
  --bg-elev: #16161a;
  --bg-sunk: #101013;
  --line: #27272c;
  --ink: #f0efec;
  --ink-2: #a49f98;
  --ink-3: #726d67;
  --accent: #f0efec;
  --accent-ink: #131315;
  --star: #f0b537;
  --danger: #e2705d;
  --ok: #5cbd8a;
  --shadow: 0 1px 2px rgba(0,0,0,.5), 0 12px 32px -18px rgba(0,0,0,.9);
  color-scheme: dark;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: inherit; }
:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 4px; }

.shell { max-width: 1180px; margin: 0 auto; padding: 28px 20px 80px; }
.shell--narrow { max-width: 640px; }

.topbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; margin-bottom: 44px;
}
.brand {
  display: inline-flex; align-items: center; gap: 9px;
  font-weight: 620; letter-spacing: -.015em; text-decoration: none; font-size: 15px;
}
.brand .mark {
  width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center;
  background: var(--accent); color: var(--accent-ink); font-size: 12px; font-weight: 700;
}
.topbar nav { display: flex; align-items: center; gap: 6px; }

.btn {
  --btn-bg: var(--bg-elev);
  --btn-ink: var(--ink);
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  padding: 8px 14px; border-radius: 9px; border: 1px solid var(--line);
  background: var(--btn-bg); color: var(--btn-ink);
  font: inherit; font-size: 14px; font-weight: 520; line-height: 1.2;
  text-decoration: none; cursor: pointer;
  transition: background .15s ease, border-color .15s ease, transform .1s ease;
}
.btn:hover { border-color: var(--ink-3); }
.btn:active { transform: translateY(1px); }
.btn--primary { --btn-bg: var(--accent); --btn-ink: var(--accent-ink); border-color: var(--accent); }
.btn--primary:hover { opacity: .88; border-color: var(--accent); }
.btn--ghost { --btn-bg: transparent; border-color: transparent; color: var(--ink-2); }
.btn--ghost:hover { background: var(--bg-sunk); border-color: transparent; color: var(--ink); }
.btn--danger { color: var(--danger); }
.btn--danger:hover { border-color: var(--danger); }
.btn--sm { padding: 6px 11px; font-size: 13px; }
.btn--icon { padding: 8px; width: 34px; }

.stars { display: inline-flex; gap: 2px; line-height: 1; }
.star { color: var(--line); font-size: 15px; }
.star--on { color: var(--star); }

.avatar {
  width: 40px; height: 40px; border-radius: 50%; flex: none;
  object-fit: cover; background: var(--bg-sunk);
  border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
}
.avatar--fallback {
  display: grid; place-items: center;
  background: hsl(var(--hue) 42% 88%); color: hsl(var(--hue) 45% 26%);
  font-size: 13px; font-weight: 640; letter-spacing: .02em;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .avatar--fallback {
    background: hsl(var(--hue) 28% 24%); color: hsl(var(--hue) 55% 82%);
  }
}
:root[data-theme="dark"] .avatar--fallback {
  background: hsl(var(--hue) 28% 24%); color: hsl(var(--hue) 55% 82%);
}

.muted { color: var(--ink-2); }
.tiny { font-size: 13px; }

.flash {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 13px 15px; border-radius: 11px; margin-bottom: 22px;
  border: 1px solid var(--line); background: var(--bg-elev); font-size: 14px;
}
.flash--error { border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); color: var(--danger); }
.flash--ok { border-color: color-mix(in srgb, var(--ok) 45%, var(--line)); color: var(--ok); }

footer.site {
  margin-top: 64px; padding-top: 20px; border-top: 1px solid var(--line);
  color: var(--ink-3); font-size: 13px;
  display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
}
`;

const themeToggle = `
<button class="btn btn--icon btn--ghost" id="theme-toggle" type="button" title="Toggle dark mode" aria-label="Toggle dark mode">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>
  </svg>
</button>`;

const themeScript = `
(function () {
  var root = document.documentElement;
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('senja-theme', root.dataset.theme); } catch (e) {}
  });
})();`;

export function layout({ title, description = '', head = '', body, script = '', nav = '', wide = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%E2%AD%90%3C/text%3E%3C/svg%3E">
<script>try{var t=localStorage.getItem('senja-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<style>${baseCss}${head}</style>
</head>
<body>
<div class="shell${wide ? '' : ' shell--narrow'}">
  <header class="topbar">
    <a class="brand" href="/wall">
      <span class="mark">&#9733;</span>
      ${escapeHtml(config.siteName)}
    </a>
    <nav>${nav}${themeToggle}</nav>
  </header>
  ${body}
  <footer class="site">
    <span>${escapeHtml(config.siteName)}</span>
    <span>Self-hosted testimonials</span>
  </footer>
</div>
<script>${themeScript}${script}</script>
</body>
</html>`;
}
