/**
 * Timezone helpers built on Intl, so there is no date library to keep current.
 *
 * The whole app stores instants as ISO-8601 UTC strings and converts to the
 * owner's IANA timezone only at the edges (availability generation, display).
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday .. 6 = Saturday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const weekdayIndex = WEEKDAYS.indexOf(map.weekday as (typeof WEEKDAYS)[number]);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayIndex === -1 ? 0 : weekdayIndex,
  };
}

/** Milliseconds to add to UTC to get local wall-clock time in `timeZone`. */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = getZonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

/**
 * Turn a wall-clock time in `timeZone` into the UTC instant it names.
 *
 * Around a DST transition a wall-clock time can name two instants or none, so
 * both candidate offsets (the day before and the day after) are tried and the
 * answer is chosen deliberately:
 *
 *   - ambiguous (clocks went back, the hour repeats) -> the earlier instant;
 *   - nonexistent (clocks went forward, the hour is skipped) -> shifted
 *     forward by the size of the gap.
 *
 * This matches the "compatible" disambiguation that Temporal and the tzdata
 * ecosystem use. `zonedTimeExists` is what callers use to skip the gap.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetBefore = timeZoneOffsetMs(new Date(naive - 86_400_000), timeZone);
  const offsetAfter = timeZoneOffsetMs(new Date(naive + 86_400_000), timeZone);

  const candidates = offsetBefore === offsetAfter ? [offsetBefore] : [offsetBefore, offsetAfter];
  const valid: number[] = [];
  for (const offset of candidates) {
    const instant = naive - offset;
    if (timeZoneOffsetMs(new Date(instant), timeZone) === offset) valid.push(instant);
  }

  // No candidate round-trips: the wall-clock time was skipped by a transition.
  // Falling back to the pre-transition offset shifts it forward past the gap.
  return new Date(valid.length > 0 ? Math.min(...valid) : naive - offsetBefore);
}

/**
 * True when the wall-clock time actually exists in that zone. The hour skipped
 * by a spring-forward transition does not, and we must not offer it as a slot.
 */
export function zonedTimeExists(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): boolean {
  const instant = zonedTimeToUtc(year, month, day, hour, minute, timeZone);
  const roundTrip = getZonedParts(instant, timeZone);
  return (
    roundTrip.year === year &&
    roundTrip.month === month &&
    roundTrip.day === day &&
    roundTrip.hour === hour &&
    roundTrip.minute === minute
  );
}

/** "YYYY-MM-DD" for an instant, as seen in `timeZone`. */
export function isoDateInZone(instant: Date, timeZone: string): string {
  const parts = getZonedParts(instant, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

/** Parse "YYYY-MM-DD". Returns null on anything malformed. */
export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject dates like 2026-02-31 that survive the range check above.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function pad(value: number, width: number): string {
  return String(Math.abs(value)).padStart(width, "0");
}

export function minutesToHhMm(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${pad(hours, 2)}:${pad(minutes % 60, 2)}`;
}

/** "09:30" -> 570. Returns null if it is not a valid time of day. */
export function hhMmToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return total > 1440 ? null : total;
}

export function formatInZone(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(instant);
}

export function formatSlotLabel(instant: Date, timeZone: string): string {
  return formatInZone(instant, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function formatDateLabel(instant: Date, timeZone: string): string {
  return formatInZone(instant, timeZone, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDateTimeLabel(instant: Date, timeZone: string): string {
  return `${formatDateLabel(instant, timeZone)}, ${formatSlotLabel(instant, timeZone)}`;
}

/** The viewer's own timezone, for the "times shown in ..." hint. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
