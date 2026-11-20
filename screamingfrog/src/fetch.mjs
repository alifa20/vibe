// HTTP for the crawler: one request with a body-size cap, a retry on 429/503,
// and redirects followed by hand so every hop is recorded.
//
//   fetchOnce(url, opts)      -> { url, status, headers, location, body, size, tooLarge, timeMs, error }
//   fetchWithRetry(url, opts) -> same; a 429 or 503 with Retry-After is retried once after the wait
//   fetchFollowing(url, opts) -> { hops: [{ url, status, location }], final, loop, tooManyRedirects }
//
// opts: method, userAgent, timeoutMs, maxBodySize, sleep(ms), now(), fetchImpl.
// status 0 means the request failed (DNS, refused, timeout); `error` says why.

import { normaliseUrl } from "./url.mjs";

export const MAX_REDIRECTS = 10;

/** Fallbacks for direct callers; crawl() passes its own values (and a longer user agent). */
export const FETCH_DEFAULTS = { userAgent: "sitecrawl/1.0", timeoutMs: 20000, maxBodySize: 5 * 1024 * 1024 };

export const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readCapped(res, maxBodySize) {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBodySize) {
    await res.body?.cancel().catch(() => {});
    return { body: Buffer.alloc(0), size: declared, tooLarge: true };
  }
  if (!res.body) return { body: Buffer.alloc(0), size: 0, tooLarge: false };
  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodySize) {
      await reader.cancel().catch(() => {});
      return { body: Buffer.alloc(0), size, tooLarge: true };
    }
    chunks.push(value);
  }
  return { body: Buffer.concat(chunks), size, tooLarge: false };
}

export async function fetchOnce(url, opts = {}) {
  const {
    method = "GET",
    userAgent = FETCH_DEFAULTS.userAgent,
    timeoutMs = FETCH_DEFAULTS.timeoutMs,
    maxBodySize = FETCH_DEFAULTS.maxBodySize,
    now = () => performance.now(),
    fetchImpl = fetch,
  } = opts;
  const started = now();
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: "manual",
      headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const headers = Object.fromEntries(res.headers);
    const isRedirect = res.status >= 300 && res.status < 400 && headers.location;
    let read = { body: Buffer.alloc(0), size: 0, tooLarge: false };
    if (method === "HEAD" || isRedirect) await res.body?.cancel().catch(() => {});
    else read = await readCapped(res, maxBodySize);
    return {
      url,
      status: res.status,
      headers,
      location: isRedirect ? headers.location : null,
      ...read,
      timeMs: Math.round(now() - started),
      error: null,
    };
  } catch (err) {
    const error = err?.name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : String(err?.cause?.code || err?.message || err);
    return { url, status: 0, headers: {}, location: null, body: Buffer.alloc(0), size: 0, tooLarge: false, timeMs: Math.round(now() - started), error };
  }
}

/** Retry-After is either delay-seconds or an HTTP date. Returns ms, or null if absent or unparseable. */
export function retryAfterMs(value, nowMs = Date.now()) {
  if (value == null || value === "") return null;
  const v = String(value).trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

export async function fetchWithRetry(url, opts = {}) {
  const sleep = opts.sleep ?? realSleep;
  const first = await fetchOnce(url, opts);
  if (first.status !== 429 && first.status !== 503) return first;
  const wait = retryAfterMs(first.headers["retry-after"]);
  if (wait == null) return first;
  await sleep(wait);
  const second = await fetchOnce(url, opts);
  return { ...second, retried: true };
}

export async function fetchFollowing(url, opts = {}) {
  const hops = [];
  const seen = new Set([url]);
  let current = url;
  for (;;) {
    const res = await fetchWithRetry(current, opts);
    if (!res.location) return { hops, final: res, loop: false, tooManyRedirects: false };
    let next;
    try {
      next = normaliseUrl(new URL(res.location, current));
    } catch {
      return { hops, final: { ...res, error: `bad Location header: ${res.location}` }, loop: false, tooManyRedirects: false };
    }
    hops.push({ url: current, status: res.status, location: next });
    if (seen.has(next)) return { hops, final: res, loop: true, tooManyRedirects: false };
    if (hops.length >= MAX_REDIRECTS) return { hops, final: res, loop: false, tooManyRedirects: true };
    seen.add(next);
    current = next;
  }
}
