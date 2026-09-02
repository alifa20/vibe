/**
 * Server-rendered charts: inline SVG and plain HTML, no client library.
 *
 * House rules followed here: one series per chart unless identity is the
 * point, marks capped at 24px with a 4px rounded data-end, hairline solid
 * gridlines, values direct-labelled selectively (the peak, not every column),
 * text in text tokens rather than the series colour, and a table view beside
 * every chart so no value is reachable only by hovering.
 */
import { escapeHtml } from './util.js'

export const fmt = (n) => Number(n || 0).toLocaleString('en-US')

export function compact (n) {
  const value = Number(n || 0)
  if (value < 1000) return String(value)
  if (value < 1e6) return `${(value / 1e3).toFixed(value < 1e4 ? 1 : 0).replace(/\.0$/, '')}K`
  return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`
}

/** "2026-08-30" -> "Aug 30" (the day keys are UTC, so read them back as UTC). */
export const dayLabel = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function niceMax (value) {
  if (value <= 4) return Math.max(1, value)
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5]) {
    if (value <= step * power) return Math.ceil(step * power)
  }
  return 10 * power
}

const round = (n) => Math.round(n * 100) / 100

/** Column with a rounded cap and a square foot on the baseline. */
function columnPath (x, y, width, height, radius = 4) {
  const r = Math.min(radius, width / 2, height)
  const [x0, y0, w, h] = [round(x), round(y), round(width), round(height)]
  return `M${x0} ${round(y0 + h)}V${round(y0 + r)}Q${x0} ${y0} ${round(x0 + r)} ${y0}H${round(x0 + w - r)}Q${round(x0 + w)} ${y0} ${round(x0 + w)} ${round(y0 + r)}V${round(y0 + h)}Z`
}

const empty = (message) => `<p class="empty">${escapeHtml(message)}</p>`

/**
 * Daily clicks. One series, so no legend - the caption says what is plotted.
 * @param {{day: string, value: number}[]} points
 */
export function columnChart (points, { unit = 'clicks', emptyText = 'No clicks in this range yet.' } = {}) {
  const total = points.reduce((sum, point) => sum + point.value, 0)
  if (!points.length || total === 0) return empty(emptyText)

  const [width, plotHeight, padLeft, padRight, padTop, axisBand] = [720, 170, 46, 12, 18, 26]
  const height = padTop + plotHeight + axisBand
  const innerWidth = width - padLeft - padRight
  const max = niceMax(Math.max(...points.map((p) => p.value)))
  const band = innerWidth / points.length
  const barWidth = Math.min(24, Math.max(3, band - 6))
  const yOf = (value) => padTop + plotHeight - (value / max) * plotHeight
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0])

  const gridlines = [0, 0.5, 1]
    .map((ratio) => {
      const value = max * ratio
      const y = round(yOf(value))
      return `<line class="grid" x1="${padLeft}" x2="${width - padRight}" y1="${y}" y2="${y}"/>` +
        `<text class="tick" x="${padLeft - 8}" y="${y + 4}" text-anchor="end">${compact(Math.round(value))}</text>`
    })
    .join('')

  const every = Math.max(1, Math.ceil(points.length / 6))
  const columns = points
    .map((point, index) => {
      const x = padLeft + band * index + (band - barWidth) / 2
      const barHeight = point.value === 0 ? 0 : Math.max(2, (point.value / max) * plotHeight)
      const bar = point.value === 0
        ? ''
        : `<path class="col" d="${columnPath(x, yOf(point.value), barWidth, barHeight)}"/>`
      const tick = index % every === 0 || index === points.length - 1
        ? `<text class="tick" x="${round(padLeft + band * index + band / 2)}" y="${padTop + plotHeight + 18}" text-anchor="middle">${escapeHtml(dayLabel(point.day))}</text>`
        : ''
      // A full-band transparent rect keeps the hover target generous even when
      // the column itself is 3px wide.
      return `<g><title>${escapeHtml(dayLabel(point.day))}: ${fmt(point.value)} ${unit}</title>` +
        `<rect class="hit" x="${round(padLeft + band * index)}" y="${padTop}" width="${round(band)}" height="${plotHeight}"/>${bar}</g>${tick}`
    })
    .join('')

  const peakLabel = peak.value > 0
    ? `<text class="value" x="${round(padLeft + band * points.indexOf(peak) + band / 2)}" y="${round(yOf(peak.value) - 7)}" text-anchor="middle">${fmt(peak.value)}</text>`
    : ''

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily ${unit}, ${fmt(total)} in total, peaking at ${fmt(peak.value)} on ${dayLabel(peak.day)}">` +
    `${gridlines}<line class="axis" x1="${padLeft}" x2="${width - padRight}" y1="${padTop + plotHeight}" y2="${padTop + plotHeight}"/>${columns}${peakLabel}</svg>`
}

/** 14-day trend for a table row: past days recede, today carries the accent. */
export function sparkline (points, { unit = 'clicks' } = {}) {
  const total = points.reduce((sum, point) => sum + point.value, 0)
  if (!total) return '<span class="spark-empty" aria-hidden="true">&mdash;</span>'
  const [width, height] = [104, 30]
  const max = Math.max(...points.map((p) => p.value))
  const band = width / points.length
  const barWidth = Math.max(2, band - 2)
  const columns = points
    .map((point, index) => {
      if (!point.value) return ''
      const barHeight = Math.max(2, (point.value / max) * (height - 2))
      const klass = index === points.length - 1 ? 'spark spark-now' : 'spark'
      return `<path class="${klass}" d="${columnPath(band * index + (band - barWidth) / 2, height - barHeight, barWidth, barHeight, 2)}"/>`
    })
    .join('')
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${fmt(total)} ${unit} over the last ${points.length} days">` +
    `<title>${fmt(total)} ${unit} over the last ${points.length} days</title>${columns}</svg>`
}

/**
 * Ranked bars for nominal categories (countries, referrers). Every bar is the
 * same hue - length already encodes the value - and every value is printed, so
 * this doubles as the table view.
 */
export function barRows (rows, { emptyText = 'Nothing recorded yet.', total = 0 } = {}) {
  if (!rows.length) return empty(emptyText)
  const max = Math.max(...rows.map((row) => row.value))
  const sum = total || rows.reduce((acc, row) => acc + row.value, 0)
  return `<table class="bars"><tbody>${rows.map((row) => `<tr>` +
    `<th scope="row">${row.html || escapeHtml(row.label)}</th>` +
    `<td class="bar-cell"><span class="bar" style="width:${round((row.value / max) * 100)}%"></span></td>` +
    `<td class="num">${fmt(row.value)}</td>` +
    `<td class="num pct">${sum ? round((row.value / sum) * 100).toFixed(1) : '0.0'}%</td>` +
    `</tr>`).join('')}</tbody></table>`
}

/**
 * Part-to-whole across at most five fixed categories. Segments are separated
 * by a 2px surface gap rather than a border, and the legend carries the label
 * and the number so identity never rests on colour alone.
 */
export function stackedBar (segments, { emptyText = 'No clicks yet.' } = {}) {
  const live = segments.filter((segment) => segment.value > 0)
  const total = live.reduce((sum, segment) => sum + segment.value, 0)
  if (!total) return empty(emptyText)
  const bar = live
    .map((segment) => `<span class="seg" style="flex-grow:${segment.value};background:var(--series-${segment.slot})" title="${escapeHtml(segment.label)}: ${fmt(segment.value)}"></span>`)
    .join('')
  const legend = live
    .map((segment) => `<li><span class="swatch" style="background:var(--series-${segment.slot})"></span>` +
      `<span class="legend-label">${escapeHtml(segment.label)}</span>` +
      `<span class="legend-value">${fmt(segment.value)} &middot; ${round((segment.value / total) * 100).toFixed(1)}%</span></li>`)
    .join('')
  return `<div class="stack" role="img" aria-label="${live.map((s) => `${s.label} ${fmt(s.value)}`).join(', ')}">${bar}</div><ul class="legend">${legend}</ul>`
}
