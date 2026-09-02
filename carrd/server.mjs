#!/usr/bin/env node
/**
 * server.mjs — serves dist/ and accepts the contact form.
 *
 * Node built-ins only. Messages are appended to messages.log as JSON Lines.
 *   PORT=8080 MESSAGES_LOG=/var/data/messages.log node server.mjs
 */
import { createServer } from "node:http";
import { readFile, appendFile, stat } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const LOG = process.env.MESSAGES_LOG || join(ROOT, "messages.log");
const SPAM_LOG = process.env.SPAM_LOG || join(ROOT, "messages.spam.log");
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const DEV = process.argv.includes("--dev");

/* Rate limit: RATE_MAX submissions per RATE_WINDOW ms, per client. */
const RATE_MAX = Number(process.env.RATE_MAX || 5);
const RATE_WINDOW = Number(process.env.RATE_WINDOW_MS || 10 * 60 * 1000);

const MAX_BODY = 64 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf"
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|javascript)|image\/svg)/;

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/index.html is missing — run `node build.mjs` first.");
  process.exit(1);
}

/**
 * The CSP carries hashes of the inlined <style> and <script>, so it changes
 * on every build. Re-read it whenever dist/headers.json moves, otherwise a
 * rebuild under a running server would serve a stale CSP and the browser
 * would refuse the page's own stylesheet.
 */
let securityHeaders = {};
let headersMtime = -1;
function loadHeaders() {
  try {
    const { mtimeMs } = statSync(join(DIST, "headers.json"));
    if (mtimeMs === headersMtime) return;
    headersMtime = mtimeMs;
    securityHeaders = JSON.parse(readFileSync(join(DIST, "headers.json"), "utf8"));
  } catch { securityHeaders = {}; headersMtime = -1; }
}
loadHeaders();

/* ── dev: rebuild when sources change ──────────────────────────── */
const WATCHED = ["content.json", "src/styles.css", "src/app.js", "build.mjs"].map((f) => join(ROOT, f));
let stamp = null;
function sourceStamp() {
  return WATCHED.map((f) => {
    try { const s = statSync(f); return `${f}:${s.mtimeMs}:${s.size}`; }
    catch { return f + ":missing"; }
  }).join("|");
}

function maybeRebuild() {
  if (!DEV) return;
  const next = sourceStamp();
  if (next === stamp) return;
  const first = stamp === null;
  stamp = next;
  if (first) return; // first tick just records the baseline
  try {
    execFileSync(process.execPath, [join(ROOT, "build.mjs"), "--fast"], { stdio: "inherit" });
    loadHeaders();
    etags.clear();
  } catch { console.error("build failed — still serving the previous dist/"); }
}
if (DEV) stamp = sourceStamp(); // baseline: the caller just built

/* ── helpers ───────────────────────────────────────────────────── */
const etags = new Map();

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) return String(xff).split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW)) hits.delete(k);
  return list.length > RATE_MAX;
}

function send(req, res, status, body, type, extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const headers = { ...securityHeaders, "Content-Type": type, ...extra };
  const accepts = String(req.headers["accept-encoding"] || "").includes("gzip");

  let out = buf;
  if (accepts && COMPRESSIBLE.test(type) && buf.length > 512) {
    out = gzipSync(buf, { level: 8 });
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
  }
  headers["Content-Length"] = out.length;
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : out);
}

const json = (req, res, status, obj) =>
  send(req, res, status, JSON.stringify(obj), "application/json; charset=utf-8", { "Cache-Control": "no-store" });

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* ── static ────────────────────────────────────────────────────── */
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  let file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST)) return notFound(req, res);

  // headers.json is build metadata, not public.
  if (file === join(DIST, "headers.json")) return notFound(req, res);

  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) { file = join(file, "index.html"); info = await stat(file).catch(() => null); }
  if (!info && !extname(file)) {
    const alt = file + ".html";
    const altInfo = await stat(alt).catch(() => null);
    if (altInfo) { file = alt; info = altInfo; }
  }
  if (!info) return notFound(req, res);

  const type = TYPES[extname(file)] || "application/octet-stream";
  const isHtml = type.startsWith("text/html");

  const key = file + info.mtimeMs + info.size;
  let etag = etags.get(key);
  const buf = await readFile(file);
  if (!etag) {
    etag = '"' + createHash("sha1").update(buf).digest("base64").slice(0, 20) + '"';
    etags.set(key, etag);
  }

  const cache = isHtml
    ? "public, max-age=0, must-revalidate"
    : "public, max-age=604800, stale-while-revalidate=86400";

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ...securityHeaders, ETag: etag, "Cache-Control": cache });
    return res.end();
  }
  send(req, res, 200, buf, type, { ETag: etag, "Cache-Control": cache });
}

async function notFound(req, res) {
  const page = await readFile(join(DIST, "404.html")).catch(() => null);
  if (page) return send(req, res, 404, page, "text/html; charset=utf-8", { "Cache-Control": "no-store" });
  send(req, res, 404, "Not found", "text/plain; charset=utf-8");
}

/* ── contact ───────────────────────────────────────────────────── */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

async function handleContact(req, res) {
  const wantsJson = String(req.headers.accept || "").includes("application/json");
  const fail = (status, error) =>
    wantsJson ? json(req, res, status, { ok: false, error })
              : send(req, res, status, error, "text/plain; charset=utf-8", { "Cache-Control": "no-store" });
  const succeed = () =>
    wantsJson ? json(req, res, 200, { ok: true })
              : (res.writeHead(303, { ...securityHeaders, Location: "/thanks.html", "Cache-Control": "no-store" }), res.end());

  let raw;
  try { raw = await readBody(req); }
  catch { return fail(413, "That message is too long."); }

  const ct = String(req.headers["content-type"] || "");
  let fields = {};
  try {
    if (ct.includes("application/json")) fields = JSON.parse(raw || "{}");
    else fields = Object.fromEntries(new URLSearchParams(raw));
  } catch { return fail(400, "That submission could not be read."); }

  const entry = {
    ts: new Date().toISOString(),
    name: clean(fields.name, 100),
    email: clean(fields.email, 200),
    message: clean(fields.message, 5000),
    ip: clientIp(req),
    ua: clean(req.headers["user-agent"], 300)
  };

  // Honeypot. Bots fill every field they find; humans never see this one.
  // Answer as though it worked so the bot has nothing to learn.
  if (clean(fields.company, 200)) {
    await appendFile(SPAM_LOG, JSON.stringify({ ...entry, trap: clean(fields.company, 200) }) + "\n").catch(() => {});
    return succeed();
  }

  if (!entry.name) return fail(422, "Please add your name.");
  if (!EMAIL.test(entry.email)) return fail(422, "That email address looks incomplete.");
  if (entry.message.length < 2) return fail(422, "Please add a message.");

  if (rateLimited(entry.ip)) return fail(429, "That's a few too many messages — try again shortly.");

  try {
    await appendFile(LOG, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    console.error("could not write to", LOG, e.message);
    return fail(500, "The message could not be saved.");
  }

  console.log(`✉  ${entry.ts}  ${entry.name} <${entry.email}>  (${entry.message.length} chars)`);
  return succeed();
}

/* ── router ────────────────────────────────────────────────────── */
const server = createServer(async (req, res) => {
  try {
    maybeRebuild();
    loadHeaders();
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

    if (url.pathname === "/api/contact") {
      if (req.method === "POST") return await handleContact(req, res);
      return send(req, res, 405, "Method not allowed", "text/plain; charset=utf-8", { Allow: "POST" });
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(req, res, 405, "Method not allowed", "text/plain; charset=utf-8", { Allow: "GET, HEAD" });
    }

    await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(req, res, 500, "Server error", "text/plain; charset=utf-8");
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`→ http://localhost:${PORT}${DEV ? "  (dev: rebuilds on change)" : ""}`);
  console.log(`  messages → ${LOG}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
