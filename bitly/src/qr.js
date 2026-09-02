import QRCode from 'qrcode'
import { encodeMonoPng } from './png.js'
import { HttpError, SLUG_RE, kvKey, shortOrigin } from './util.js'

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

/** Renders `payload` as a black-on-white PNG QR code. */
export async function renderQrPng (payload, { size = 512, margin = 4, ecc = 'M' } = {}) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: ecc })
  const count = qr.modules.size
  const modules = qr.modules.data

  // Whole-pixel scale only; a fractional module size is what makes a QR code
  // unreadable at print resolution.
  const scale = clamp(Math.round(size / (count + margin * 2)), 1, 40)
  const dimension = (count + margin * 2) * scale
  const stride = (dimension + 7) >> 3
  const quietRow = new Uint8Array(stride).fill(0xff)
  const cache = new Map()

  const rowFor = (moduleY) => {
    if (moduleY < 0 || moduleY >= count) return quietRow
    const cached = cache.get(moduleY)
    if (cached) return cached
    const row = new Uint8Array(stride).fill(0xff)
    for (let moduleX = 0; moduleX < count; moduleX++) {
      if (!modules[moduleY * count + moduleX]) continue // 0 = light module
      const start = (moduleX + margin) * scale
      for (let x = start; x < start + scale; x++) row[x >> 3] &= ~(0x80 >> (x & 7))
    }
    cache.set(moduleY, row)
    return row
  }

  const png = await encodeMonoPng(dimension, dimension, (y) => rowFor(Math.floor(y / scale) - margin))
  return { png, dimension, moduleCount: count }
}

/**
 * GET /qr/{slug}[.png]?size=&margin=&ecc=&download=1
 *
 * The QR encodes the short link, never the destination, so the printed artwork
 * keeps working after the destination is edited - and every scan is counted.
 */
export async function handleQr (request, env, ctx, url) {
  const slug = decodeURIComponent(url.pathname.slice('/qr/'.length)).replace(/\.png$/i, '')
  if (!SLUG_RE.test(slug)) throw new HttpError(404, 'No such link.')
  if (!(await env.LINKS.get(kvKey(slug), { cacheTtl: 60 }))) {
    throw new HttpError(404, `/${slug} does not exist, so there is nothing to make a QR code for.`)
  }

  const size = clamp(Number(url.searchParams.get('size')) || 512, 64, 2048)
  const margin = clamp(Number(url.searchParams.get('margin') ?? 4), 0, 16)
  const ecc = ['L', 'M', 'Q', 'H'].includes((url.searchParams.get('ecc') || '').toUpperCase())
    ? url.searchParams.get('ecc').toUpperCase()
    : 'M'
  const download = url.searchParams.has('download')

  // Cache on the canonical image parameters only, so ?download= reuses the
  // same cached bytes and only changes the disposition header.
  const cacheKey = new Request(`${url.origin}/qr/${slug}.png?size=${size}&margin=${margin}&ecc=${ecc}`)
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  const headers = new Headers({
    'content-type': 'image/png',
    'cache-control': 'public, max-age=86400, s-maxage=2592000',
    'x-content-type-options': 'nosniff'
  })
  if (download) headers.set('content-disposition', `attachment; filename="${slug}.png"`)

  if (hit) {
    headers.set('x-qr-cache', 'hit')
    return new Response(hit.body, { headers })
  }

  const target = `${shortOrigin(env, url)}/${slug}`
  const { png } = await renderQrPng(target, { size, margin, ecc })
  ctx.waitUntil(cache.put(cacheKey, new Response(png, { headers: new Headers(headers) })))
  headers.set('x-qr-cache', 'miss')
  return new Response(png, { headers })
}

/** Drops the cached PNGs for a slug (called when a link is deleted). */
export async function purgeQrCache (origin, slug) {
  const cache = caches.default
  await Promise.all([512, 1024, 2048, 256, 128, 64].map((size) =>
    cache.delete(new Request(`${origin}/qr/${slug}.png?size=${size}&margin=4&ecc=M`)).catch(() => {})
  ))
}
