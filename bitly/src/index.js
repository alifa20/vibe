/**
 * go.<your-domain>/{slug}
 *
 *   GET /{slug}      302 to the destination; the click is written to D1 from
 *                    inside ctx.waitUntil, so the redirect never waits on it.
 *   GET /qr/{slug}   cached PNG QR code of the short link.
 *   /admin           password-protected analytics.
 *   /api/links       the same operations for scripts.
 */
import { handleAdmin } from './admin.js'
import { handleQr } from './qr.js'
import { recordClick } from './clicks.js'
import { createLink, deleteLink, getLink, listLinks, updateLink } from './links.js'
import { HttpError, SLUG_RE, escapeHtml, html, json, kvKey, sha256Hex, shortOrigin, text, timingSafeEqual } from './util.js'

export default {
  async fetch (request, env, ctx) {
    const url = new URL(request.url)
    try {
      if (url.pathname === '/robots.txt') {
        return text('User-agent: *\nDisallow: /\n', { headers: { 'cache-control': 'public, max-age=86400' } })
      }
      if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 })
      if (url.pathname === '/') {
        return env.FALLBACK_URL
          ? new Response(null, { status: 302, headers: { location: env.FALLBACK_URL, 'cache-control': 'no-store' } })
          : notFound('This is a link shortener. There is nothing at the root.')
      }
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return await handleAdmin(request, env, ctx, url)
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, ctx, url)
      if (url.pathname.startsWith('/qr/')) return await handleQr(request, env, ctx, url)
      return await handleRedirect(request, env, ctx, url)
    } catch (err) {
      return errorResponse(err, url)
    }
  }
}

// ------------------------------------------------------------- the hot path

async function handleRedirect (request, env, ctx, url) {
  const slug = decodeURIComponent(url.pathname.slice(1)).replace(/\/+$/, '')
  if (!SLUG_RE.test(slug)) return notFound(`/${slug} is not a link on this domain.`)

  // One KV read is the whole lookup. cacheTtl keeps it in the colo's cache, so
  // a popular link is served without a round trip to central KV storage.
  const record = await env.LINKS.get(kvKey(slug), { type: 'json', cacheTtl: 60 })
  if (!record) return notFound(`/${slug} is not a link on this domain.`)

  const now = Date.now()
  let outcome = 'ok'
  if (record.disabled) outcome = 'disabled'
  else if (record.expiresAt && now >= record.expiresAt) outcome = 'expired'
  else if (record.capped) outcome = 'capped'

  const destination = outcome === 'ok' ? record.url : record.fallbackUrl || env.FALLBACK_URL
  if (!destination) {
    return notFound(`/${slug} has ${outcome === 'expired' ? 'expired' : 'reached its click limit'} and no fallback URL is configured.`)
  }

  ctx.waitUntil(recordClick(env, request, { slug, outcome, at: now }))
  return new Response(null, {
    status: 302,
    headers: {
      location: destination,
      // Never let a browser or proxy cache the hop: a cached 302 is a click
      // that never reaches the log, and it outlives edits to the link.
      'cache-control': 'no-store, no-cache, must-revalidate',
      'referrer-policy': 'unsafe-url',
      'x-robots-tag': 'noindex'
    }
  })
}

// --------------------------------------------------------------------- api

async function assertApiAuth (request, env) {
  if (!env.ADMIN_PASSWORD) throw new HttpError(503, 'ADMIN_PASSWORD is not set. Run: npx wrangler secret put ADMIN_PASSWORD')
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const ok = timingSafeEqual(await sha256Hex(token), await sha256Hex(env.ADMIN_PASSWORD))
  if (!ok) throw new HttpError(401, 'Send the admin password as: Authorization: Bearer <password>')
}

const publicLink = (row, env, url) => ({
  slug: row.slug,
  shortUrl: `${shortOrigin(env, url)}/${row.slug}`,
  qrUrl: `${shortOrigin(env, url)}/qr/${row.slug}.png`,
  url: row.target_url,
  createdAt: new Date(row.created_at).toISOString(),
  expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  maxClicks: row.max_clicks,
  fallbackUrl: row.fallback_url,
  clicks: row.click_count,
  disabled: Boolean(row.disabled),
  note: row.note
})

async function readBody (request) {
  const type = request.headers.get('content-type') || ''
  if (type.includes('application/json')) return await request.json()
  if (type.includes('form')) return Object.fromEntries(await request.formData())
  return {}
}

async function handleApi (request, env, ctx, url) {
  await assertApiAuth(request, env)
  const match = url.pathname.match(/^\/api\/links(?:\/([^/]+))?$/)
  if (!match) throw new HttpError(404, 'Unknown endpoint. Try /api/links.')
  const slug = match[1] ? decodeURIComponent(match[1]) : null
  const method = request.method.toUpperCase()

  if (!slug) {
    if (method === 'GET') {
      const { results } = await listLinks(env, Number(url.searchParams.get('limit')) || 500).all()
      return json({ links: results.map((row) => publicLink(row, env, url)) })
    }
    if (method === 'POST') {
      const row = await createLink(env, await readBody(request))
      return json({ link: publicLink(row, env, url) }, { status: 201 })
    }
    throw new HttpError(405, `${method} is not allowed on /api/links.`)
  }

  if (method === 'GET') {
    const row = await getLink(env, slug)
    if (!row) throw new HttpError(404, `/${slug} does not exist.`)
    return json({ link: publicLink(row, env, url) })
  }
  if (method === 'PATCH' || method === 'POST') {
    const row = await updateLink(env, slug, await readBody(request))
    return json({ link: publicLink(row, env, url) })
  }
  if (method === 'DELETE') {
    await deleteLink(env, slug, url.origin)
    return json({ deleted: slug })
  }
  throw new HttpError(405, `${method} is not allowed on /api/links/${slug}.`)
}

// ------------------------------------------------------------------ errors

const PAGE = (status, title, message) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${status} ${escapeHtml(title)}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-content:center;gap:6px;
text-align:center;padding:24px;background:#f9f9f7;color:#0b0b0b;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:15px;font-weight:600;margin:0}p{margin:0;color:#52514e;max-width:38ch}
@media(prefers-color-scheme:dark){body{background:#0d0d0d;color:#fff}p{color:#c3c2b7}}</style></head>
<body><h1>${status} &middot; ${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`

const notFound = (message) => html(PAGE(404, 'Not found', message), { status: 404 })

function errorResponse (err, url) {
  const status = err instanceof HttpError ? err.status : 500
  const message = err instanceof HttpError ? err.message : 'Something went wrong on this worker.'
  if (status >= 500) console.error(`${status} on ${url.pathname}:`, err)
  if (url.pathname.startsWith('/api/')) return json({ error: message, status }, { status })
  const title = { 400: 'Bad request', 401: 'Unauthorized', 404: 'Not found', 405: 'Not allowed', 409: 'Already exists', 503: 'Not configured' }[status] || 'Error'
  return html(PAGE(status, title, message), { status })
}
