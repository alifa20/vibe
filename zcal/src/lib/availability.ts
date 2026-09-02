import { DAY_MS, MINUTE_MS, getZonedParts, zonedTimeExists, zonedTimeToUtc } from "./time";

export interface BusyInterval {
  /** Epoch milliseconds. */
  start: number;
  end: number;
}

export interface WeeklyRule {
  weekday: number; // 0 = Sunday
  startMinute: number; // minutes from local midnight
  endMinute: number;
}

export interface SlotRules {
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
}

export interface SlotQuery {
  rules: SlotRules;
  weekly: WeeklyRule[];
  busy: BusyInterval[];
  timeZone: string;
  /** Window the caller is asking about (usually one day or one week). */
  rangeStart: Date;
  rangeEnd: Date;
  now: Date;
}

export interface Slot {
  /** ISO-8601 UTC. */
  startsAt: string;
  endsAt: string;
}

/** Merge overlapping/adjacent intervals so overlap checks stay cheap and simple. */
export function mergeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const merged: BusyInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

export function overlaps(a: BusyInterval, b: BusyInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Every bookable start time in the window.
 *
 * A candidate survives when all of these hold:
 *   - it sits inside a weekly availability rule, and the whole meeting fits
 *     before that rule ends;
 *   - the wall-clock time actually exists (DST spring-forward gaps are skipped);
 *   - it is at least `minNoticeMinutes` from now, and no further out than
 *     `maxDaysAhead`;
 *   - the meeting plus its buffers does not touch any busy interval.
 *
 * Times are generated from local wall-clock rules and converted per-day, so a
 * "09:00 every weekday" rule stays at 09:00 local across a DST change.
 */
export function computeSlots(query: SlotQuery): Slot[] {
  const { rules, weekly, timeZone, now } = query;
  if (weekly.length === 0) return [];
  if (rules.durationMinutes <= 0 || rules.slotIntervalMinutes <= 0) return [];

  const earliest = Math.max(
    query.rangeStart.getTime(),
    now.getTime() + rules.minNoticeMinutes * MINUTE_MS,
  );
  const latest = Math.min(
    query.rangeEnd.getTime(),
    now.getTime() + rules.maxDaysAhead * DAY_MS,
  );
  if (!(earliest < latest)) return [];

  const busy = mergeIntervals(query.busy);
  const byWeekday = new Map<number, WeeklyRule[]>();
  for (const rule of weekly) {
    if (rule.endMinute <= rule.startMinute) continue;
    const list = byWeekday.get(rule.weekday) ?? [];
    list.push(rule);
    byWeekday.set(rule.weekday, list);
  }

  // Walk local calendar dates. One day of slack on each side covers slots whose
  // local day differs from the UTC day at the window edges.
  const firstDate = civilDayNumber(new Date(earliest - DAY_MS), timeZone);
  const lastDate = civilDayNumber(new Date(latest + DAY_MS), timeZone);

  const slots: Slot[] = [];
  const seen = new Set<number>();

  for (let dayNumber = firstDate; dayNumber <= lastDate; dayNumber += 1) {
    const civil = new Date(dayNumber * DAY_MS);
    const year = civil.getUTCFullYear();
    const month = civil.getUTCMonth() + 1;
    const day = civil.getUTCDate();
    const dayRules = byWeekday.get(civil.getUTCDay());
    if (!dayRules) continue;

    for (const rule of dayRules) {
      const lastStart = rule.endMinute - rules.durationMinutes;
      for (
        let minute = rule.startMinute;
        minute <= lastStart;
        minute += rules.slotIntervalMinutes
      ) {
        const hour = Math.floor(minute / 60);
        const minuteOfHour = minute % 60;
        // 24:00 is a legal rule boundary but never a legal start time.
        if (hour > 23) continue;
        if (!zonedTimeExists(year, month, day, hour, minuteOfHour, timeZone)) continue;

        const start = zonedTimeToUtc(year, month, day, hour, minuteOfHour, timeZone).getTime();
        if (seen.has(start)) continue;

        const end = start + rules.durationMinutes * MINUTE_MS;
        if (start < earliest || end > latest) continue;

        const guarded: BusyInterval = {
          start: start - rules.bufferBeforeMinutes * MINUTE_MS,
          end: end + rules.bufferAfterMinutes * MINUTE_MS,
        };
        if (busy.some((interval) => overlaps(guarded, interval))) continue;

        seen.add(start);
        slots.push({
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
        });
      }
    }
  }

  slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return slots;
}

/**
 * Is this exact slot still bookable? Used at reservation time so the server
 * re-derives availability instead of trusting what the browser sent.
 */
export function isSlotBookable(query: SlotQuery, startsAt: string): boolean {
  return computeSlots(query).some((slot) => slot.startsAt === startsAt);
}

/** Days since the epoch for the local calendar date containing `instant`. */
function civilDayNumber(instant: Date, timeZone: string): number {
  const parts = getZonedParts(instant, timeZone);
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

/** Group slots by their local calendar date, for rendering a day picker. */
export function groupSlotsByLocalDate(
  slots: Slot[],
  timeZone: string,
): { date: string; slots: Slot[] }[] {
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const parts = getZonedParts(new Date(slot.startsAt), timeZone);
    const key = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    const list = groups.get(key) ?? [];
    list.push(slot);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([date, daySlots]) => ({ date, slots: daySlots }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
