/** The admin: one password, a link list with per-day clicks, per-link detail. */
import { DEVICE_ORDER } from './clicks.js'
import { barRows, columnChart, compact, dayLabel, fmt, sparkline, stackedBar } from './charts.js'
import { createLink, deleteLink, getLink, listLinks, updateLink } from './links.js'
import { filterRow, flash, layout } from './admin-ui.js'
import { HttpError, dayKey, escapeHtml, html, sha256Hex, shortOrigin, timingSafeEqual } from './util.js'

const RANGES = [7, 30, 90]
const SESSION_COOKIE = 'golinks_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
/** Fixed device -> palette slot. Colour follows the entity, never the rank. */
const DEVICE_SLOT = { desktop: 1, mobile: 2, tablet: 3, bot: 4, unknown: 5 }
const REGIONS = new Intl.DisplayNames(['en'], { type: 'region' })

// ---------------------------------------------------------------- routing

export async function handleAdmin (request, env, ctx, url) {
  if (!env.ADMIN_PASSWORD) {
    throw new HttpError(503, 'ADMIN_PASSWORD is not set. Run: npx wrangler secret put ADMIN_PASSWORD')
  }
  const path = url.pathname.replace(/\/+$/, '') || '/admin'

  if (path === '/admin/login') {
    return request.method === 'POST' ? await login(request, env, url) : seeOther('/admin')
  }
  if (!(await hasSession(request, env))) return html(loginPage(null))
  if (path === '/admin/logout') return logout(url)

  const detail = path.match(/^\/admin\/l\/([^/]+)(?:\/(update|delete|toggle|reset))?$/)
  const slug = detail ? decodeURIComponent(detail[1]) : null

  if (request.method === 'POST') {
    if (path === '/admin/create') return await createFromForm(request, env, url)
    if (detail?.[2]) return await mutate(detail[2], slug, request, env, url)
    throw new HttpError(405, `${request.method} is not allowed here.`)
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, `${request.method} is not allowed here.`)
  if (detail) return await detailPage(slug, env, url)
  if (path === '/admin') return await dashboardPage(env, url)
  throw new HttpError(404, 'No such admin page.')
}

const seeOther = (location) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } })
const withFlash = (path, key, message) => seeOther(`${path}?${key}=${encodeURIComponent(message)}`)

// ------------------------------------------------------------------- auth

async function hmacHex (secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The session cookie is `expiry.HMAC(password, expiry)`. The password itself is
 * the signing key, so rotating the secret invalidates every live session.
 */
async function hasSession (request, env) {
  const jar = (request.headers.get('cookie') || '').split(/;\s*/)
  const cookie = jar.find((entry) => entry.startsWith(`${SESSION_COOKIE}=`))
  if (!cookie) return false
  const [expiry, signature] = cookie.slice(SESSION_COOKIE.length + 1).split('.')
  if (!signature || !(Number(expiry) > Date.now())) return false
  return timingSafeEqual(signature, await hmacHex(env.ADMIN_PASSWORD, `session:${expiry}`))
}

const sessionCookie = (value, url, maxAgeSeconds) =>
  `${SESSION_COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}` +
  (url.protocol === 'https:' ? '; Secure' : '')

async function login (request, env, url) {
  const form = await request.formData()
  const given = String(form.get('password') || '')
  const matches = timingSafeEqual(await sha256Hex(given), await sha256Hex(env.ADMIN_PASSWORD))
  if (!matches) return html(loginPage('That password is not right.'), { status: 401 })
  const expiry = Date.now() + SESSION_TTL_MS
  const token = `${expiry}.${await hmacHex(env.ADMIN_PASSWORD, `session:${expiry}`)}`
  return new Response(null, {
    status: 303,
    headers: { location: '/admin', 'cache-control': 'no-store', 'set-cookie': sessionCookie(token, url, SESSION_TTL_MS / 1000) }
  })
}

const logout = (url) => new Response(null, {
  status: 303,
  headers: { location: '/admin', 'cache-control': 'no-store', 'set-cookie': sessionCookie('', url, 0) }
})

const loginPage = (error) => layout('Sign in', `<div class="wrap login"><div class="card">
  <h1>Link admin</h1><p class="sub">One password, set with <code class="mono">wrangler secret</code>.</p>
  ${error ? `<p class="flash err">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="/admin/login">
    <label class="field"><span>Password</span>
      <input type="password" name="password" autocomplete="current-password" autofocus required></label>
    <button type="submit">Sign in</button>
  </form></div></div>`)

// ------------------------------------------------------------- dashboard

const pickDays = (url) => {
  const requested = Number(url.searchParams.get('days'))
  return RANGES.includes(requested) ? requested : 30
}

const startOfUtcDay = (ms) => Date.parse(`${dayKey(ms)}T00:00:00Z`)

const daySeries = (days) => {
  const today = startOfUtcDay(Date.now())
  return Array.from({ length: days }, (_, index) => dayKey(today - (days - 1 - index) * 86400000))
}

function statusOf (row) {
  if (row.disabled) return 'disabled'
  if (row.expires_at && row.expires_at <= Date.now()) return 'expired'
  if (row.max_clicks && row.click_count >= row.max_clicks) return 'capped'
  return 'active'
}

const statusPill = (status) => `<span class="pill ${status}">${status}</span>`

async function dashboardPage (env, url) {
  const days = pickDays(url)
  const range = daySeries(days)
  const since = Date.parse(`${range[0]}T00:00:00Z`)

  const [linkResult, dailyResult, deviceResult] = await env.DB.batch([
    listLinks(env),
    env.DB.prepare("SELECT slug, day, COUNT(*) AS n FROM clicks WHERE ts >= ? AND outcome = 'ok' GROUP BY slug, day").bind(since),
    env.DB.prepare('SELECT device, COUNT(*) AS n FROM clicks WHERE ts >= ? GROUP BY device').bind(since)
  ])

  const links = linkResult.results
  const perSlug = new Map()
  const perDay = new Map()
  for (const row of dailyResult.results) {
    if (!perSlug.has(row.slug)) perSlug.set(row.slug, new Map())
    perSlug.get(row.slug).set(row.day, row.n)
    perDay.set(row.day, (perDay.get(row.day) || 0) + row.n)
  }

  const series = range.map((day) => ({ day, value: perDay.get(day) || 0 }))
  const total = series.reduce((sum, point) => sum + point.value, 0)
  const today = series[series.length - 1].value
  const sparkRange = range.slice(-14)
  const active = links.filter((row) => statusOf(row) === 'active').length
  const devices = deviceResult.results.reduce((acc, row) => acc + (row.device === 'bot' ? row.n : 0), 0)
  const deviceTotal = deviceResult.results.reduce((acc, row) => acc + row.n, 0)

  const rows = links.map((row) => {
    const byDay = perSlug.get(row.slug) || new Map()
    const rangeClicks = range.reduce((sum, day) => sum + (byDay.get(day) || 0), 0)
    const status = statusOf(row)
    return `<tr>
      <td><a class="slug" href="/admin/l/${encodeURIComponent(row.slug)}">/${escapeHtml(row.slug)}</a>
        ${row.note ? `<div class="note mono" style="color:var(--muted)">${escapeHtml(row.note)}</div>` : ''}</td>
      <td><a class="dest" href="${escapeHtml(row.target_url)}" title="${escapeHtml(row.target_url)}" rel="noreferrer noopener">${escapeHtml(row.target_url.replace(/^https?:\/\//, ''))}</a></td>
      <td>${sparkline(sparkRange.map((day) => ({ day, value: byDay.get(day) || 0 })))}</td>
      <td class="num">${fmt(rangeClicks)}</td>
      <td class="num">${fmt(row.click_count)}${row.max_clicks ? `<span style="color:var(--muted)"> / ${fmt(row.max_clicks)}</span>` : ''}</td>
      <td>${statusPill(status)}</td>
      <td><a href="/qr/${encodeURIComponent(row.slug)}?size=1024&amp;download=1">QR</a></td>
    </tr>`
  }).join('')

  const body = `<div class="wrap">
    <header class="top"><h1>Link admin</h1>
      <span class="host">${escapeHtml(shortOrigin(env, url).replace(/^https?:\/\//, ''))}</span>
      <span class="spacer"></span>
      <form method="post" action="/admin/logout"><button class="ghost" type="submit">Sign out</button></form>
    </header>
    ${flash(url)}
    ${filterRow('/admin', days, RANGES)}
    <section class="card"><div class="hero">
      <div class="figure"><div class="value">${fmt(total)}</div>
        <div class="label">clicks in the last ${days} days</div></div>
      <div class="plot">${columnChart(series)}</div>
    </div>
    <details class="tableview"><summary>Table view</summary><div class="scroll">
      <table><thead><tr><th>Day</th><th class="num">Clicks</th></tr></thead><tbody>
      ${series.slice().reverse().map((point) => `<tr><td>${escapeHtml(dayLabel(point.day))}</td><td class="num">${fmt(point.value)}</td></tr>`).join('')}
      </tbody></table></div></details>
    </section>
    <div class="tiles">
      <div class="tile"><div class="label">Links</div><div class="value">${fmt(links.length)}</div>
        <div class="note">${fmt(active)} active</div></div>
      <div class="tile"><div class="label">Clicks today</div><div class="value">${fmt(today)}</div>
        <div class="note">UTC day</div></div>
      <div class="tile"><div class="label">Busiest day</div>
        <div class="value">${compact(Math.max(0, ...series.map((point) => point.value)))}</div>
        <div class="note">${escapeHtml(dayLabel(series.reduce((best, point) => (point.value > best.value ? point : best), series[0]).day))}</div></div>
      <div class="tile"><div class="label">Bots &amp; previews</div>
        <div class="value">${deviceTotal ? Math.round((devices / deviceTotal) * 100) : 0}%</div>
        <div class="note">of hits in range</div></div>
    </div>
    <section class="card"><h2>Links</h2><p class="sub">Newest first. Trend covers the last ${sparkRange.length} days.</p>
      <div class="scroll"><table>
        <thead><tr><th>Back-half</th><th>Destination</th><th>Last ${sparkRange.length} days</th>
          <th class="num">Clicks (${days}d)</th><th class="num">All time</th><th>Status</th><th>QR</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty">No links yet. Create one below.</td></tr>'}</tbody>
      </table></div>
    </section>
    <section class="card"><h2>New link</h2><p class="sub">Leave the back-half blank for a random 6-character one.</p>
      ${linkForm({ action: '/admin/create', submit: 'Create link' })}
    </section>
  </div>`
  return html(layout('Link admin', body))
}

// ---------------------------------------------------------------- detail

const flagFor = (code) => (/^[A-Z]{2}$/.test(code || '') && code !== 'XX'
  ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
  : '')

function countryName (code) {
  if (!code || code === 'XX') return 'Unknown'
  if (code === 'T1') return 'Tor exit node'
  try { return REGIONS.of(code) || code } catch { return code }
}

const refererLabel = (value) => {
  if (!value) return '(direct or app)'
  try {
    const parsed = new URL(value)
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`.slice(0, 60)
  } catch { return value.slice(0, 60) }
}

const utc = (ms) => `${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC`
const forInput = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16) : '')

async function detailPage (slug, env, url) {
  const days = pickDays(url)
  const range = daySeries(days)
  const since = Date.parse(`${range[0]}T00:00:00Z`)
  const base = `/admin/l/${encodeURIComponent(slug)}`

  const link = await getLink(env, slug)
  if (!link) throw new HttpError(404, `/${slug} does not exist.`)

  const [daily, countries, devices, referrers, recent, outcomes] = await env.DB.batch([
    env.DB.prepare("SELECT day, COUNT(*) AS n FROM clicks WHERE slug = ? AND ts >= ? AND outcome = 'ok' GROUP BY day").bind(slug, since),
    env.DB.prepare('SELECT country, COUNT(*) AS n FROM clicks WHERE slug = ? AND ts >= ? GROUP BY country ORDER BY n DESC LIMIT 10').bind(slug, since),
    env.DB.prepare('SELECT device, COUNT(*) AS n FROM clicks WHERE slug = ? AND ts >= ? GROUP BY device').bind(slug, since),
    env.DB.prepare('SELECT referer, COUNT(*) AS n FROM clicks WHERE slug = ? AND ts >= ? GROUP BY referer ORDER BY n DESC LIMIT 8').bind(slug, since),
    env.DB.prepare('SELECT ts, country, city, device, referer, outcome FROM clicks WHERE slug = ? ORDER BY ts DESC LIMIT 25').bind(slug),
    env.DB.prepare('SELECT outcome, COUNT(*) AS n FROM clicks WHERE slug = ? AND ts >= ? GROUP BY outcome').bind(slug, since)
  ])

  const byDay = new Map(daily.results.map((row) => [row.day, row.n]))
  const series = range.map((day) => ({ day, value: byDay.get(day) || 0 }))
  const rangeTotal = series.reduce((sum, point) => sum + point.value, 0)
  const deviceCounts = new Map(devices.results.map((row) => [row.device || 'unknown', row.n]))
  const missed = outcomes.results.filter((row) => row.outcome !== 'ok').reduce((sum, row) => sum + row.n, 0)
  const status = statusOf(link)
  const topCountry = countries.results[0]

  const countryRows = countries.results.map((row) => ({
    value: row.n,
    html: `${flagFor(row.country)} ${escapeHtml(countryName(row.country))}`.trim()
  }))
  const deviceSegments = DEVICE_ORDER.map((device) => ({
    label: device, value: deviceCounts.get(device) || 0, slot: DEVICE_SLOT[device]
  }))

  const body = `<div class="wrap">
    <header class="top"><h1><a href="/admin" style="text-decoration:none;color:var(--muted)">Links</a> / ${escapeHtml(slug)}</h1>
      <span class="spacer"></span>
      <form method="post" action="/admin/logout"><button class="ghost" type="submit">Sign out</button></form>
    </header>
    ${flash(url)}
    <section class="card">
      <div class="row-actions" style="justify-content:space-between">
        <div><a class="mono" href="${escapeHtml(shortOrigin(env, url))}/${encodeURIComponent(slug)}">${escapeHtml(shortOrigin(env, url).replace(/^https?:\/\//, ''))}/${escapeHtml(slug)}</a>
          <div style="color:var(--ink-2);margin-top:4px">&rarr; <a href="${escapeHtml(link.target_url)}" rel="noreferrer noopener">${escapeHtml(link.target_url)}</a></div></div>
        <div>${statusPill(status)}</div>
      </div>
    </section>
    ${filterRow(base, days, RANGES)}
    <section class="card"><div class="hero">
      <div class="figure"><div class="value">${fmt(link.click_count)}</div>
        <div class="label">clicks all time${link.max_clicks ? ` of ${fmt(link.max_clicks)} allowed` : ''}</div></div>
      <div class="plot">${columnChart(series)}</div>
    </div>
    <details class="tableview"><summary>Table view</summary><div class="scroll">
      <table><thead><tr><th>Day</th><th class="num">Clicks</th></tr></thead><tbody>
      ${series.slice().reverse().map((point) => `<tr><td>${escapeHtml(dayLabel(point.day))}</td><td class="num">${fmt(point.value)}</td></tr>`).join('')}
      </tbody></table></div></details>
    </section>
    <div class="tiles">
      <div class="tile"><div class="label">Clicks (${days}d)</div><div class="value">${fmt(rangeTotal)}</div></div>
      <div class="tile"><div class="label">Top country</div>
        <div class="value" style="font-size:20px">${topCountry ? `${flagFor(topCountry.country)} ${escapeHtml(countryName(topCountry.country))}` : '&mdash;'}</div>
        <div class="note">${topCountry ? `${fmt(topCountry.n)} clicks` : 'no data yet'}</div></div>
      <div class="tile"><div class="label">Created</div><div class="value" style="font-size:20px">${escapeHtml(utc(link.created_at).slice(0, 10))}</div>
        <div class="note">${link.expires_at ? `expires ${escapeHtml(utc(link.expires_at))}` : 'no expiry'}</div></div>
      <div class="tile"><div class="label">Sent to fallback</div><div class="value">${fmt(missed)}</div>
        <div class="note">expired, capped or disabled</div></div>
    </div>
    <div class="two">
      <section class="card"><h2>Top countries</h2><p class="sub">Last ${days} days, all hits.</p>
        ${barRows(countryRows, { emptyText: 'No clicks in this range yet.' })}</section>
      <section class="card"><h2>Device split</h2><p class="sub">Parsed from the user-agent.</p>
        ${stackedBar(deviceSegments)}</section>
    </div>
    <div class="two">
      <section class="card"><h2>Referrers</h2><p class="sub">Where the click came from.</p>
        ${barRows(referrers.results.map((row) => ({ value: row.n, label: refererLabel(row.referer) })), { emptyText: 'No referrers recorded yet.' })}</section>
      <section class="card"><h2>QR code</h2><p class="sub">Encodes the short link, so scans are counted too.</p>
        <div class="qr-panel">
          <img src="/qr/${encodeURIComponent(slug)}?size=296" alt="QR code for ${escapeHtml(slug)}" width="148" height="148">
          <div><p class="sub" style="margin-top:0">Download for print:</p>
            <p class="row-actions"><a href="/qr/${encodeURIComponent(slug)}?size=1024&amp;download=1">1024px</a>
            <a href="/qr/${encodeURIComponent(slug)}?size=2048&amp;download=1">2048px</a>
            <a href="/qr/${encodeURIComponent(slug)}?size=2048&amp;ecc=H&amp;download=1">2048px, high error correction</a></p>
            <p class="sub">Editing the destination keeps printed codes working.</p></div>
        </div></section>
    </div>
    <section class="card"><h2>Recent clicks</h2><p class="sub">Last 25, newest first.</p>
      <div class="scroll"><table>
        <thead><tr><th>When</th><th>Where</th><th>Device</th><th>Referrer</th><th>Result</th></tr></thead>
        <tbody>${recent.results.map((row) => `<tr>
          <td class="mono">${escapeHtml(utc(row.ts))}</td>
          <td>${flagFor(row.country)} ${escapeHtml([row.city, countryName(row.country)].filter(Boolean).join(', '))}</td>
          <td>${escapeHtml(row.device || 'unknown')}</td>
          <td>${escapeHtml(refererLabel(row.referer))}</td>
          <td>${escapeHtml(row.outcome)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No clicks yet.</td></tr>'}
        </tbody></table></div>
    </section>
    <section class="card"><h2>Edit</h2><p class="sub">Clearing a field removes that limit.</p>
      ${linkForm({ action: `${base}/update`, submit: 'Save changes', link, hideSlug: true })}
      <div class="row-actions" style="margin-top:18px">
        <form method="post" action="${base}/toggle"><button class="ghost" type="submit">${link.disabled ? 'Enable' : 'Disable'}</button></form>
        <form method="post" action="${base}/reset"><button class="ghost" type="submit">Reset click counter</button></form>
        <form method="post" action="${base}/delete"
          onsubmit="return confirm('Delete /${escapeHtml(slug)} and its ${fmt(link.click_count)} logged clicks? The short link stops working immediately.')">
          <button class="danger" type="submit">Delete link</button></form>
      </div>
      <p class="sub" style="margin-top:10px">Resetting the counter re-opens a capped link; the click history is kept.</p>
    </section>
  </div>`
  return html(layout(`/${slug}`, body))
}

// ------------------------------------------------------------------ forms

function linkForm ({ action, submit, link = {}, hideSlug = false }) {
  return `<form class="grid" method="post" action="${action}">
    ${hideSlug ? '' : `<label class="field"><span>Back-half (optional)</span>
      <input type="text" name="slug" placeholder="random" pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>`}
    <label class="field"${hideSlug ? ' style="grid-column:1/-1"' : ''}><span>Destination URL</span>
      <input type="text" name="url" required value="${escapeHtml(link.target_url || '')}" placeholder="https://example.com/somewhere"></label>
    <label class="field"><span>Expires (UTC, optional)</span>
      <input type="text" name="expiresAt" value="${escapeHtml(forInput(link.expires_at))}" placeholder="7d or 2026-09-30T17:00">
      <p class="hint">Relative (7d, 12h) or absolute.</p></label>
    <label class="field"><span>Click cap (optional)</span>
      <input type="number" name="maxClicks" min="1" step="1" value="${link.max_clicks || ''}" placeholder="none"></label>
    <label class="field"><span>Fallback URL (optional)</span>
      <input type="text" name="fallbackUrl" value="${escapeHtml(link.fallback_url || '')}" placeholder="uses FALLBACK_URL">
      <p class="hint">Used once expired or capped.</p></label>
    <label class="field"><span>Note (optional)</span>
      <input type="text" name="note" maxlength="200" value="${escapeHtml(link.note || '')}" placeholder="what this is for"></label>
    <div class="actions"><button type="submit">${escapeHtml(submit)}</button></div>
  </form>`
}

const formValues = (form) => ({
  slug: form.get('slug'),
  url: form.get('url'),
  expiresAt: form.get('expiresAt'),
  maxClicks: form.get('maxClicks'),
  fallbackUrl: form.get('fallbackUrl'),
  note: form.get('note')
})

async function createFromForm (request, env, url) {
  const form = await request.formData()
  try {
    const link = await createLink(env, formValues(form))
    return withFlash(`/admin/l/${encodeURIComponent(link.slug)}`, 'ok', `Created ${shortOrigin(env, url).replace(/^https?:\/\//, '')}/${link.slug}`)
  } catch (err) {
    if (!(err instanceof HttpError)) throw err
    return withFlash('/admin', 'err', err.message)
  }
}

async function mutate (action, slug, request, env, url) {
  const base = `/admin/l/${encodeURIComponent(slug)}`
  try {
    if (action === 'delete') {
      await deleteLink(env, slug, url.origin)
      return withFlash('/admin', 'ok', `Deleted /${slug} and its click history.`)
    }
    if (action === 'toggle') {
      const current = await getLink(env, slug)
      if (!current) throw new HttpError(404, `/${slug} does not exist.`)
      await updateLink(env, slug, { disabled: !current.disabled })
      return withFlash(base, 'ok', current.disabled ? `/${slug} is live again.` : `/${slug} now goes to the fallback.`)
    }
    if (action === 'reset') {
      await updateLink(env, slug, { resetClicks: true })
      return withFlash(base, 'ok', `Click counter for /${slug} reset to zero.`)
    }
    const form = await request.formData()
    const { slug: _ignored, ...patch } = formValues(form)
    await updateLink(env, slug, patch)
    return withFlash(base, 'ok', `Saved. Changes reach every location within about a minute.`)
  } catch (err) {
    if (!(err instanceof HttpError)) throw err
    return withFlash(base, 'err', err.message)
  }
}
