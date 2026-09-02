#!/usr/bin/env node
/**
 * build.mjs — content.json + src/ → dist/
 *
 * Emits a fully static, single-request page: CSS is inlined, the only
 * subresources are the avatar and the OG image. No dependencies.
 */
import {
  readFileSync, writeFileSync, mkdirSync, rmSync, existsSync,
  copyFileSync, readdirSync, statSync
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "dist");
const OG_W = 1200, OG_H = 630;

const args = new Set(process.argv.slice(2));
const FAST = args.has("--fast"); // skip OG rasterisation (dev rebuilds)

const c = JSON.parse(readFileSync(join(ROOT, "content.json"), "utf8"));
const site = c.site || {};
const theme = c.theme || {};
const baseUrl = String(site.url || "").replace(/\/+$/, "");

/* ── helpers ───────────────────────────────────────────────────── */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("base64");
const abs = (p) => (baseUrl ? baseUrl + "/" + String(p).replace(/^\//, "") : "/" + String(p).replace(/^\//, ""));

function hexToRgb(hex) {
  const h = String(hex).trim().replace("#", "");
  const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
}
const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/** Text colour that sits legibly on the accent (used for the button).
 *  Compare both candidates rather than guessing at a luminance threshold —
 *  a mid-tone accent can fail white text while still looking "dark". */
const onAccent = (hex) =>
  contrast(hex, "#ffffff") >= contrast(hex, "#181410") ? "#ffffff" : "#181410";

const initials = String(c.name || "")
  .split(/\s+/).filter(Boolean).slice(0, 2)
  .map((w) => w[0].toUpperCase()).join("") || "·";

const accent = theme.accent || "#9c4221";
const accentDark = theme.accentDark || accent;

/* Warn early if the chosen accent will fail WCAG AA on body text. */
for (const [label, a, bg] of [["light", accent, "#fbfaf8"], ["dark", accentDark, "#100f0d"]]) {
  const onBtn = contrast(a, onAccent(a));
  if (onBtn < 4.5) {
    console.warn(`⚠  no legible button label sits on accent ${a} (best is ${onBtn.toFixed(2)}:1). Pick a darker or lighter accent.`);
  }
  const ratio = contrast(a, bg);
  if (ratio < 4.5) {
    console.warn(
      `⚠  accent ${a} on the ${label} background is ${ratio.toFixed(2)}:1 (WCAG AA wants 4.5:1). ` +
      `Nudge theme.${label === "light" ? "accent" : "accentDark"} in content.json.`
    );
  }
}

/* ── fresh dist ────────────────────────────────────────────────── */
const prevOgStamp = existsSync(join(OUT, ".ogstamp"))
  ? readFileSync(join(OUT, ".ogstamp"), "utf8") : "";
const prevOg = existsSync(join(OUT, "og.png"))
  ? readFileSync(join(OUT, "og.png")) : null;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* ── avatar: generate a monogram if none is supplied ───────────── */
function monogramSvg(size, text, hex, rounded) {
  const [r, g, b] = hexToRgb(hex);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="rgb(${r},${g},${b})"/>
<stop offset="1" stop-color="rgb(${Math.round(r * 0.62)},${Math.round(g * 0.62)},${Math.round(b * 0.62)})"/>
</linearGradient></defs>
<rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : size / 2}" fill="url(#g)"/>
<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="${size * 0.4}" font-weight="500" letter-spacing="${size * 0.01}" fill="#fff">${esc(text)}</text>
</svg>`;
}

let avatarPath = c.avatar || "assets/avatar.svg";
const avatarSrc = join(ROOT, avatarPath);
if (!existsSync(avatarSrc)) {
  mkdirSync(join(ROOT, dirname(avatarPath)), { recursive: true });
  writeFileSync(avatarSrc, monogramSvg(168, initials, accent, false));
  console.log(`·  generated a monogram avatar at ${avatarPath} — drop in a photo to replace it`);
}

/* ── copy assets/ ──────────────────────────────────────────────── */
function copyDir(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (entry.startsWith(".")) continue;
    const s = join(from, entry), d = join(to, entry);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d);
  }
}
copyDir(join(ROOT, "assets"), join(OUT, "assets"));

const avatarUrl = "/" + relative(ROOT, avatarSrc).split(/[\\/]/).join("/");

/* ── favicon ───────────────────────────────────────────────────── */
writeFileSync(join(OUT, "favicon.svg"), monogramSvg(64, initials[0], accent, true));

/* ── open graph image ──────────────────────────────────────────── */
function wrap(text, maxChars, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else { lines.push(line); line = w; if (lines.length === maxLines) break; }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[,.;:]?$/, "…");
  }
  return lines;
}

function ogSvg() {
  const [ar, ag, ab] = hexToRgb(accentDark);
  const name = String(c.name || "");
  const nameSize = name.length > 26 ? 62 : name.length > 18 ? 74 : 86;
  const headLines = wrap(c.headline, 52, 2);
  const host = baseUrl.replace(/^https?:\/\//, "") || "";

  let portrait = "";
  const ext = extname(avatarSrc).toLowerCase();
  const rasterType = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[ext];
  if (rasterType) {
    const b64 = readFileSync(avatarSrc).toString("base64");
    portrait = `<clipPath id="c"><circle cx="1024" cy="118" r="56"/></clipPath>
<image href="data:${rasterType};base64,${b64}" x="968" y="62" width="112" height="112" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>
<circle cx="1024" cy="118" r="56" fill="none" stroke="rgb(${ar},${ag},${ab})" stroke-opacity=".5" stroke-width="1.5"/>`;
  } else {
    portrait = `<circle cx="1024" cy="118" r="56" fill="rgb(${ar},${ag},${ab})" fill-opacity=".14" stroke="rgb(${ar},${ag},${ab})" stroke-opacity=".45" stroke-width="1.5"/>
<text x="1024" y="118" dy="0.34em" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="42" fill="rgb(${ar},${ag},${ab})">${esc(initials)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">
<defs>
<radialGradient id="glow" cx="14%" cy="-6%" r="72%">
<stop offset="0" stop-color="rgb(${ar},${ag},${ab})" stop-opacity=".26"/>
<stop offset="1" stop-color="rgb(${ar},${ag},${ab})" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="${OG_W}" height="${OG_H}" fill="#100f0d"/>
<rect width="${OG_W}" height="${OG_H}" fill="url(#glow)"/>
<rect x="48" y="48" width="${OG_W - 96}" height="${OG_H - 96}" fill="none" stroke="#ffffff" stroke-opacity=".08"/>
${portrait}
<text x="120" y="${headLines.length > 1 ? 300 : 316}" font-family="Georgia,'Times New Roman',serif" font-size="${nameSize}" font-weight="500" letter-spacing="-2" fill="#f3f0ea">${esc(name)}</text>
${headLines.map((l, i) =>
  `<text x="122" y="${(headLines.length > 1 ? 366 : 382) + i * 44}" font-family="Georgia,'Times New Roman',serif" font-style="italic" font-size="32" fill="#a8a294">${esc(l)}</text>`
).join("\n")}
<rect x="120" y="${OG_H - 118}" width="44" height="2" fill="rgb(${ar},${ag},${ab})"/>
<text x="120" y="${OG_H - 82}" font-family="Helvetica,Arial,sans-serif" font-size="19" letter-spacing="3.4" fill="#78736a">${esc(host.toUpperCase())}</text>
</svg>`;
}

function rasterise(svg, pngPath) {
  const svgPath = join(OUT, "og.svg");
  writeFileSync(svgPath, svg);

  const chromes = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "google-chrome", "chromium", "chromium-browser"
  ].filter(Boolean);

  const htmlPath = join(OUT, ".og.html");
  writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#100f0d}</style>${svg}`);

  // Chrome on macOS writes the screenshot and *then* exits non-zero over
  // unrelated display warnings, so trust the file on disk, not the exit code.
  const wrote = () => existsSync(pngPath) && statSync(pngPath).size > 1024;

  for (const bin of chromes) {
    try {
      execFileSync(bin, [
        "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
        "--force-device-scale-factor=1", "--force-color-profile=srgb",
        "--virtual-time-budget=1500",
        `--user-data-dir=${join(tmpdir(), "og-shot")}`,
        `--window-size=${OG_W},${OG_H}`,
        `--screenshot=${pngPath}`,
        "file://" + htmlPath
      ], { stdio: "ignore", timeout: 45000 });
    } catch { /* fall through to the file check */ }
    if (wrote()) { rmSync(htmlPath, { force: true }); return bin.split("/").pop(); }
  }
  rmSync(htmlPath, { force: true });

  const converters = [
    ["rsvg-convert", ["-w", String(OG_W), "-h", String(OG_H), "-o", pngPath, svgPath]],
    ["resvg", [svgPath, pngPath, "-w", String(OG_W)]],
    ["magick", [svgPath, "-resize", `${OG_W}x${OG_H}`, pngPath]],
    ["convert", [svgPath, "-resize", `${OG_W}x${OG_H}`, pngPath]]
  ];
  for (const [bin, a] of converters) {
    try {
      execFileSync(bin, a, { stdio: "ignore", timeout: 45000 });
    } catch { /* fall through to the file check */ }
    if (wrote()) return bin;
  }
  return null;
}

const svg = ogSvg();
const ogStamp = sha256(svg);
const pngPath = join(OUT, "og.png");
let ogImage = "og.png";

if (FAST && prevOg && prevOgStamp === ogStamp) {
  writeFileSync(pngPath, prevOg);
  writeFileSync(join(OUT, "og.svg"), svg);
} else {
  const via = rasterise(svg, pngPath);
  if (via) console.log(`·  open graph image rendered with ${via}`);
  else if (prevOg) {
    writeFileSync(pngPath, prevOg);
    console.warn("⚠  no rasteriser found — kept the previous dist/og.png");
  } else {
    ogImage = "og.svg";
    console.warn("⚠  no rasteriser found (Chrome, rsvg-convert or ImageMagick). " +
      "dist/og.svg was written; most social networks want a PNG. Set CHROME_PATH and rebuild.");
  }
}
writeFileSync(join(OUT, ".ogstamp"), ogStamp);

/* ── page fragments ────────────────────────────────────────────── */
const ARROW = `<svg class="project__arrow" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9 9 3M4.2 3H9v4.8"/></svg>`;

const socialHtml = (c.social || []).length
  ? `<ul class="social rise d4">${(c.social || []).map((s) => {
      const external = /^https?:/i.test(s.url || "");
      return `<li><a href="${esc(s.url)}"${external ? ' rel="me noopener"' : ""}>${esc(s.label)}</a></li>`;
    }).join("")}</ul>`
  : "";

const projects = (c.work && c.work.projects) || [];
const workHtml = projects.length ? `
    <section class="section wrap" aria-labelledby="work-label">
      <h2 class="section__label" id="work-label">${esc((c.work && c.work.label) || "Selected work")}</h2>
      <div>
        <ul class="projects">
${projects.map((p, i) => {
  const external = /^https?:/i.test(p.url || "");
  const tag = p.url ? "a" : "div";
  const attrs = p.url ? ` href="${esc(p.url)}"${external ? ' target="_blank" rel="noopener"' : ""}` : "";
  return `          <li>
            <${tag} class="project"${attrs}>
              <span class="project__num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
              <h3 class="project__title">${esc(p.title)}${p.url ? ARROW : ""}</h3>
              <p class="project__desc">${esc(p.description)}</p>
            </${tag}>
          </li>`;
}).join("\n")}
        </ul>
      </div>
    </section>` : "";

const ct = c.contact || {};
const contactHtml = `
    <section class="section wrap" aria-labelledby="contact-label">
      <h2 class="section__label" id="contact-label">${esc(ct.label || "Contact")}</h2>
      <div>
        <p class="contact__heading">${esc(ct.heading || "Say hello")}</p>
        ${ct.intro ? `<p class="contact__intro">${esc(ct.intro)}</p>` : ""}

        <form class="form" id="contact-form" method="post" action="/api/contact">
          <div class="form__row">
            <label class="field">
              <span>Name</span>
              <input class="input" type="text" name="name" autocomplete="name" maxlength="100" required>
            </label>
            <label class="field">
              <span>Email</span>
              <input class="input" type="email" name="email" autocomplete="email" maxlength="200" required>
            </label>
          </div>
          <label class="field">
            <span>Message</span>
            <textarea class="input" name="message" rows="5" maxlength="5000" required></textarea>
          </label>
          <div class="gotcha" aria-hidden="true">
            <label>Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label>
          </div>
          <div class="form__foot">
            <button class="btn" type="submit">${esc(ct.button || "Send message")}</button>
            <p class="form__note">${c.email ? `Or write to <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>.` : "No third parties involved."}</p>
            <p class="form__error" role="alert"></p>
          </div>
        </form>

        <div class="thanks" id="contact-thanks" tabindex="-1" role="status" hidden>
          <h3>${esc(ct.successTitle || "Message sent.")}</h3>
          <p>${esc(ct.successBody || "Thank you — I'll be in touch shortly.")}</p>
        </div>
      </div>
    </section>`;

/* ── head ──────────────────────────────────────────────────────── */
const title = site.title || `${c.name}${c.headline ? " — " + String(c.headline).replace(/\.$/, "") : ""}`;
const description = (site.description || c.about || c.headline || "")
  .replace(/\s+/g, " ").slice(0, 180).trim();

const css = readFileSync(join(ROOT, "src", "styles.css"), "utf8") +
`\n/* from content.json → theme */\n:root{--accent:${accent};--accent-contrast:${onAccent(accent)}}\n` +
`@media (prefers-color-scheme:dark){:root{--accent:${accentDark};--accent-contrast:${onAccent(accentDark)}}}\n`;

const js = readFileSync(join(ROOT, "src", "app.js"), "utf8");

const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Person",
  name: c.name,
  description: description,
  ...(baseUrl ? { url: baseUrl + "/" } : {}),
  image: abs(avatarUrl),
  ...(c.headline ? { jobTitle: String(c.headline).split(/[.,—]/)[0].trim() } : {}),
  sameAs: (c.social || []).map((s) => s.url).filter((u) => /^https?:/i.test(u))
});

/* The policy names hashes of exactly what we inlined, so it is rebuilt on
   every change. It ships twice: as a <meta> so it holds on any static host
   with no config, and as a real header (server.mjs, dist/_headers) where
   frame-ancestors — which <meta> cannot express — also applies. */
const cspDirectives = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  `style-src 'sha256-${sha256(css)}'`,
  `script-src 'sha256-${sha256(js)}' 'sha256-${sha256(jsonLd)}'`
];
const cspMeta = cspDirectives.join("; ");
const csp = ["frame-ancestors 'none'", ...cspDirectives].join("; ");


function head({ pageTitle, robots }) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(cspMeta)}">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="author" content="${esc(c.name)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#fbfaf8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#100f0d" media="(prefers-color-scheme: dark)">
${robots ? `<meta name="robots" content="${robots}">\n` : ""}${baseUrl ? `<link rel="canonical" href="${esc(baseUrl)}/">\n` : ""}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(c.name)}">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
${baseUrl ? `<meta property="og:url" content="${esc(baseUrl)}/">\n` : ""}<meta property="og:image" content="${esc(abs(ogImage))}">
<meta property="og:image:width" content="${OG_W}">
<meta property="og:image:height" content="${OG_H}">
<meta property="og:image:alt" content="${esc(c.name)}${c.headline ? " — " + esc(String(c.headline)) : ""}">
<meta name="twitter:card" content="summary_large_image">
${site.twitter ? `<meta name="twitter:creator" content="${esc(site.twitter)}">\n` : ""}<style>${css}</style>`;
}

/* ── index.html ────────────────────────────────────────────────── */
const body = `<a class="visually-hidden" href="#main">Skip to content</a>
<header class="masthead wrap">
  <div class="masthead__head">
    <div>
      ${c.status ? `<p class="eyebrow rise d1">${esc(c.status)}</p>` : ""}
      <h1 class="name rise">${esc(c.name)}</h1>
    </div>
    <img class="avatar rise d1" src="${esc(avatarUrl)}" width="84" height="84" alt="${esc(c.name)}" fetchpriority="high" decoding="async">
  </div>
  ${c.headline ? `<p class="headline rise d2">${esc(c.headline)}</p>` : ""}
  ${c.about ? `<p class="about rise d3">${esc(c.about)}</p>` : ""}
  ${socialHtml}
</header>

<main id="main">${workHtml}${contactHtml}
</main>

<footer class="footer wrap">
  <p>© ${new Date().getFullYear()} ${esc(c.name)}</p>
  ${c.footer ? `<p>${esc(c.footer)}</p>` : ""}
</footer>`;

const indexHtml = `<!doctype html>
<html lang="${esc(site.lang || "en")}">
<head>
${head({ pageTitle: title })}
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
${body}
<script>${js}</script>
</body>
</html>
`;
writeFileSync(join(OUT, "index.html"), indexHtml);

/* ── thanks.html (no-JS fallback target) ───────────────────────── */
const standalone = (heading, copy, extra = "") => `<!doctype html>
<html lang="${esc(site.lang || "en")}">
<head>
${head({ pageTitle: `${heading} — ${c.name}`, robots: "noindex" })}
</head>
<body>
<main class="standalone wrap">
  <div class="thanks">
    <h3>${esc(heading)}</h3>
    <p>${esc(copy)}</p>
  </div>
  ${extra}
  <p><a class="backlink" href="/"><span aria-hidden="true">←</span> Back to ${esc(c.name)}</a></p>
</main>
</body>
</html>
`;

writeFileSync(join(OUT, "thanks.html"),
  standalone(ct.successTitle || "Message sent.", ct.successBody || "Thank you — I'll be in touch shortly."));
writeFileSync(join(OUT, "404.html"),
  standalone("Not found.", "That page doesn't exist — which is easy here, because there is only one."));

/* ── headers for hosts that can set them ───────────────────────── */
const securityHeaders = {
  "Content-Security-Policy": csp,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin"
};

writeFileSync(join(OUT, "headers.json"), JSON.stringify(securityHeaders, null, 2));
writeFileSync(join(OUT, "_headers"),
  "/*\n" + Object.entries(securityHeaders).map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n");

/* ── robots + sitemap ──────────────────────────────────────────── */
writeFileSync(join(OUT, "robots.txt"),
  `User-agent: *\nAllow: /\n${baseUrl ? `\nSitemap: ${baseUrl}/sitemap.xml\n` : ""}`);

if (baseUrl) {
  writeFileSync(join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${esc(baseUrl)}/</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n  </url>\n</urlset>\n`);
}

const kb = (n) => (n / 1024).toFixed(1) + " kB";
console.log(`✓  dist/index.html  ${kb(Buffer.byteLength(indexHtml))} (CSS inlined, ${projects.length} project${projects.length === 1 ? "" : "s"})`);
if (!baseUrl) console.warn("⚠  site.url is empty — canonical, sitemap and absolute OG URLs are disabled. Set it in content.json.");
