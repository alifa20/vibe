#!/usr/bin/env node
import http from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

import { ROOT, fromRoot, loadEnv, loadSite, visitorSalt } from './src/config.mjs';
import { renderPage, TOKENS, esc } from './src/render.mjs';
import { classifyUA, logLine, readClicks, renderStats, visitorKey } from './src/stats.mjs';

loadEnv();

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const LINKS_FILE = join(ROOT, 'links.json');
const PUBLIC_DIR = join(ROOT, 'public');
const LOG_PATH = fromRoot(process.env.CLICKS_LOG || 'data/clicks.log');
const { salt: SALT, ephemeral: SALT_EPHEMERAL } = visitorSalt();

/* ------------------------------------------------------------------ *
 * links.json is the CMS: re-read whenever the file changes on disk.
 * ------------------------------------------------------------------ */
let cache = { mtime: 0, site: null, page: null };

function site() {
  const mtime = statSync(LINKS_FILE).mtimeMs;
  if (cache.mtime !== mtime || !cache.site) {
    try {
      const s = loadSite(LINKS_FILE);
      cache = { mtime, site: s, page: renderPage(s) };
      for (const w of s.warnings) console.warn(`links.json  ${w}`);
    } catch (err) {
      if (!cache.site) throw err;
      console.error(`links.json is invalid, still serving the last good version: ${err.message}`);
      cache.mtime = mtime;
    }
  }
  return cache;
}

/* ------------------------------------------------------------------ *
 * Click log
 * ------------------------------------------------------------------ */
mkdirSync(dirname(LOG_PATH), { recursive: true });
let log = createWriteStream(LOG_PATH, { flags: 'a' });
log.on('error', (e) => console.error(`click log write failed: ${e.message}`));

const clientIp = (req) => {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
  }
  return req.socket.remoteAddress || '';
};

function referrerLabel(req, url) {
  const tag = url.searchParams.get('ref');
  if (tag) return 'tag:' + tag.replace(/[^\w.-]/g, '').slice(0, 40);
  const r = req.headers.referer;
  if (!r) return '-';
  try {
    const h = new URL(r);
    return h.host === url.host ? 'self' : h.host.replace(/^www\./, '');
  } catch {
    return '-';
  }
}

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function send(req, res, status, headers, body) {
  const buf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
  const h = { ...BASE_HEADERS, ...headers };
  if (buf) h['Content-Length'] = buf.length;
  res.writeHead(status, h);
  if (req.method === 'HEAD' || !buf) return res.end();
  res.end(buf);
}

const cspFor = (styleHash) =>
  `default-src 'none'; img-src 'self' data: https:; style-src '${styleHash}'; ` +
  `base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

function errorPage(status, title, detail) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${status} — ${esc(title)}</title>
<style>${TOKENS}
body{align-items:center;min-height:100vh;text-align:left}
.b{max-width:26rem}
.c{font-family:var(--mono);font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--soft);margin:0 0 .5rem}
h1{font-family:var(--serif);font-weight:500;font-size:2rem;letter-spacing:-.02em;margin:0 0 .6rem}
p{color:var(--soft);margin:0 0 1.5rem}
a{font-family:var(--mono);font-size:.75rem;color:var(--accent);text-decoration:none;border-bottom:1px solid currentColor}
</style></head><body><div class="b"><p class="c">Error ${status}</p><h1>${esc(title)}</h1>
<p>${esc(detail)}</p><a href="/">Back to the index</a></div></body></html>`;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = resolve(PUBLIC_DIR, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  if (!file.startsWith(PUBLIC_DIR + '/') || !existsSync(file)) return false;
  let st;
  try {
    st = statSync(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;

  const etag = `"${st.mtimeMs.toString(36)}-${st.size.toString(36)}"`;
  const headers = {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    send(req, res, 304, headers);
    return true;
  }
  headers['Content-Length'] = st.size;
  res.writeHead(200, { ...BASE_HEADERS, ...headers });
  if (req.method === 'HEAD') return res.end(), true;
  createReadStream(file).pipe(res);
  return true;
}

/* ------------------------------------------------------------------ *
 * /stats auth
 * ------------------------------------------------------------------ */
const attempts = new Map();
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
}, 60_000).unref();

function equals(a, b) {
  const A = Buffer.from(String(a ?? ''));
  const B = Buffer.from(String(b ?? ''));
  if (A.length !== B.length || A.length === 0) return false;
  return timingSafeEqual(A, B);
}

function authorised(req) {
  const h = req.headers.authorization || '';
  if (!h.toLowerCase().startsWith('basic ')) return false;
  const raw = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8');
  const i = raw.indexOf(':');
  if (i < 0) return false;
  return equals(raw.slice(0, i), process.env.STATS_USER) && equals(raw.slice(i + 1), process.env.STATS_PASS);
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */
async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(req, res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method not allowed\n');
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/healthz') {
    return send(req, res, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, 'ok\n');
  }

  /* --- index --- */
  if (path === '/') {
    const { page } = site();
    const etag = `"${page.version}"`;
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': cspFor(page.styleHash),
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) return send(req, res, 304, headers);
    return send(req, res, 200, headers, page.html);
  }

  /* --- tracked redirect --- */
  if (path.startsWith('/go/')) {
    const slug = decodeURIComponent(path.slice(4));
    const link = site().site.links.find((l) => l.slug === slug);
    if (!link) {
      return send(req, res, 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        errorPage(404, 'No such link', `Nothing in the index is filed under "${slug}".`));
    }
    const ua = String(req.headers['user-agent'] || '');
    log.write(
      logLine({
        ts: new Date().toISOString(),
        slug,
        // A HEAD request is a preview fetch, never a person tapping a link.
        kind: req.method === 'HEAD' ? 'bot' : classifyUA(ua),
        ref: referrerLabel(req, url),
        visitor: visitorKey(clientIp(req), SALT),
        ua,
      })
    );
    return send(req, res, 302, {
      Location: link.url,
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'text/html; charset=utf-8',
    }, `<!doctype html><meta charset="utf-8"><title>Redirecting</title><a href="${esc(link.url)}">${esc(link.url)}</a>`);
  }

  /* --- stats --- */
  if (path === '/stats') {
    if (!process.env.STATS_USER || !process.env.STATS_PASS) {
      return send(req, res, 503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        errorPage(503, 'Stats are locked', 'Set STATS_USER and STATS_PASS in .env, then restart the server.'));
    }
    const ip = clientIp(req);
    const rec = attempts.get(ip);
    if (rec && rec.n >= MAX_FAILS && rec.until > Date.now()) {
      return send(req, res, 429, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Retry-After': String(Math.ceil((rec.until - Date.now()) / 1000)),
        'Cache-Control': 'no-store',
      }, 'Too many failed sign-ins. Try again later.\n');
    }
    if (!authorised(req)) {
      const next = rec && rec.until > Date.now() ? rec : { n: 0, until: 0 };
      attempts.set(ip, { n: next.n + 1, until: Date.now() + LOCK_MS });
      return send(req, res, 401, {
        'WWW-Authenticate': 'Basic realm="Click stats", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      }, 'Authentication required.\n');
    }
    attempts.delete(ip);

    const days = Math.max(0, Math.min(3650, Number(url.searchParams.get('days') ?? 30) || 0));
    const includeBots = url.searchParams.get('bots') === '1';
    const since = days ? Date.now() - days * 86_400_000 : 0;
    const clicks = await readClicks(LOG_PATH, { since });
    const html = renderStats({ site: site().site, clicks, days, includeBots, logPath: process.env.CLICKS_LOG || 'data/clicks.log' });
    return send(req, res, 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    }, html);
  }

  /* --- static, then 404 --- */
  if (serveStatic(req, res, url.pathname)) return;
  return send(req, res, 404, { 'Content-Type': 'text/html; charset=utf-8' },
    errorPage(404, 'Page not found', 'That address is not part of this site.'));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      send(req, res, 500, { 'Content-Type': 'text/html; charset=utf-8' },
        errorPage(500, 'Something broke', 'The server hit an unexpected error. Check the logs.'));
    } else {
      res.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  const s = site().site;
  console.log(`\n  ${s.name} — ${s.links.length} links`);
  console.log(`  listening on http://${HOST}:${PORT}`);
  console.log(`  clicks      ${LOG_PATH}`);
  console.log(`  stats       http://${HOST}:${PORT}/stats`);
  if (!process.env.STATS_USER || !process.env.STATS_PASS)
    console.warn('  ! STATS_USER / STATS_PASS are unset — /stats will return 503');
  if (SALT_EPHEMERAL)
    console.warn('  ! HASH_SALT is unset — a random salt was generated, so unique-visitor counts reset on restart');
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => log.end(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
