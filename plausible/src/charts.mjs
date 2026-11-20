/**
 * Server-rendered SVG. Geometry and colour classes are plain attributes; the
 * page's Content-Security-Policy allows no inline styles, so nothing here
 * writes a style attribute.
 */
import { escapeHtml } from './views.mjs';

const WIDTH = 720;
const PLOT_HEIGHT = 160;
const AXIS_HEIGHT = 22;
const GAP = 2;

const round = (n) => Math.round(n * 100) / 100;
const nf = new Intl.NumberFormat('en-US');

/** Short label for a UTC day key: "19 Nov". */
export function dayLabel(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Daily pageviews with that day's unique visitors drawn inside each bar.
 * Every day gets a bar; a day with nothing shows a flat stub on the baseline.
 */
export function barChart(series) {
  const peak = Math.max(1, ...series.map((point) => point.pageviews));
  const slot = WIDTH / Math.max(1, series.length);
  const barWidth = Math.max(1, slot - GAP);
  const scale = (value) => (value / peak) * PLOT_HEIGHT;

  const bars = series.map((point, index) => {
    const x = round(index * slot + GAP / 2);
    const attrs = `data-day="${escapeHtml(point.day)}" data-pageviews="${point.pageviews}" data-visitors="${point.visitors}"`;
    if (!point.pageviews) {
      return `<rect class="bar pv zero" ${attrs} x="${x}" y="${PLOT_HEIGHT - 2}" width="${round(barWidth)}" height="2"/>`;
    }
    const pvHeight = Math.max(2, scale(point.pageviews));
    const uvHeight = Math.max(2, scale(point.visitors));
    const inset = barWidth > 6 ? barWidth * 0.2 : 0;
    return `<rect class="bar pv" ${attrs} x="${x}" y="${round(PLOT_HEIGHT - pvHeight)}" width="${round(barWidth)}" height="${round(pvHeight)}" rx="2"/>` +
      `<rect class="bar uv" x="${round(x + inset)}" y="${round(PLOT_HEIGHT - uvHeight)}" width="${round(barWidth - inset * 2)}" height="${round(uvHeight)}" rx="2"/>`;
  }).join('');

  const first = series[0]?.day;
  const last = series.at(-1)?.day;
  const axisY = PLOT_HEIGHT + 16;
  const labels = [
    first ? `<text class="axis" x="0" y="${axisY}" text-anchor="start">${escapeHtml(dayLabel(first))}</text>` : '',
    last && last !== first ? `<text class="axis" x="${WIDTH}" y="${axisY}" text-anchor="end">${escapeHtml(dayLabel(last))}</text>` : '',
    `<text class="axis" x="${WIDTH / 2}" y="${axisY}" text-anchor="middle">peak ${nf.format(Math.max(0, ...series.map((p) => p.pageviews)))}</text>`
  ].join('');

  return `<svg class="chart" viewBox="0 0 ${WIDTH} ${PLOT_HEIGHT + AXIS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">` +
    `<line class="baseline" x1="0" y1="${PLOT_HEIGHT}" x2="${WIDTH}" y2="${PLOT_HEIGHT}"/>` +
    bars + labels + '</svg>';
}
