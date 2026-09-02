import type { Db } from "./db";
import { randomPublicId, randomToken } from "./auth";
import type { IcsEvent } from "./ics";

/**
 * Every SQL statement in the app lives here. Route handlers and pages call
 * these functions; they never build queries themselves.
 */

export interface Settings {
  ownerName: string;
  ownerEmail: string;
  timeZone: string;
  calendarName: string;
  updatedAt: string;
}

export interface EventType {
  id: number;
  slug: string;
  title: string;
  description: string;
  location: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  slotIntervalMinutes: number;
  isActive: boolean;
  isSample: boolean;
  createdAt: string;
}

export interface AvailabilityRule {
  id: number;
  weekday: number;
  startMinute: number;
  endMinute: number;
  isSample: boolean;
}

export type CalendarEventSource = "local" | "booking" | "ics";

export interface CalendarEvent {
  id: number;
  uid: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  source: CalendarEventSource;
  busy: boolean;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Booking {
  id: number;
  publicId: string;
  eventTypeId: number;
  calendarEventId: number | null;
  inviteeName: string;
  inviteeEmail: string;
  notes: string;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled";
  cancelToken: string;
  isSample: boolean;
  createdAt: string;
  cancelledAt: string | null;
}

const bool = (value: unknown): boolean => value === 1 || value === true;
const flag = (value: boolean): number => (value ? 1 : 0);
const now = (): string => new Date().toISOString();

// --- settings --------------------------------------------------------------

export function getSettings(db: Db): Settings {
  const row = db
    .prepare(
      "SELECT owner_name, owner_email, time_zone, calendar_name, updated_at FROM settings WHERE id = 1",
    )
    .get() as Record<string, string> | undefined;
  return {
    ownerName: row?.owner_name ?? "",
    ownerEmail: row?.owner_email ?? "",
    timeZone: row?.time_zone ?? "UTC",
    calendarName: row?.calendar_name ?? "My calendar",
    updatedAt: row?.updated_at ?? now(),
  };
}

export function updateSettings(
  db: Db,
  input: Pick<Settings, "ownerName" | "ownerEmail" | "timeZone" | "calendarName">,
): Settings {
  db.prepare(
    `UPDATE settings
        SET owner_name = ?, owner_email = ?, time_zone = ?, calendar_name = ?, updated_at = ?
      WHERE id = 1`,
  ).run(input.ownerName, input.ownerEmail, input.timeZone, input.calendarName, now());
  return getSettings(db);
}

// --- event types (booking links) ------------------------------------------

const EVENT_TYPE_COLUMNS = `
  id, slug, title, description, location, duration_minutes, buffer_before_minutes,
  buffer_after_minutes, min_notice_minutes, max_days_ahead, slot_interval_minutes,
  is_active, is_sample, created_at
`;

function toEventType(row: Record<string, unknown>): EventType {
  return {
    id: row.id as number,
    slug: row.slug as string,
    title: row.title as string,
    description: row.description as string,
    location: row.location as string,
    durationMinutes: row.duration_minutes as number,
    bufferBeforeMinutes: row.buffer_before_minutes as number,
    bufferAfterMinutes: row.buffer_after_minutes as number,
    minNoticeMinutes: row.min_notice_minutes as number,
    maxDaysAhead: row.max_days_ahead as number,
    slotIntervalMinutes: row.slot_interval_minutes as number,
    isActive: bool(row.is_active),
    isSample: bool(row.is_sample),
    createdAt: row.created_at as string,
  };
}

export function listEventTypes(db: Db): EventType[] {
  return (
    db.prepare(`SELECT ${EVENT_TYPE_COLUMNS} FROM event_types ORDER BY title`).all() as Record<
      string,
      unknown
    >[]
  ).map(toEventType);
}

export function getEventTypeBySlug(db: Db, slug: string): EventType | null {
  const row = db
    .prepare(`SELECT ${EVENT_TYPE_COLUMNS} FROM event_types WHERE slug = ?`)
    .get(slug) as Record<string, unknown> | undefined;
  return row ? toEventType(row) : null;
}

export function getEventTypeById(db: Db, id: number): EventType | null {
  const row = db.prepare(`SELECT ${EVENT_TYPE_COLUMNS} FROM event_types WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toEventType(row) : null;
}

export type EventTypeInput = Omit<EventType, "id" | "createdAt" | "isSample"> & {
  isSample?: boolean;
};

export function createEventType(db: Db, input: EventTypeInput): EventType {
  const result = db
    .prepare(
      `INSERT INTO event_types
         (slug, title, description, location, duration_minutes, buffer_before_minutes,
          buffer_after_minutes, min_notice_minutes, max_days_ahead, slot_interval_minutes,
          is_active, is_sample, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.slug,
      input.title,
      input.description,
      input.location,
      input.durationMinutes,
      input.bufferBeforeMinutes,
      input.bufferAfterMinutes,
      input.minNoticeMinutes,
      input.maxDaysAhead,
      input.slotIntervalMinutes,
      flag(input.isActive),
      flag(input.isSample ?? false),
      now(),
    );
  return getEventTypeById(db, Number(result.lastInsertRowid))!;
}

export function updateEventType(db: Db, id: number, input: EventTypeInput): EventType | null {
  const changes = db
    .prepare(
      `UPDATE event_types
          SET slug = ?, title = ?, description = ?, location = ?, duration_minutes = ?,
              buffer_before_minutes = ?, buffer_after_minutes = ?, min_notice_minutes = ?,
              max_days_ahead = ?, slot_interval_minutes = ?, is_active = ?
        WHERE id = ?`,
    )
    .run(
      input.slug,
      input.title,
      input.description,
      input.location,
      input.durationMinutes,
      input.bufferBeforeMinutes,
      input.bufferAfterMinutes,
      input.minNoticeMinutes,
      input.maxDaysAhead,
      input.slotIntervalMinutes,
      flag(input.isActive),
      id,
    ).changes;
  return changes ? getEventTypeById(db, id) : null;
}

export function deleteEventType(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM event_types WHERE id = ?").run(id).changes > 0;
}

// --- weekly availability ---------------------------------------------------

export function listAvailabilityRules(db: Db): AvailabilityRule[] {
  return (
    db
      .prepare(
        "SELECT id, weekday, start_minute, end_minute, is_sample FROM availability_rules ORDER BY weekday, start_minute",
      )
      .all() as Record<string, unknown>[]
  ).map((row) => ({
    id: row.id as number,
    weekday: row.weekday as number,
    startMinute: row.start_minute as number,
    endMinute: row.end_minute as number,
    isSample: bool(row.is_sample),
  }));
}

/** Working hours are edited as a whole week, so replacement is the only write. */
export function replaceAvailabilityRules(
  db: Db,
  rules: { weekday: number; startMinute: number; endMinute: number; isSample?: boolean }[],
): AvailabilityRule[] {
  const insert = db.prepare(
    "INSERT INTO availability_rules (weekday, start_minute, end_minute, is_sample) VALUES (?, ?, ?, ?)",
  );
  db.transaction(() => {
    db.prepare("DELETE FROM availability_rules").run();
    for (const rule of rules) {
      insert.run(rule.weekday, rule.startMinute, rule.endMinute, flag(rule.isSample ?? false));
    }
  })();
  return listAvailabilityRules(db);
}

// --- the one calendar ------------------------------------------------------

const CALENDAR_COLUMNS = `
  id, uid, title, description, location, starts_at, ends_at, source, busy,
  is_sample, created_at, updated_at
`;

function toCalendarEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: row.id as number,
    uid: row.uid as string,
    title: row.title as string,
    description: row.description as string,
    location: row.location as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    source: row.source as CalendarEventSource,
    busy: bool(row.busy),
    isSample: bool(row.is_sample),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Events overlapping [from, to). Half-open, so back-to-back events don't collide. */
export function listCalendarEvents(db: Db, from: Date, to: Date): CalendarEvent[] {
  return (
    db
      .prepare(
        `SELECT ${CALENDAR_COLUMNS} FROM calendar_events
          WHERE starts_at < ? AND ends_at > ?
          ORDER BY starts_at`,
      )
      .all(to.toISOString(), from.toISOString()) as Record<string, unknown>[]
  ).map(toCalendarEvent);
}

export function listAllCalendarEvents(db: Db): CalendarEvent[] {
  return (
    db.prepare(`SELECT ${CALENDAR_COLUMNS} FROM calendar_events ORDER BY starts_at`).all() as Record<
      string,
      unknown
    >[]
  ).map(toCalendarEvent);
}

export function getCalendarEvent(db: Db, id: number): CalendarEvent | null {
  const row = db.prepare(`SELECT ${CALENDAR_COLUMNS} FROM calendar_events WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toCalendarEvent(row) : null;
}

export interface CalendarEventInput {
  uid?: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt: string;
  source?: CalendarEventSource;
  busy?: boolean;
  isSample?: boolean;
}

export function createCalendarEvent(db: Db, input: CalendarEventInput): CalendarEvent {
  const timestamp = now();
  const result = db
    .prepare(
      `INSERT INTO calendar_events
         (uid, title, description, location, starts_at, ends_at, source, busy, is_sample, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.uid || `${randomToken(12)}@zcal.local`,
      input.title,
      input.description ?? "",
      input.location ?? "",
      input.startsAt,
      input.endsAt,
      input.source ?? "local",
      flag(input.busy ?? true),
      flag(input.isSample ?? false),
      timestamp,
      timestamp,
    );
  return getCalendarEvent(db, Number(result.lastInsertRowid))!;
}

export function deleteCalendarEvent(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM calendar_events WHERE id = ?").run(id).changes > 0;
}

export interface IcsSyncResult {
  imported: number;
  updated: number;
  skipped: string[];
}

/**
 * Fold an .ics file into the one calendar. Events are matched on UID so
 * re-running a sync updates in place instead of duplicating.
 */
export function upsertIcsEvents(db: Db, events: IcsEvent[], skipped: string[] = []): IcsSyncResult {
  const find = db.prepare("SELECT id FROM calendar_events WHERE uid = ?");
  const update = db.prepare(
    `UPDATE calendar_events
        SET title = ?, description = ?, location = ?, starts_at = ?, ends_at = ?,
            source = 'ics', updated_at = ?
      WHERE id = ?`,
  );
  let imported = 0;
  let updated = 0;

  db.transaction(() => {
    for (const event of events) {
      const uid = event.uid || `${randomToken(12)}@zcal.local`;
      const existing = find.get(uid) as { id: number } | undefined;
      if (existing) {
        update.run(
          event.title,
          event.description,
          event.location,
          event.startsAt,
          event.endsAt,
          now(),
          existing.id,
        );
        updated += 1;
      } else {
        createCalendarEvent(db, { ...event, uid, source: "ics" });
        imported += 1;
      }
    }
  })();

  return { imported, updated, skipped };
}

export function deleteEventsBySource(db: Db, source: CalendarEventSource): number {
  return db.prepare("DELETE FROM calendar_events WHERE source = ?").run(source).changes;
}

// --- bookings --------------------------------------------------------------

const BOOKING_COLUMNS = `
  id, public_id, event_type_id, calendar_event_id, invitee_name, invitee_email, notes,
  starts_at, ends_at, status, cancel_token, is_sample, created_at, cancelled_at
`;

function toBooking(row: Record<string, unknown>): Booking {
  return {
    id: row.id as number,
    publicId: row.public_id as string,
    eventTypeId: row.event_type_id as number,
    calendarEventId: (row.calendar_event_id as number | null) ?? null,
    inviteeName: row.invitee_name as string,
    inviteeEmail: row.invitee_email as string,
    notes: row.notes as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    status: row.status as "confirmed" | "cancelled",
    cancelToken: row.cancel_token as string,
    isSample: bool(row.is_sample),
    createdAt: row.created_at as string,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
  };
}

export function getBookingByPublicId(db: Db, publicId: string): Booking | null {
  const row = db.prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE public_id = ?`).get(publicId) as
    | Record<string, unknown>
    | undefined;
  return row ? toBooking(row) : null;
}

export function listBookings(db: Db, options: { limit?: number; upcomingOnly?: boolean } = {}): Booking[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.upcomingOnly) {
    clauses.push("ends_at >= ?", "status = 'confirmed'");
    params.push(now());
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 200;
  return (
    db
      .prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings ${where} ORDER BY starts_at DESC LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[]
  ).map(toBooking);
}

export interface CreateBookingInput {
  eventType: EventType;
  startsAt: string;
  endsAt: string;
  inviteeName: string;
  inviteeEmail: string;
  notes: string;
  isSample?: boolean;
  createdAt?: string;
  publicId?: string;
}

/**
 * Reserve the slot and write the event back to the calendar, atomically.
 *
 * The booking row and the calendar_events row are created in one transaction,
 * so the calendar can never hold a reservation that has no booking behind it.
 */
export function insertBooking(db: Db, input: CreateBookingInput): Booking {
  const publicId = input.publicId ?? randomPublicId();
  const cancelToken = randomToken();
  const createdAt = input.createdAt ?? now();

  const run = db.transaction(() => {
    const calendarEvent = createCalendarEvent(db, {
      title: `${input.eventType.title} with ${input.inviteeName}`,
      description: input.notes
        ? `Booked via zcal by ${input.inviteeName} <${input.inviteeEmail}>\n\n${input.notes}`
        : `Booked via zcal by ${input.inviteeName} <${input.inviteeEmail}>`,
      location: input.eventType.location,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      source: "booking",
      busy: true,
      isSample: input.isSample ?? false,
    });
    const result = db
      .prepare(
        `INSERT INTO bookings
           (public_id, event_type_id, calendar_event_id, invitee_name, invitee_email, notes,
            starts_at, ends_at, status, cancel_token, is_sample, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      )
      .run(
        publicId,
        input.eventType.id,
        calendarEvent.id,
        input.inviteeName,
        input.inviteeEmail,
        input.notes,
        input.startsAt,
        input.endsAt,
        cancelToken,
        flag(input.isSample ?? false),
        createdAt,
      );
    return Number(result.lastInsertRowid);
  });

  const id = run();
  const row = db.prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;
  return toBooking(row);
}

/** Cancelling frees the time again: the calendar event goes away with it. */
export function cancelBooking(db: Db, booking: Booking): Booking {
  db.transaction(() => {
    db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(
      now(),
      booking.id,
    );
    if (booking.calendarEventId !== null) {
      db.prepare("DELETE FROM calendar_events WHERE id = ?").run(booking.calendarEventId);
    }
  })();
  return getBookingByPublicId(db, booking.publicId)!;
}

// --- sample data -----------------------------------------------------------

export interface SampleDataCounts {
  eventTypes: number;
  availabilityRules: number;
  calendarEvents: number;
  bookings: number;
  total: number;
}

export function countSampleData(db: Db): SampleDataCounts {
  const count = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE is_sample = 1`).get() as { n: number }).n;
  const counts = {
    eventTypes: count("event_types"),
    availabilityRules: count("availability_rules"),
    calendarEvents: count("calendar_events"),
    bookings: count("bookings"),
  };
  return { ...counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0) };
}

/** One button, one transaction, and every trace of the demo content is gone. */
export function deleteSampleData(db: Db): SampleDataCounts {
  const before = countSampleData(db);
  db.transaction(() => {
    db.prepare("DELETE FROM bookings WHERE is_sample = 1").run();
    db.prepare("DELETE FROM calendar_events WHERE is_sample = 1").run();
    db.prepare("DELETE FROM availability_rules WHERE is_sample = 1").run();
    db.prepare("DELETE FROM event_types WHERE is_sample = 1").run();
  })();
  return before;
}

export function deleteAllData(db: Db): void {
  db.transaction(() => {
    db.prepare("DELETE FROM bookings").run();
    db.prepare("DELETE FROM calendar_events").run();
    db.prepare("DELETE FROM availability_rules").run();
    db.prepare("DELETE FROM event_types").run();
  })();
}

export interface DashboardStats {
  upcomingBookings: number;
  eventsInCalendar: number;
  activeLinks: number;
  weeklyHours: number;
}

export function dashboardStats(db: Db): DashboardStats {
  const scalar = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { n: number }).n;
  const minutes = scalar(
    "SELECT COALESCE(SUM(end_minute - start_minute), 0) AS n FROM availability_rules",
  );
  return {
    upcomingBookings: scalar(
      "SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND ends_at >= ?",
      now(),
    ),
    eventsInCalendar: scalar("SELECT COUNT(*) AS n FROM calendar_events"),
    activeLinks: scalar("SELECT COUNT(*) AS n FROM event_types WHERE is_active = 1"),
    weeklyHours: Math.round((minutes / 60) * 10) / 10,
  };
}
