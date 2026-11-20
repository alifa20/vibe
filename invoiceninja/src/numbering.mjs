/**
 * Invoice numbers and the calendar they live in. A number is drawn from the
 * `counters` table, one row per year. Callers must run nextNumber inside a
 * `BEGIN IMMEDIATE` transaction together with the write that uses the number,
 * so a failure rolls the counter back and the sequence never has a gap.
 */

export function formatNumber(year, seq) {
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

function parts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(ms, timeZone) {
  const p = parts(ms, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localYear(ms, timeZone) {
  return Number(parts(ms, timeZone).year);
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return typeof tz === 'string' && tz.length > 0;
  } catch {
    return false;
  }
}

/** Takes the next number for a year. Must run inside an immediate transaction. */
export function nextNumber(db, year) {
  if (!db.inTransaction) throw new Error('nextNumber must run inside a transaction');
  const { value } = db
    .prepare(
      `INSERT INTO counters (year, value) VALUES (?, 1)
       ON CONFLICT(year) DO UPDATE SET value = value + 1
       RETURNING value`
    )
    .get(year);
  return formatNumber(year, value);
}
