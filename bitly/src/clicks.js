import { dayKey, kvKey } from './util.js'

// Ordered most-specific first: a preview fetcher is a bot even though its UA
// often carries a mobile token.
const BOT_RE = /bot\b|bot\/|crawler|spider|crawl|slurp|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|discord|slack|twitter|linkedin|pinterest|redditbot|preview|monitor|curl\/|wget|python-requests|go-http-client|okhttp|java\/|axios|node-fetch|headless|lighthouse|pingdom|uptime|ahrefs|semrush/
const TABLET_RE = /ipad|tablet|playbook|silk|kindle|nexus 7|nexus 10|sm-t|android(?!.*mobile)/
const MOBILE_RE = /mobi|iphone|ipod|android|windows phone|iemobile|blackberry|bb10|opera mini|fennec/

/** Fixed order - the device colours in the admin follow the entity, not the rank. */
export const DEVICE_ORDER = ['desktop', 'mobile', 'tablet', 'bot', 'unknown']

export function parseDevice (userAgent) {
  const ua = String(userAgent || '').toLowerCase()
  if (!ua) return 'unknown'
  if (BOT_RE.test(ua)) return 'bot'
  if (TABLET_RE.test(ua)) return 'tablet'
  if (MOBILE_RE.test(ua)) return 'mobile'
  return 'desktop'
}

/**
 * Writes one row to D1 and bumps the link's counter. Always called from inside
 * ctx.waitUntil, so nothing here is on the redirect's critical path - and a
 * database hiccup logs instead of costing the visitor their redirect.
 */
export async function recordClick (env, request, { slug, outcome, at }) {
  const cf = request.cf || {}
  const referer = request.headers.get('referer')

  const insert = env.DB.prepare(
    'INSERT INTO clicks (slug, ts, day, country, city, device, referer, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    slug,
    at,
    dayKey(at),
    cf.country ?? null,
    cf.city ?? null,
    parseDevice(request.headers.get('user-agent')),
    referer ? referer.slice(0, 512) : null,
    outcome
  )

  try {
    // Expired / capped / disabled hits are logged for the record but must not
    // move the counter that decides when the cap is reached.
    if (outcome !== 'ok') {
      await insert.run()
      return
    }
    const results = await env.DB.batch([
      insert,
      env.DB.prepare('UPDATE links SET click_count = click_count + 1 WHERE slug = ? RETURNING click_count, max_clicks').bind(slug)
    ])
    const row = results[1]?.results?.[0]
    if (row?.max_clicks && row.click_count >= row.max_clicks) await markCapped(env, slug)
  } catch (err) {
    console.error(`click log failed for /${slug}:`, err)
  }
}

/**
 * Flips the cap flag in KV so the redirect path can enforce the cap from the
 * KV read alone. KV is eventually consistent (~60s), so a busy link can serve
 * a few clicks past its cap - the D1 count stays exact either way.
 */
async function markCapped (env, slug) {
  const key = kvKey(slug)
  const record = await env.LINKS.get(key, 'json')
  if (!record || record.capped) return
  await env.LINKS.put(key, JSON.stringify({ ...record, capped: true }))
}
