import { purgeQrCache } from './qr.js'
import { HttpError, assertValidSlug, kvKey, normalizeUrl, parseCount, parseWhen, randomSlug } from './util.js'

const isConflict = (err) => /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String(err?.message || err))

const COLUMNS = 'slug, target_url, created_at, expires_at, max_clicks, fallback_url, click_count, disabled, note'

/** The redirect path reads only this - keep it small, it is fetched per click. */
export function kvRecord (row) {
  const record = { url: row.target_url }
  if (row.expires_at) record.expiresAt = row.expires_at
  if (row.max_clicks) record.maxClicks = row.max_clicks
  if (row.fallback_url) record.fallbackUrl = row.fallback_url
  if (row.disabled) record.disabled = true
  if (row.max_clicks && row.click_count >= row.max_clicks) record.capped = true
  return record
}

export const getLink = (env, slug) =>
  env.DB.prepare(`SELECT ${COLUMNS} FROM links WHERE slug = ?`).bind(slug).first()

export const listLinks = (env, limit = 500) =>
  env.DB.prepare(`SELECT ${COLUMNS} FROM links ORDER BY created_at DESC LIMIT ?`).bind(limit)

/** Rewrites the KV copy from the authoritative D1 row. */
export async function syncKv (env, slug) {
  const row = await getLink(env, slug)
  if (!row) throw new HttpError(404, `/${slug} does not exist.`)
  await env.LINKS.put(kvKey(slug), JSON.stringify(kvRecord(row)))
  return row
}

/**
 * Creates a link. D1's primary key is the authority on uniqueness, so two
 * simultaneous creates of the same back-half cannot both win - the loser gets
 * a 409 rather than silently overwriting the existing link.
 */
export async function createLink (env, input) {
  const link = {
    target: normalizeUrl(input.url),
    fallbackUrl: input.fallbackUrl ? normalizeUrl(input.fallbackUrl, 'fallback URL') : null,
    expiresAt: parseWhen(input.expiresAt),
    maxClicks: parseCount(input.maxClicks),
    note: input.note ? String(input.note).trim().slice(0, 200) || null : null,
    createdAt: Date.now()
  }

  const requested = String(input.slug ?? '').trim()
  if (requested) {
    const slug = assertValidSlug(requested)
    // Cheap pre-check so an orphaned KV entry (D1 row deleted by hand) is also
    // reported as a conflict instead of being clobbered.
    if (await env.LINKS.get(kvKey(slug))) {
      throw new HttpError(409, `/${slug} already exists. Delete it first, or choose a different back-half.`)
    }
    return await insertLink(env, { ...link, slug })
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await insertLink(env, { ...link, slug: randomSlug(6) })
    } catch (err) {
      if (err.status === 409) continue
      throw err
    }
  }
  throw new HttpError(500, 'Could not find an unused random back-half after 8 tries.')
}

async function insertLink (env, link) {
  try {
    await env.DB.prepare(
      'INSERT INTO links (slug, target_url, created_at, expires_at, max_clicks, fallback_url, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(link.slug, link.target, link.createdAt, link.expiresAt, link.maxClicks, link.fallbackUrl, link.note).run()
  } catch (err) {
    if (isConflict(err)) {
      throw new HttpError(409, `/${link.slug} already exists. Delete it first, or choose a different back-half.`)
    }
    throw err
  }

  try {
    await env.LINKS.put(kvKey(link.slug), JSON.stringify(kvRecord({
      target_url: link.target,
      expires_at: link.expiresAt,
      max_clicks: link.maxClicks,
      fallback_url: link.fallbackUrl,
      click_count: 0
    })))
  } catch (err) {
    // The redirect path reads KV, so a link that exists only in D1 is a 404
    // waiting to happen. Undo the row rather than leave it half-created.
    await env.DB.prepare('DELETE FROM links WHERE slug = ?').bind(link.slug).run().catch(() => {})
    throw new HttpError(502, `/${link.slug} was rolled back: the D1 row was written but the KV write failed (${err.message}).`)
  }

  return await getLink(env, link.slug)
}

/** Partial update. Only the keys present in `patch` are touched. */
export async function updateLink (env, slug, patch) {
  const existing = await getLink(env, slug)
  if (!existing) throw new HttpError(404, `/${slug} does not exist.`)

  const fields = []
  const values = []
  const set = (column, value) => { fields.push(`${column} = ?`); values.push(value) }

  if (patch.url !== undefined) set('target_url', normalizeUrl(patch.url))
  if (patch.fallbackUrl !== undefined) set('fallback_url', patch.fallbackUrl ? normalizeUrl(patch.fallbackUrl, 'fallback URL') : null)
  if (patch.expiresAt !== undefined) set('expires_at', parseWhen(patch.expiresAt))
  if (patch.maxClicks !== undefined) set('max_clicks', parseCount(patch.maxClicks))
  if (patch.note !== undefined) set('note', patch.note ? String(patch.note).trim().slice(0, 200) || null : null)
  if (patch.disabled !== undefined) set('disabled', patch.disabled ? 1 : 0)
  if (patch.resetClicks) set('click_count', 0)
  if (!fields.length) return existing

  values.push(slug)
  await env.DB.prepare(`UPDATE links SET ${fields.join(', ')} WHERE slug = ?`).bind(...values).run()
  return await syncKv(env, slug)
}

/** Removes the link, its KV entry, its click history and its cached QR PNGs. */
export async function deleteLink (env, slug, origin) {
  const existing = await getLink(env, slug)
  if (!existing) throw new HttpError(404, `/${slug} does not exist.`)
  await env.LINKS.delete(kvKey(slug))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM clicks WHERE slug = ?').bind(slug),
    env.DB.prepare('DELETE FROM links WHERE slug = ?').bind(slug)
  ])
  if (origin) await purgeQrCache(origin, slug)
  return existing
}
