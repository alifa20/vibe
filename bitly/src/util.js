/** Small shared helpers: errors, slugs, input validation, response builders. */

export class HttpError extends Error {
  constructor (status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/** Paths the worker owns. They can never be handed out as a back-half. */
export const RESERVED_SLUGS = new Set(['admin', 'api', 'qr', 'favicon.ico', 'robots.txt', 'index.html'])

/** Custom back-halves: letters, digits, - and _, 1-64 chars, no leading dash. */
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export const kvKey = (slug) => `link:${slug}`

/** Random base62 slug. Rejection-sampled so every character is equally likely. */
export function randomSlug (length = 6) {
  let out = ''
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte >= 248) continue // 248 = 62 * 4; drop the biased tail of the byte range
      out += BASE62[byte % 62]
      if (out.length === length) break
    }
  }
  return out
}

export function assertValidSlug (slug) {
  if (!SLUG_RE.test(slug)) {
    throw new HttpError(400, `"${slug}" is not a usable back-half. Use 1-64 characters (letters, digits, - or _) starting with a letter or digit.`)
  }
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    throw new HttpError(400, `"${slug}" is reserved by the worker itself. Pick another back-half.`)
  }
  return slug
}

/** Accepts "example.com/x" as well as a full URL. Only http(s) comes back out. */
export function normalizeUrl (input, field = 'destination URL') {
  const raw = String(input ?? '').trim()
  if (!raw) throw new HttpError(400, `A ${field} is required.`)
  let url
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new HttpError(400, `That ${field} does not parse as a URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, `Only http and https are allowed for the ${field} (got "${url.protocol}").`)
  }
  if (url.href.length > 2048) throw new HttpError(400, `That ${field} is longer than 2048 characters.`)
  return url.href
}

/**
 * Accepts a relative offset ("7d", "12h", "30m", "2w"), a bare datetime-local
 * value from the admin form (read as UTC), or any ISO 8601 string.
 * Returns epoch ms, or null for an empty value.
 */
export function parseWhen (input, field = 'expiry') {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const relative = raw.match(/^\+?(\d+)\s*([mhdw])$/i)
  if (relative) {
    const unit = { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 }[relative[2].toLowerCase()]
    return Date.now() + Number(relative[1]) * unit
  }
  // <input type="datetime-local"> submits "2026-09-30T17:00" with no zone; the
  // form labels the field UTC so the reading is unambiguous either way.
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw) ? `${raw}Z` : raw
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new HttpError(400, `Could not read the ${field} "${raw}". Use "7d" or "2026-09-30T17:00".`)
  return ms
}

/** Positive integer, or null for an empty value. */
export function parseCount (input, field = 'click cap') {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `The ${field} must be a whole number of 1 or more (got "${raw}").`)
  return n
}

/** UTC day key, "YYYY-MM-DD" - the grouping unit for every per-day chart. */
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10)

/** The public origin of a short link: the bound domain, or whatever host was used. */
export const shortOrigin = (env, url) => (env.SHORT_DOMAIN ? `https://${env.SHORT_DOMAIN}` : new URL(url).origin)

export function escapeHtml (value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/** Constant-time comparison, so a wrong password leaks nothing through timing. */
export function timingSafeEqual (a, b) {
  const left = String(a)
  const right = String(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return diff === 0
}

export async function sha256Hex (value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const respond = (body, type, init = {}) => new Response(body, {
  status: init.status ?? 200,
  headers: { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(init.headers || {}) }
})

export const html = (markup, init) => respond(markup, 'text/html; charset=utf-8', init)
export const json = (body, init) => respond(`${JSON.stringify(body, null, 2)}\n`, 'application/json; charset=utf-8', init)
export const text = (body, init) => respond(body, 'text/plain; charset=utf-8', init)
