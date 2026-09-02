import { isValidTimeZone, zonedTimeToUtc } from "./time";

/**
 * A small, dependency-free iCalendar reader and writer.
 *
 * It covers what this app actually needs: single, non-recurring VEVENTs with
 * a start and an end. Recurrence rules are deliberately not expanded — see
 * "Limitations" in the README.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  description: string;
  location: string;
  /** ISO-8601 UTC. */
  startsAt: string;
  endsAt: string;
}

export interface IcsParseResult {
  events: IcsEvent[];
  /** Human-readable reasons individual VEVENTs were skipped. */
  skipped: string[];
}

const MAX_ICS_BYTES = 5 * 1024 * 1024;

/** Undo RFC 5545 line folding: a CRLF followed by a space or tab is a join. */
function unfold(raw: string): string[] {
  return raw.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function unescapeText(value: string): string {
  // Single pass, so an escaped backslash is not re-read as an escape.
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" && index + 1 < value.length) {
      const next = value[index + 1]!;
      index += 1;
      out += next === "n" || next === "N" ? "\n" : next;
    } else {
      out += char;
    }
  }
  return out;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

interface ParsedLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): ParsedLine | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segments = head.split(";");
  const name = (segments[0] ?? "").toUpperCase();
  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    params[segment.slice(0, eq).toUpperCase()] = segment.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

/**
 * Resolve an iCalendar date-time to a UTC instant.
 *
 * Handles the three forms that appear in real feeds: UTC ("...Z"), a floating
 * or TZID-qualified local time, and a date-only value for all-day events.
 * `fallbackTimeZone` interprets floating times, per RFC 5545's advice to treat
 * them as local to the reader.
 */
export function parseIcsDate(
  value: string,
  params: Record<string, string>,
  fallbackTimeZone: string,
): { instant: Date; allDay: boolean } | null {
  const raw = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const zone = params.TZID && isValidTimeZone(params.TZID) ? params.TZID : fallbackTimeZone;
    return { instant: zonedTimeToUtc(year, month, day, 0, 0, zone), allDay: true };
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (!dateTime) return null;
  const year = Number(dateTime[1]);
  const month = Number(dateTime[2]);
  const day = Number(dateTime[3]);
  const hour = Number(dateTime[4]);
  const minute = Number(dateTime[5]);
  const second = Number(dateTime[6]);
  if (dateTime[7] === "Z") {
    return { instant: new Date(Date.UTC(year, month - 1, day, hour, minute, second)), allDay: false };
  }
  const zone = params.TZID && isValidTimeZone(params.TZID) ? params.TZID : fallbackTimeZone;
  return { instant: zonedTimeToUtc(year, month, day, hour, minute, zone), allDay: false };
}

export function parseIcs(raw: string, fallbackTimeZone: string): IcsParseResult {
  if (raw.length > MAX_ICS_BYTES) {
    return { events: [], skipped: ["Calendar file is larger than 5 MB and was not read."] };
  }

  const lines = unfold(raw);
  const events: IcsEvent[] = [];
  const skipped: string[] = [];

  let current: Record<string, ParsedLine> | null = null;
  let depth = 0;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;

    if (parsed.name === "BEGIN" && parsed.value.toUpperCase() === "VEVENT") {
      current = {};
      depth = 0;
      continue;
    }
    if (!current) continue;
    // Ignore nested components such as VALARM.
    if (parsed.name === "BEGIN") {
      depth += 1;
      continue;
    }
    if (parsed.name === "END" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (parsed.name === "END" && parsed.value.toUpperCase() === "VEVENT") {
      const built = buildEvent(current, fallbackTimeZone);
      if ("error" in built) skipped.push(built.error);
      else events.push(built.event);
      current = null;
      continue;
    }
    if (depth === 0) current[parsed.name] = parsed;
  }

  return { events, skipped };
}

function buildEvent(
  fields: Record<string, ParsedLine>,
  fallbackTimeZone: string,
): { event: IcsEvent } | { error: string } {
  const summary = fields.SUMMARY ? unescapeText(fields.SUMMARY.value).trim() : "";
  const label = summary || "(untitled event)";

  if (fields.RRULE) {
    return { error: `"${label}" repeats (RRULE); only its first occurrence would be read, so it was skipped.` };
  }
  const dtStart = fields.DTSTART;
  if (!dtStart) return { error: `"${label}" has no start time.` };

  const start = parseIcsDate(dtStart.value, dtStart.params, fallbackTimeZone);
  if (!start) return { error: `"${label}" has an unreadable start time.` };

  let end: Date | null = null;
  const dtEnd = fields.DTEND;
  if (dtEnd) {
    const parsedEnd = parseIcsDate(dtEnd.value, dtEnd.params, fallbackTimeZone);
    if (parsedEnd) end = parsedEnd.instant;
  } else if (fields.DURATION) {
    const durationMs = parseIcsDuration(fields.DURATION.value);
    if (durationMs !== null) end = new Date(start.instant.getTime() + durationMs);
  }
  if (!end && start.allDay) {
    end = new Date(start.instant.getTime() + 86_400_000);
  }
  if (!end) return { error: `"${label}" has no end time or duration.` };
  if (end.getTime() <= start.instant.getTime()) {
    return { error: `"${label}" ends before it starts.` };
  }

  return {
    event: {
      uid: fields.UID ? fields.UID.value.trim() : "",
      title: summary || "Busy",
      description: fields.DESCRIPTION ? unescapeText(fields.DESCRIPTION.value).trim() : "",
      location: fields.LOCATION ? unescapeText(fields.LOCATION.value).trim() : "",
      startsAt: start.instant.toISOString(),
      endsAt: end.toISOString(),
    },
  };
}

/** RFC 5545 durations, e.g. PT1H30M or P1D. */
export function parseIcsDuration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const weeks = Number(match[2] ?? 0);
  const days = Number(match[3] ?? 0);
  const hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  const seconds = Number(match[6] ?? 0);
  const total =
    weeks * 604_800_000 + days * 86_400_000 + hours * 3_600_000 + minutes * 60_000 + seconds * 1000;
  return total === 0 ? null : sign * total;
}

function formatUtcStamp(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Fold a content line to 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    // Never split a multi-byte character.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(offset, end).toString("utf8"));
    offset = end;
    limit = 74;
  }
  return chunks.join("\r\n ");
}

export interface IcsCalendarOptions {
  calendarName?: string;
  /** Set for a single-event invite so calendar apps offer "add to calendar". */
  method?: "PUBLISH" | "REQUEST";
}

export function buildIcs(events: IcsEvent[], options: IcsCalendarOptions = {}): string {
  const stamp = formatUtcStamp(new Date().toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//zcal//self-hosted scheduling//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${options.method ?? "PUBLISH"}`,
  ];
  if (options.calendarName) {
    lines.push(`X-WR-CALNAME:${escapeText(options.calendarName)}`);
  }
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid || `${crypto.randomUUID()}@zcal.local`}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatUtcStamp(event.startsAt)}`,
      `DTEND:${formatUtcStamp(event.endsAt)}`,
      `SUMMARY:${escapeText(event.title)}`,
    );
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
