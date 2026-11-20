/** One HTTP check, plus the parsing and validation of monitor settings. */

export const LIMITS = {
  intervalMin: 30,
  intervalMax: 86400,
  timeoutMin: 1,
  timeoutMax: 60,
  thresholdMax: 10,
};

/** "200-299,301,404" -> [[200,299],[301,301],[404,404]], or null if malformed. */
export function parseExpected(raw) {
  const text = String(raw ?? '').replace(/\s+/g, '');
  if (!text) return null;
  const ranges = [];
  for (const part of text.split(',')) {
    const m = part.match(/^(\d{3})(?:-(\d{3}))?$/);
    if (!m) return null;
    const lo = Number(m[1]);
    const hi = Number(m[2] ?? m[1]);
    if (lo < 100 || hi > 599 || lo > hi) return null;
    ranges.push([lo, hi]);
  }
  return ranges;
}

export function statusMatches(status, expected) {
  const ranges = typeof expected === 'string' ? parseExpected(expected) : expected;
  return Boolean(ranges && ranges.some(([lo, hi]) => status >= lo && status <= hi));
}

/** Parses a whole number in [min, max]; on failure records a message in errors[key] and returns null. */
export function intField(raw, { min, max, label, errors, key }) {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) {
    errors[key] = `${label} must be a whole number.`;
    return null;
  }
  const n = Number(text);
  if (n < min || n > max) {
    errors[key] = `${label} must be between ${min} and ${max}.`;
    return null;
  }
  return n;
}

/**
 * Validates the monitor form. Returns { values, errors }; errors is keyed by
 * field name so the form can show each message next to its input.
 */
export function validateMonitor(input) {
  const errors = {};
  const name = String(input.name ?? '').trim();
  if (!name) errors.name = 'Give the monitor a name.';
  else if (name.length > 100) errors.name = 'Keep the name under 100 characters.';

  const rawUrl = String(input.url ?? '').trim();
  let url = '';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
    if (parsed.username || parsed.password) throw new Error('credentials');
    url = parsed.href;
  } catch {
    errors.url = 'Enter a full http:// or https:// URL without credentials.';
  }
  if (url.length > 2000) errors.url = 'That URL is too long.';

  const interval_s = intField(input.interval_s, { min: LIMITS.intervalMin, max: LIMITS.intervalMax, label: 'Interval', errors, key: 'interval_s' });
  const timeout_s = intField(input.timeout_s, { min: LIMITS.timeoutMin, max: LIMITS.timeoutMax, label: 'Timeout', errors, key: 'timeout_s' });
  if (interval_s !== null && timeout_s !== null && timeout_s >= interval_s) {
    errors.timeout_s = 'Timeout must be shorter than the interval.';
  }

  const expected = String(input.expected ?? '').replace(/\s+/g, '');
  if (!parseExpected(expected)) errors.expected = 'Use status codes or ranges, e.g. 200-299 or 200,301.';

  const down_after = intField(input.down_after, { min: 1, max: LIMITS.thresholdMax, label: 'Failures before down', errors, key: 'down_after' });
  const up_after = intField(input.up_after, { min: 1, max: LIMITS.thresholdMax, label: 'Successes before up', errors, key: 'up_after' });

  return { values: { name, url, interval_s, timeout_s, expected, down_after, up_after }, errors };
}

function describeError(err, timeoutMs) {
  if (err?.name === 'TimeoutError') return `timeout after ${timeoutMs / 1000}s`;
  const cause = err?.cause;
  if (cause?.code && !String(cause.message || '').includes(cause.code)) return `${cause.code}: ${cause.message}`.slice(0, 300);
  return String(cause?.message || err?.message || err || 'request failed').slice(0, 300);
}

/**
 * Runs one GET against the monitor's URL. Never throws: returns
 * { ok, status, latencyMs, error }. `signalFor` is injectable so tests can
 * trigger a timeout without waiting for one.
 */
export async function runHttpCheck(monitor, { fetchImpl = fetch, now = Date.now, signalFor = (ms) => AbortSignal.timeout(ms) } = {}) {
  const timeoutMs = monitor.timeout_s * 1000;
  const started = now();
  try {
    const res = await fetchImpl(monitor.url, {
      method: 'GET',
      redirect: 'follow',
      signal: signalFor(timeoutMs),
      headers: { 'user-agent': 'vibe-uptime/1.0 (+https://github.com/alifa20/vibe)' },
    });
    // The body is not needed; release the connection.
    await res.body?.cancel().catch(() => {});
    const latencyMs = Math.max(0, now() - started);
    if (statusMatches(res.status, monitor.expected)) return { ok: true, status: res.status, latencyMs, error: null };
    return { ok: false, status: res.status, latencyMs, error: `HTTP ${res.status}, expected ${monitor.expected}` };
  } catch (err) {
    return { ok: false, status: null, latencyMs: Math.max(0, now() - started), error: describeError(err, timeoutMs) };
  }
}
