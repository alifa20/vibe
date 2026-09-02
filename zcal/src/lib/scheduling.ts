import type { Db } from "./db";
import {
  computeSlots,
  groupSlotsByLocalDate,
  type BusyInterval,
  type Slot,
  type SlotQuery,
} from "./availability";
import {
  getEventTypeBySlug,
  getSettings,
  insertBooking,
  listAvailabilityRules,
  listCalendarEvents,
  type Booking,
  type EventType,
} from "./repo";
import { DAY_MS, MINUTE_MS } from "./time";

/**
 * The middle of the core loop: turn the calendar plus the weekly rules into a
 * list of free slots, and turn a chosen slot into a booking.
 */

export const MAX_QUERY_DAYS = 62;

export function buildSlotQuery(
  db: Db,
  eventType: EventType,
  rangeStart: Date,
  rangeEnd: Date,
  nowInstant = new Date(),
): SlotQuery {
  const settings = getSettings(db);
  // Widen the calendar read by the buffers so an event just outside the window
  // still blocks a slot at the edge of it.
  const padding =
    Math.max(eventType.bufferBeforeMinutes, eventType.bufferAfterMinutes) * MINUTE_MS + DAY_MS;
  const events = listCalendarEvents(
    db,
    new Date(rangeStart.getTime() - padding),
    new Date(rangeEnd.getTime() + padding),
  );
  const busy: BusyInterval[] = events
    .filter((event) => event.busy)
    .map((event) => ({
      start: Date.parse(event.startsAt),
      end: Date.parse(event.endsAt),
    }));

  return {
    rules: {
      durationMinutes: eventType.durationMinutes,
      slotIntervalMinutes: eventType.slotIntervalMinutes,
      bufferBeforeMinutes: eventType.bufferBeforeMinutes,
      bufferAfterMinutes: eventType.bufferAfterMinutes,
      minNoticeMinutes: eventType.minNoticeMinutes,
      maxDaysAhead: eventType.maxDaysAhead,
    },
    weekly: listAvailabilityRules(db).map((rule) => ({
      weekday: rule.weekday,
      startMinute: rule.startMinute,
      endMinute: rule.endMinute,
    })),
    busy,
    timeZone: settings.timeZone,
    rangeStart,
    rangeEnd,
    now: nowInstant,
  };
}

export interface AvailabilityResponse {
  eventType: {
    slug: string;
    title: string;
    description: string;
    location: string;
    durationMinutes: number;
  };
  timeZone: string;
  ownerName: string;
  rangeStart: string;
  rangeEnd: string;
  slots: Slot[];
  days: { date: string; slots: Slot[] }[];
  /** Why there is nothing to show, when there is nothing to show. */
  emptyReason: "no_working_hours" | "fully_booked" | "outside_window" | null;
}

export function getAvailability(
  db: Db,
  eventType: EventType,
  rangeStart: Date,
  rangeEnd: Date,
  nowInstant = new Date(),
): AvailabilityResponse {
  const query = buildSlotQuery(db, eventType, rangeStart, rangeEnd, nowInstant);
  const slots = computeSlots(query);
  const settings = getSettings(db);

  let emptyReason: AvailabilityResponse["emptyReason"] = null;
  if (slots.length === 0) {
    if (query.weekly.length === 0) {
      emptyReason = "no_working_hours";
    } else if (
      rangeStart.getTime() > nowInstant.getTime() + eventType.maxDaysAhead * DAY_MS ||
      rangeEnd.getTime() < nowInstant.getTime()
    ) {
      emptyReason = "outside_window";
    } else {
      // There were working hours in range, so something is occupying them.
      const withoutBusy = computeSlots({ ...query, busy: [] });
      emptyReason = withoutBusy.length > 0 ? "fully_booked" : "outside_window";
    }
  }

  return {
    eventType: {
      slug: eventType.slug,
      title: eventType.title,
      description: eventType.description,
      location: eventType.location,
      durationMinutes: eventType.durationMinutes,
    },
    timeZone: settings.timeZone,
    ownerName: settings.ownerName,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    slots,
    days: groupSlotsByLocalDate(slots, settings.timeZone),
    emptyReason,
  };
}

export type ReserveFailure =
  | "unknown_link"
  | "link_inactive"
  | "slot_unavailable"
  | "already_booked";

export type ReserveResult =
  | { ok: true; booking: Booking; eventType: EventType }
  | { ok: false; reason: ReserveFailure; message: string };

export interface ReserveInput {
  slug: string;
  startsAt: string;
  name: string;
  email: string;
  notes: string;
}

const FAILURE_MESSAGES: Record<ReserveFailure, string> = {
  unknown_link: "That booking link does not exist.",
  link_inactive: "That booking link is not accepting bookings right now.",
  slot_unavailable:
    "That time is no longer free. Pick another slot — the list has been refreshed.",
  already_booked: "That time has just been taken. Pick another slot.",
};

/**
 * Reserve a slot and write the event back to the calendar.
 *
 * Availability is recomputed here from the database rather than trusted from
 * the request, so a stale or hand-edited slot cannot be booked.
 *
 * Concurrency: this is a check-then-write, and it is not serialised against
 * other in-flight bookings. A UNIQUE index catches two people taking the exact
 * same slot on the same link; overlapping bookings on *different* links can
 * still both succeed if they arrive in the same instant. See the README.
 */
export function reserveSlot(db: Db, input: ReserveInput, nowInstant = new Date()): ReserveResult {
  const eventType = getEventTypeBySlug(db, input.slug);
  if (!eventType) return fail("unknown_link");
  if (!eventType.isActive) return fail("link_inactive");

  const start = new Date(input.startsAt);
  if (Number.isNaN(start.getTime())) return fail("slot_unavailable");
  const end = new Date(start.getTime() + eventType.durationMinutes * MINUTE_MS);

  // Recompute a tight window around the requested slot and insist it is in it.
  const query = buildSlotQuery(
    db,
    eventType,
    new Date(start.getTime() - MINUTE_MS),
    new Date(end.getTime() + MINUTE_MS),
    nowInstant,
  );
  const available = computeSlots(query).some((slot) => slot.startsAt === start.toISOString());
  if (!available) return fail("slot_unavailable");

  try {
    const booking = insertBooking(db, {
      eventType,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      inviteeName: input.name,
      inviteeEmail: input.email,
      notes: input.notes,
    });
    return { ok: true, booking, eventType };
  } catch (error) {
    if (isUniqueViolation(error)) return fail("already_booked");
    throw error;
  }
}

function fail(reason: ReserveFailure): ReserveResult {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code: unknown }).code).startsWith("SQLITE_CONSTRAINT")
  );
}

export { MINUTE_MS, DAY_MS };
