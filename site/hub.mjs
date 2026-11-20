// site/hub.mjs — manifest loading plus the hub, 404 and project pages.
// Pure functions, Node stdlib only. Every render returns a complete HTML document string.
//
//   loadManifest(json)              -> manifest  json is the projects.json text or an object.
//                                      Validates and returns a normalised copy (screenshots
//                                      default to []). Throws an Error naming the bad slug.
//   renderHub(manifest)             -> string  /<base>/index.html. Links: ./<slug>/, ./favicon.svg
//   render404(manifest)             -> string  /<base>/404.html. Every internal link and the
//                                      favicon are absolute, built from basePath (KTD10).
//   renderProjectPage(manifest, slug) -> string  /<base>/<slug>/index.html for a server app
//                                      (an entry with `page`). Links: ../, ../<slug>/, ../favicon.svg.
//                                      Throws for unknown slugs and for demo entries.
//
// Each project has exactly one of: demo (built here, served at /<base>/<slug>/ with the nav
// strip), page (a server app; gets a project page), or external { url } (a live app hosted in
// its own repo; the hub card links straight to url, no page is built, and the nav strip
// leaves it out).
//
// Screenshot items: { src, alt, label? }, src relative to the project page (the build copies
// the files next to it). The screenshot column renders only when the list is non-empty.

import { esc, MONO, navStyle, renderNav, SANS } from "./nav.mjs";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const word = (n) => WORDS[n] ?? String(n);
const num = (i) => String(i + 1).padStart(2, "0");

/* ── manifest ─────────────────────────────────────────────────────────── */

const isStr = (v) => typeof v === "string" && v.trim() !== "";

export function loadManifest(json) {
  const raw = typeof json === "string" ? JSON.parse(json) : structuredClone(json);
  const fail = (msg) => {
    throw new Error(`projects.json: ${msg}`);
  };
  if (!raw || typeof raw !== "object") fail("must be an object");
  if (!isStr(raw.basePath) || !raw.basePath.startsWith("/") || !raw.basePath.endsWith("/")) {
    fail('basePath must start and end with "/" (e.g. "/vibe/")');
  }
  if (!isStr(raw.repo)) fail("repo is required");
  if (!Array.isArray(raw.projects) || raw.projects.length === 0) fail("projects must be a non-empty array");

  const seen = new Set();
  raw.projects.forEach((p, i) => {
    const at = `project "${p?.slug ?? `#${i + 1}`}"`;
    const bad = (msg) => fail(`${at}: ${msg}`);
    if (!p || typeof p !== "object") fail(`project #${i + 1} must be an object`);
    if (!isStr(p.slug) || !/^[a-z0-9][a-z0-9-]*$/.test(p.slug)) bad("slug must be lowercase letters, digits and dashes");
    if (seen.has(p.slug)) fail(`duplicate slug "${p.slug}"`);
    seen.add(p.slug);
    for (const k of ["name", "description", "stack"]) if (!isStr(p[k])) bad(`${k} is required`);
    if (p.inspiredBy !== undefined && !isStr(p.inspiredBy)) bad("inspiredBy must be a non-empty string when set");
    if (!isStr(p.color) || !/^#[0-9a-f]{6}$/i.test(p.color)) bad(`color must be a #rrggbb hex, got ${JSON.stringify(p.color)}`);
    const hasDemo = p.demo !== undefined;
    const hasPage = p.page !== undefined;
    const hasExt = p.external !== undefined;
    const kinds = hasDemo + hasPage + hasExt;
    if (kinds !== 1) bad(`needs exactly one of demo, page or external (has ${kinds ? "more than one" : "none"})`);
    if (hasExt && (!p.external || typeof p.external !== "object" || !isStr(p.external.url) || !/^https:\/\//.test(p.external.url)))
      bad("external.url must be an https:// URL");
    if (hasDemo) {
      if (!p.demo || typeof p.demo !== "object") bad("demo must be an object");
      if (!isStr(p.demo.out)) bad("demo.out is required when demo is set");
      if (!isStr(p.demo.build)) bad("demo.build is required when demo is set");
    }
    if (hasPage) {
      const pg = p.page;
      if (!pg || typeof pg !== "object") bad("page must be an object");
      if (!isStr(pg.pitch)) bad("page.pitch is required");
      if (!Array.isArray(pg.features) || pg.features.length === 0) bad("page.features must be a non-empty array");
      pg.features.forEach((f, j) => {
        if (!f || !isStr(f.title)) bad(`page.features[${j}].title is required`);
        if (f.detail !== undefined && typeof f.detail !== "string") bad(`page.features[${j}].detail must be a string`);
      });
      if (!pg.run || !Array.isArray(pg.run.commands) || pg.run.commands.length === 0) {
        bad("page.run.commands must be a non-empty array");
      }
      pg.run.commands.forEach((c, j) => {
        if (!c || !isStr(c.cmd)) bad(`page.run.commands[${j}].cmd is required`);
        if (c.comment !== undefined && typeof c.comment !== "string") bad(`page.run.commands[${j}].comment must be a string`);
      });
      if (pg.run.note !== undefined && typeof pg.run.note !== "string") bad("page.run.note must be a string");
      pg.screenshots ??= [];
      if (!Array.isArray(pg.screenshots)) bad("page.screenshots must be an array");
      pg.screenshots.forEach((s, j) => {
        if (!s || !isStr(s.src) || !isStr(s.alt)) bad(`page.screenshots[${j}] needs src and alt`);
      });
    }
  });
  return raw;
}

/* ── shared page chrome ───────────────────────────────────────────────── */

const colourClasses = (m) => m.projects.map((p) => `.c-${p.slug}{--c:${p.color}}`).join("\n");

const BASE_CSS = `
:root{--bg:#fff3d6;--surface:#ffffff;--ink:#121212;--ink-2:#4b4740;--bd:#121212;--sh:#121212;--dots:#f1dfb4;--y:#ffd23f;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#17151d;--surface:#24212c;--ink:#f6f0e2;--ink-2:#b9b2a3;--bd:#f6f0e2;--sh:#f6f0e2;--dots:#23202a;color-scheme:dark}}
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;background-color:var(--bg);background-image:radial-gradient(var(--dots) 1.6px,transparent 1.8px);background-size:20px 20px;color:var(--ink);font:500 16px/1.45 ${SANS};-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
[hidden]{display:none!important}
.vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
a:focus-visible,button:focus-visible{outline:3px dashed var(--ink);outline-offset:4px}
.wrap{max-width:1196px;margin:0 auto;padding:30px 48px 44px}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:0 0 34px}
.logo{font:900 22px/1 ${SANS};letter-spacing:-.03em}
.gh{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border:3px solid var(--bd);background:var(--surface);color:var(--ink);box-shadow:4px 4px 0 var(--sh);font:800 14px/1 ${SANS};white-space:nowrap;transition:transform .12s,box-shadow .12s}
.gh:hover{transform:translate(-1px,-1px);box-shadow:5px 5px 0 var(--sh)}
.gh:active{transform:translate(3px,3px);box-shadow:none}
.foot{border-top:3px solid var(--bd);padding-top:20px;display:flex;justify-content:space-between;align-items:center;gap:12px 20px;flex-wrap:wrap;font-weight:700}
.foot a{display:inline-flex;align-items:center;min-height:44px;text-decoration:underline;text-decoration-thickness:3px;text-underline-offset:5px}
.num{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:3px solid #121212;background:#fff;color:#121212;font:900 15px/1 ${SANS};margin:0 0 14px}
.tag{font:700 12px/1.2 ${MONO};background:#fff;color:#121212;border:2px solid #121212;padding:5px 8px}
.tag.own{border-style:dashed}
.badge{font:800 13px/1 ${SANS};border:2px solid #121212;border-radius:999px;padding:7px 11px;white-space:nowrap}
.badge.live{background:#121212;color:var(--c)}
.badge.srv{background:#fff;color:#121212;border-style:dashed}
.insp{position:absolute;top:-14px;right:18px;background:#fff;color:#121212;border:2px solid #121212;font:800 12px/1 ${SANS};padding:7px 10px;transform:rotate(-3deg);box-shadow:3px 3px 0 #121212}
.insp.r{transform:rotate(4deg)}
@media (max-width:599.98px){
  .wrap{padding:18px 16px 30px}
  .top{margin-bottom:22px}
  .gh{padding:0 12px;font-size:13px}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition-property:box-shadow!important}.gh:hover,.gh:active{transform:none}}
`;

const HUB_CSS = `
.hero{display:flex;align-items:flex-end;gap:34px;margin:0 0 50px}
.big{flex:none;font:900 168px/.8 ${SANS};letter-spacing:-.07em;margin:0;padding:18px 26px 26px;background:var(--y);color:#121212;border:4px solid var(--bd);box-shadow:10px 10px 0 var(--sh);transform:rotate(-3deg)}
.pill-ai{display:inline-block;margin:0 0 14px;font:800 12px/1 ${MONO};border:2px solid var(--bd);padding:6px 10px;border-radius:999px;background:var(--surface);transform:rotate(2deg)}
.lede{font:900 42px/1 ${SANS};letter-spacing:-.03em;margin:0 0 12px;max-width:22ch}
.lede .dash{color:var(--ink-2)}
.blurb{margin:0;max-width:48ch;color:var(--ink-2);font-size:17px}
.filter{display:flex;flex-wrap:wrap;align-items:center;gap:14px 12px;margin:0 0 44px}
.srch{position:relative;display:flex;align-items:center;flex:1 1 320px;max-width:460px;min-height:56px;background:var(--surface);border:3px solid var(--bd);box-shadow:5px 5px 0 var(--sh)}
.srch:focus-within{outline:3px dashed var(--ink);outline-offset:4px}
.srch svg{flex:none;margin:0 4px 0 16px}
.srch input{flex:1;min-width:0;height:50px;padding:0 10px;border:0;background:none;color:var(--ink);font:700 17px/1 ${SANS};outline:none;-webkit-appearance:none;appearance:none}
.srch input::placeholder{color:var(--ink-2);font:500 15px/1 ${MONO}}
.srch input::-webkit-search-cancel-button{-webkit-appearance:none}
.srch kbd{flex:none;margin-right:12px;padding:4px 8px;border:2px solid var(--bd);font:800 12px/1 ${MONO};color:var(--ink)}
.chips{display:flex;flex-wrap:wrap;gap:10px}
.chip{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border:2px solid var(--bd);border-radius:999px;background:var(--surface);color:var(--ink);box-shadow:3px 3px 0 var(--sh);font:800 14px/1 ${SANS};cursor:pointer;transition:transform .12s,box-shadow .12s}
.chip:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--sh)}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--bg);transform:translate(3px,3px);box-shadow:none}
.chip .n{font:800 12px/1 ${MONO};opacity:.75}
.fcount{flex-basis:100%;margin:2px 0 0;font:700 13px/1 ${MONO};color:var(--ink-2)}
.empty{display:flex;flex-direction:column;align-items:flex-start;gap:22px;margin:0 0 56px}
.empty p{margin:0;font:900 34px/1.05 ${SANS};letter-spacing:-.03em;max-width:24ch;background:var(--y);color:#121212;border:3px solid var(--bd);box-shadow:8px 8px 0 var(--sh);padding:14px 20px 16px;transform:rotate(-1.5deg)}
.empty button{min-height:48px;padding:0 20px;border:3px solid var(--bd);background:var(--surface);color:var(--ink);box-shadow:5px 5px 0 var(--sh);font:900 16px/1 ${SANS};cursor:pointer}
.empty button:active{transform:translate(4px,4px);box-shadow:none}
.sec{display:flex;align-items:center;gap:12px;margin:0 0 20px}
.sec h2{font:900 26px/1 ${SANS};letter-spacing:-.02em;margin:0}
.ct{display:inline-flex;align-items:center;justify-content:center;flex:none;width:34px;height:34px;border-radius:50%;border:3px solid var(--bd);background:var(--surface);font:900 15px/1 ${SANS}}
.sec p{margin:0 0 0 6px;color:var(--ink-2)}
.grid{display:grid;gap:26px;margin:0 0 46px;padding:0;list-style:none}
.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.grid > li{display:flex}
.hub-card{position:relative;display:flex;flex-direction:column;width:100%;background:var(--c);color:#121212;border:3px solid var(--bd);box-shadow:6px 6px 0 var(--sh);padding:18px 20px;min-height:226px;transition:transform .12s,box-shadow .12s}
.two .hub-card{min-height:250px}
.hub-card:hover{transform:translate(-3px,-3px);box-shadow:9px 9px 0 var(--sh)}
.hub-card:active{transform:translate(4px,4px);box-shadow:2px 2px 0 var(--sh)}
.hub-card:focus-visible{outline:3px dashed var(--ink);outline-offset:5px}
.hub-card h3{font:900 32px/1 ${SANS};letter-spacing:-.03em;margin:0 0 8px;overflow-wrap:anywhere}
.two .hub-card h3{font-size:42px}
.hub-card .d{margin:0 0 18px;font-size:16px;max-width:36ch}
.hub-card .ft{margin-top:auto;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-right:26px}
.arrow{position:absolute;right:16px;bottom:14px;font:900 24px/1 ${SANS}}
@media (prefers-reduced-motion:reduce){.hub-card:hover,.hub-card:active,.chip:hover,.chip[aria-pressed="true"],.empty button:active{transform:none}}
@media (max-width:899.98px){
  .grid.three{grid-template-columns:repeat(2,minmax(0,1fr))}
  .big{font-size:132px}
  .lede{font-size:34px}
}
@media (max-width:599.98px){
  .hero{flex-direction:column;align-items:flex-start;gap:26px;margin-bottom:36px}
  .big{font-size:104px;padding:12px 18px 18px;margin-left:6px;box-shadow:7px 7px 0 var(--sh)}
  .lede{font-size:30px}
  .blurb{font-size:16px}
  .grid.two,.grid.three{grid-template-columns:1fr;gap:24px}
  .hub-card,.two .hub-card{min-height:0;padding:16px}
  .hub-card h3,.two .hub-card h3{font-size:28px}
  .hub-card .ft{padding-right:0}
  .hub-card .num{width:34px;height:34px;font-size:13px;margin-bottom:10px}
  .sec h2{font-size:22px}
  .sec p{display:none}
  .arrow{display:none}
  .filter{margin-bottom:34px}
  .srch{flex-basis:100%;max-width:none}
  .srch kbd{display:none}
  .chips{gap:8px}
  .chip{padding:0 11px;gap:6px;font-size:13px}
  .empty p{font-size:26px}
}
.nf{display:flex;flex-direction:column;align-items:center;padding:56px 0 84px}
.nf-sticker{margin:0;text-align:center;background:var(--y);color:#121212;border:4px solid var(--bd);box-shadow:10px 10px 0 var(--sh);transform:rotate(-4deg);padding:26px 44px 32px}
.nf-sticker b{display:block;font:900 168px/.8 ${SANS};letter-spacing:-.07em}
.nf-sticker span{display:block;font:900 42px/1 ${SANS};letter-spacing:-.03em;margin-top:16px}
.btn-back{display:inline-flex;align-items:center;gap:10px;margin-top:64px;min-height:56px;padding:0 26px;border:3px solid var(--bd);background:var(--surface);color:var(--ink);box-shadow:6px 6px 0 var(--sh);font:900 18px/1 ${SANS};transition:transform .12s,box-shadow .12s}
.btn-back:hover{transform:translate(-2px,-2px);box-shadow:8px 8px 0 var(--sh)}
.btn-back:active{transform:translate(4px,4px);box-shadow:2px 2px 0 var(--sh)}
@media (max-width:599.98px){.nf{padding:40px 0 60px}.nf-sticker{padding:18px 24px 22px}.nf-sticker b{font-size:104px}.nf-sticker span{font-size:28px}.btn-back{margin-top:48px}}
`;

const PAGE_CSS = `
main:focus{outline:none}
.pband{background:var(--c);color:#121212;border-bottom:4px solid var(--bd);padding:40px 48px 44px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:30px;align-items:end}
.pband .num{width:52px;height:52px;font-size:18px;margin:0 0 12px}
.pname{font:900 168px/.8 ${SANS};letter-spacing:-.07em;margin:0 0 .24em;overflow-wrap:anywhere}
.pitch{font:700 22px/1.25 ${SANS};margin:0;max-width:32ch}
.side{display:flex;flex-direction:column;align-items:flex-end;gap:12px}
.side .insp{position:static;transform:rotate(-4deg);font-size:14px}
.pbody{max-width:1296px;margin:0 auto;padding:46px 48px 60px;display:grid;gap:40px 46px;align-items:start;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-areas:"feat run"}
.pbody.has-shots{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);grid-template-areas:"shots feat" "shots run"}
.shots{grid-area:shots}
.feat-sec{grid-area:feat}
.run-sec{grid-area:run}
.h2{font:900 26px/1 ${SANS};letter-spacing:-.02em;margin:0 0 16px}
.shotf{position:relative;margin:0;background:var(--surface);border:3px solid var(--bd);box-shadow:8px 8px 0 var(--sh)}
.shotf a{display:block;margin:12px}
.shotf a:focus-visible{outline-offset:2px}
.shotf img{display:block;width:100%;height:auto;border:2px solid var(--bd)}
.lab{position:absolute;left:-12px;top:-16px;z-index:1;background:var(--c);color:#121212;border:2px solid #121212;font:800 13px/1 ${MONO};padding:8px 10px;transform:rotate(-3deg);box-shadow:3px 3px 0 #121212}
.mini{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:30px}
.mini .lab{background:#fff;font-size:12px}
.mini .shotf:nth-child(2) .lab{transform:rotate(2deg)}
.feats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0;padding:0;list-style:none;counter-reset:f}
.feats li{counter-increment:f;border:3px solid var(--bd);background:var(--surface);padding:12px 14px;font-weight:700;line-height:1.3;box-shadow:4px 4px 0 var(--sh)}
.feats li::before{content:counter(f);display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--c);border:2px solid #121212;color:#121212;font:900 13px/1 ${SANS};margin:0 0 8px}
.feats small{display:block;font-weight:500;color:var(--ink-2);margin-top:3px;font-size:14px}
.termbox{background:#121212;color:#f6f0e2;border:3px solid var(--bd);box-shadow:8px 8px 0 var(--c)}
.termbox .th{display:flex;justify-content:space-between;align-items:center;min-height:62px;border-bottom:2px solid #3a3a3a;padding:8px 8px 8px 14px;font:700 12px/1 ${MONO};color:#b9b2a3}
.copy{font:900 14px/1 ${SANS};background:#ffd23f;color:#121212;border:2px solid #f6f0e2;min-height:44px;min-width:92px;padding:0 14px;box-shadow:3px 3px 0 #f6f0e2;cursor:pointer;transition:transform .12s,box-shadow .12s}
.copy[hidden]{display:none}
.copy:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 #f6f0e2}
.copy:active,.copy.is-done{transform:translate(3px,3px);box-shadow:none}
.copy:focus-visible{outline:3px dashed #ffd23f;outline-offset:4px}
.termbox pre{margin:0;padding:14px 16px 16px;font:15px/1.75 ${MONO};overflow-x:auto;white-space:pre}
.termbox .p{color:var(--c);user-select:none;-webkit-user-select:none}
.termbox .c{color:#8d877b}
.why{margin:24px 0 28px;color:var(--ink-2)}
.why code{font:13px ${MONO};color:var(--ink);background:var(--surface);border:2px solid var(--bd);padding:1px 5px}
.srcbtn{display:flex;align-items:center;justify-content:space-between;min-height:56px;padding:0 20px;border:3px solid var(--bd);background:var(--surface);color:var(--ink);box-shadow:6px 6px 0 var(--sh);font:900 18px/1 ${SANS};transition:transform .12s,box-shadow .12s}
.srcbtn:hover{transform:translate(-2px,-2px);box-shadow:8px 8px 0 var(--sh)}
.srcbtn:active{transform:translate(4px,4px);box-shadow:2px 2px 0 var(--sh)}
@media (prefers-reduced-motion:reduce){.copy:hover,.copy:active,.copy.is-done,.srcbtn:hover,.srcbtn:active{transform:none}}
@media (max-width:899.98px){
  .pband{padding:32px 32px 36px}
  .pname{font-size:128px}
  .pbody,.pbody.has-shots{grid-template-columns:minmax(0,1fr);grid-template-areas:"shots" "feat" "run";padding:40px 32px 52px}
}
@media (max-width:599.98px){
  .pband{grid-template-columns:minmax(0,1fr);padding:22px 16px 26px;gap:20px}
  .pband .num{width:40px;height:40px;font-size:15px}
  .pname{font-size:104px}
  .pname.long{font-size:64px}
  .pitch{font-size:18px}
  .side{flex-direction:row;flex-wrap:wrap;align-items:center}
  .pbody,.pbody.has-shots{padding:30px 16px 40px;gap:40px}
  .mini{grid-template-columns:1fr;gap:30px}
  .h2{font-size:22px}
  .feats{grid-template-columns:1fr}
  .feats li{padding:10px 12px;font-size:15px}
  .termbox pre{font-size:14px;padding:12px 14px 14px}
}
`;

const COPY_JS = `(()=>{const b=document.querySelector(".copy");if(!b||!navigator.clipboard)return;const t=[...document.querySelectorAll(".cmd")].map(e=>e.textContent).join("\\n");let h;b.hidden=false;b.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(t)}catch{return}b.textContent="copied ✓";b.classList.add("is-done");clearTimeout(h);h=setTimeout(()=>{b.textContent="copy";b.classList.remove("is-done")},2000)})})();`;

function doc({ title, description, icon, css, extraHead = "", body, bodyClass = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">\n` : ""}<link rel="icon" href="${esc(icon)}" type="image/svg+xml">
<style>${css}</style>${extraHead}
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ""}>
${body}
</body>
</html>
`;
}

const topBar = (repo, ghLabel = "source on github ↗") =>
  `<header class="top"><span class="logo">ali's vibe log</span><a class="gh" href="${esc(repo)}">${ghLabel}</a></header>`;

const footer = (repo) =>
  `<footer class="foot"><span>made by alifa20, mostly by describing things to an AI and then arguing with it.</span><a href="${esc(repo)}">source on github ↗</a></footer>`;

/* ── hub ──────────────────────────────────────────────────────────────── */

const isLive = (p) => Boolean(p.demo || p.external);
const status = (p) => (isLive(p) ? "live demo" : "needs a server");

// Search + status chips. Rendered hidden; FILTER_JS reveals it, so without JS the hub is
// the plain grouped list. State mirrors to ?q=&show= so a filtered view can be shared.
const filterBar = (nLive, nSrv, total) =>
  `<form class="filter" role="search" aria-label="filter projects" hidden>` +
  `<label class="srch"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M15 15l6 6" stroke="currentColor" stroke-width="3.5" stroke-linecap="square"/></svg>` +
  `<span class="vh">search projects</span><input type="search" name="q" placeholder="try sqlite, qr, workers…" autocomplete="off" spellcheck="false"><kbd aria-hidden="true">/</kbd></label>` +
  `<div class="chips" role="group" aria-label="show">` +
  `<button type="button" class="chip" data-kind="all" aria-pressed="true">all <span class="n">${total}</span></button>` +
  `<button type="button" class="chip" data-kind="live" aria-pressed="false"><span aria-hidden="true">▶</span> live demos <span class="n">${nLive}</span></button>` +
  `<button type="button" class="chip" data-kind="srv" aria-pressed="false">needs a server <span class="n">${nSrv}</span></button></div>` +
  `<p class="fcount" aria-live="polite"></p></form>`;

const FILTER_JS = `(()=>{const f=document.querySelector(".filter");if(!f)return;const q=f.querySelector("input"),chips=[...f.querySelectorAll(".chip")],items=[...document.querySelectorAll(".grid>li")],secs=[...document.querySelectorAll("section[data-sec]")],out=f.querySelector(".fcount"),empty=document.querySelector(".empty"),total=items.length;let kind="all";const p=new URLSearchParams(location.search);q.value=p.get("q")||"";if(["live","srv"].includes(p.get("show")))kind=p.get("show");f.hidden=false;function apply(){const raw=q.value.trim(),terms=raw.toLowerCase().split(/\\s+/).filter(Boolean);let n=0;for(const li of items){const ok=(kind==="all"||li.dataset.kind===kind)&&terms.every(t=>li.dataset.q.includes(t));li.hidden=!ok;if(ok)n++}for(const s of secs){const v=s.querySelectorAll(".grid>li:not([hidden])").length;s.hidden=!v;s.querySelector(".ct").textContent=v}for(const c of chips)c.setAttribute("aria-pressed",String(c.dataset.kind===kind));out.textContent=n===total?"all "+total+" projects":"showing "+n+" of "+total;empty.hidden=n>0;empty.querySelector(".eq").textContent=raw?"\u201c"+raw+"\u201d":"that";const u=new URL(location.href);raw?u.searchParams.set("q",raw):u.searchParams.delete("q");kind!=="all"?u.searchParams.set("show",kind):u.searchParams.delete("show");history.replaceState(null,"",u)}q.addEventListener("input",apply);for(const c of chips)c.addEventListener("click",()=>{kind=c.dataset.kind;apply()});f.addEventListener("submit",e=>e.preventDefault());empty.querySelector("button").addEventListener("click",()=>{q.value="";kind="all";apply();q.focus()});document.addEventListener("keydown",e=>{const a=document.activeElement,typing=a&&(/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)||a.isContentEditable);if(e.key==="/"&&!typing&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();q.focus();q.select()}else if(e.key==="Escape"&&a===q&&q.value){q.value="";apply()}});apply()})();`;

function card(p, i) {
  const badge = isLive(p)
    ? `<span class="badge live"><span aria-hidden="true">▶ </span>live demo</span>`
    : `<span class="badge srv">needs a server</span>`;
  const insp = p.inspiredBy
    ? `<span class="insp${i % 2 ? " r" : ""}" aria-hidden="true">inspired by ${esc(p.inspiredBy)}</span>`
    : "";
  const ext = p.external ? "own repo" : "";
  const haystack = [p.name, p.slug, p.description, p.stack, p.inspiredBy ?? "", status(p), ext].join(" ").toLowerCase();
  const href = p.external ? p.external.url : `./${p.slug}/`;
  return (
    `<li data-kind="${isLive(p) ? "live" : "srv"}" data-q="${esc(haystack)}"><a class="hub-card c-${esc(p.slug)}" href="${esc(href)}" aria-label="${esc(`${p.name}, ${status(p)}${ext ? ", in its own repo" : ""}, ${p.description}`)}">` +
    insp +
    `<span class="num" aria-hidden="true">${num(i)}</span>` +
    `<h3>${esc(p.name)}</h3>` +
    `<p class="d">${esc(p.description)}</p>` +
    `<span class="ft">${badge}<span class="tag">${esc(p.stack)}</span>${ext ? `<span class="tag own">own repo ↗</span>` : ""}</span>` +
    `<span class="arrow" aria-hidden="true">${ext ? "↗" : "→"}</span></a></li>`
  );
}

export function renderHub(manifest) {
  const m = manifest;
  const indexed = m.projects.map((p, i) => [p, i]);
  const live = indexed.filter(([p]) => isLive(p));
  const srv = indexed.filter(([p]) => !isLive(p));
  const total = m.projects.length;
  const section = (id, title, explain, list, cols) =>
    list.length
      ? `<section aria-labelledby="h-${id}" data-sec="${id}"><div class="sec"><span class="ct" aria-hidden="true">${list.length}</span><h2 id="h-${id}">${title}</h2><p>${explain}</p></div>` +
        `<ul class="grid ${cols}">${list.map(([p, i]) => card(p, i)).join("")}</ul></section>`
      : "";
  const blurb =
    `mostly here so I can jump between my own experiments. ` +
    `${word(live.length)} run right in your browser; ${word(srv.length)} need a server, ` +
    `and their page shows what they do and how to run them.`;
  const body =
    `<div class="wrap">${topBar(m.repo)}` +
    `<div class="hero"><h1 class="big">vibe</h1><div class="hero-t">` +
    `<span class="pill-ai">✦ made with ai, by ali</span>` +
    `<p class="lede"><span class="dash">—</span> ${word(total)} things I built with AI.</p>` +
    `<p class="blurb">${blurb}</p></div></div>` +
    filterBar(live.length, srv.length, total) +
    `<main>` +
    section("live", "live demos", "click and it runs. nothing to install.", live, "two") +
    section("srv", "run it yourself", "each one needs a server. what it does and the commands are inside.", srv, "three") +
    `<div class="empty" hidden><p>nothing matches <span class="eq"></span>.</p><button type="button">clear the filter</button></div>` +
    `</main>${footer(m.repo)}</div>`;
  return doc({
    title: `vibe — ${word(total)} things I built with AI`,
    description: `ali's vibe log: ${word(total)} small apps built with AI. ${live.length} live demos, ${srv.length} you can run yourself.`,
    icon: "./favicon.svg",
    css: BASE_CSS + HUB_CSS + colourClasses(m),
    body: body + `<script>${FILTER_JS}</script>`,
  });
}

/* ── 404 ──────────────────────────────────────────────────────────────── */

export function render404(manifest) {
  const base = manifest.basePath;
  const body =
    `<div class="wrap">${topBar(manifest.repo)}` +
    `<main class="nf"><h1 class="nf-sticker"><b>404</b><span>— nothing here</span></h1>` +
    `<a class="btn-back" href="${esc(base)}">← back to vibe</a></main>` +
    `${footer(manifest.repo)}</div>`;
  return doc({
    title: "404 — nothing here · vibe",
    icon: `${base}favicon.svg`,
    css: BASE_CSS + HUB_CSS,
    body,
  });
}

/* ── project page ─────────────────────────────────────────────────────── */

const noteHtml = (note) => esc(note).replace(/`([^`]+)`/g, "<code>$1</code>");

function shotFigure(s) {
  const lab = s.label ? `<figcaption class="lab">screenshot: ${esc(s.label)}</figcaption>` : "";
  return `<figure class="shotf">${lab}<a href="${esc(s.src)}"><img src="${esc(s.src)}" alt="${esc(s.alt)}" loading="lazy" decoding="async"></a></figure>`;
}

export function renderProjectPage(manifest, slug) {
  const m = manifest;
  const i = m.projects.findIndex((p) => p.slug === slug);
  if (i < 0) throw new Error(`renderProjectPage: unknown project slug "${slug}"`);
  const p = m.projects[i];
  if (!p.page) throw new Error(`renderProjectPage: project "${slug}" is a live demo and has no project page`);
  const pg = p.page;
  const repo = String(m.repo).replace(/\/+$/, "");
  const shots = pg.screenshots;

  const band =
    `<header class="pband"><div>` +
    `<span class="num" aria-hidden="true">${num(i)}</span>` +
    `<h1 class="pname${p.name.length > 6 ? " long" : ""}">${esc(p.name)}</h1>` +
    `<p class="pitch">${esc(pg.pitch)}</p></div>` +
    `<div class="side">` +
    (p.inspiredBy ? `<span class="insp">inspired by ${esc(p.inspiredBy)}</span>` : "") +
    `<span class="badge srv">needs a server</span><span class="tag">${esc(p.stack)}</span>` +
    `</div></header>`;

  const shotsHtml = shots.length
    ? `<section class="shots" aria-label="screenshots">${shotFigure(shots[0])}` +
      (shots.length > 1 ? `<div class="mini">${shots.slice(1, 3).map(shotFigure).join("")}</div>` : "") +
      `</section>`
    : "";

  const feats =
    `<section class="feat-sec" aria-labelledby="h-feat"><h2 class="h2" id="h-feat">what it does</h2><ul class="feats">` +
    pg.features.map((f) => `<li><span>${esc(f.title)}</span>${f.detail ? `<small>${esc(f.detail)}</small>` : ""}</li>`).join("") +
    `</ul></section>`;

  const lines = pg.run.commands.flatMap((c) => [
    ...(c.comment ? [`<span class="c"># ${esc(c.comment)}</span>`] : []),
    `<span class="ln"><span class="p" aria-hidden="true">$ </span><span class="cmd">${esc(c.cmd)}</span></span>`,
  ]);
  const run =
    `<section class="run-sec" aria-labelledby="h-run"><h2 class="h2" id="h-run">run it locally</h2>` +
    `<div class="termbox"><div class="th"><span>zsh · ~/vibe</span><button class="copy" type="button" aria-live="polite" hidden>copy</button></div>` +
    `<pre>${lines.join("\n")}</pre></div>` +
    (pg.run.note ? `<p class="why">${noteHtml(pg.run.note)}</p>` : "") +
    `<a class="srcbtn" href="${esc(repo)}/tree/main/${esc(p.slug)}"><span>source on github</span><span aria-hidden="true">↗</span></a>` +
    `</section>`;

  const body =
    renderNav(m, slug, { skipTarget: "main" }) +
    `\n<main id="main" tabindex="-1">${band}` +
    `<div class="pbody${shots.length ? " has-shots" : ""}">${shotsHtml}${feats}${run}</div></main>\n` +
    `<script>${COPY_JS}</script>`;

  return doc({
    title: `${p.name} — vibe`,
    description: `${p.name}: ${p.description}`,
    icon: "../favicon.svg",
    css: BASE_CSS + PAGE_CSS + colourClasses(m),
    extraHead: `\n<style>${navStyle(m)}</style>`,
    body,
    bodyClass: `pp c-${p.slug}`,
  });
}
