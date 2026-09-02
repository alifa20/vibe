import type { Db } from "./db";
import { randomPublicId, randomToken } from "./auth";
import {
  deleteAllData,
  getEventTypeBySlug,
  getSettings,
  listAllCalendarEvents,
  listAvailabilityRules,
  listBookings,
  listEventTypes,
  updateSettings,
} from "./repo";
import type { Backup } from "./validation";

/**
 * Import and export, so the data in this app is never trapped in it.
 *
 * The export is the complete database as readable JSON: settings, links,
 * working hours, every calendar event and every booking. Feed the same file
 * back to the importer on another machine and you have moved house.
 */

export const BACKUP_FORMAT = "zcal-backup" as const;
export const BACKUP_VERSION = 1;

export function buildBackup(db: Db): Backup {
  const settings = getSettings(db);
  const eventTypes = listEventTypes(db);
  const byId = new Map(eventTypes.map((eventType) => [eventType.id, eventType.slug]));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      ownerName: settings.ownerName,
      ownerEmail: settings.ownerEmail,
      timeZone: settings.timeZone,
      calendarName: settings.calendarName,
    },
    eventTypes: eventTypes.map((eventType) => ({
      slug: eventType.slug,
      title: eventType.title,
      description: eventType.description,
      location: eventType.location,
      durationMinutes: eventType.durationMinutes,
      bufferBeforeMinutes: eventType.bufferBeforeMinutes,
      bufferAfterMinutes: eventType.bufferAfterMinutes,
      minNoticeMinutes: eventType.minNoticeMinutes,
      maxDaysAhead: eventType.maxDaysAhead,
      slotIntervalMinutes: eventType.slotIntervalMinutes,
      isActive: eventType.isActive,
      isSample: eventType.isSample,
    })),
    availabilityRules: listAvailabilityRules(db).map((rule) => ({
      weekday: rule.weekday,
      startMinute: rule.startMinute,
      endMinute: rule.endMinute,
      isSample: rule.isSample,
    })),
    calendarEvents: listAllCalendarEvents(db).map((event) => ({
      uid: event.uid,
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      source: event.source,
      busy: event.busy,
      isSample: event.isSample,
    })),
    // Cancellation tokens are secrets that only ever belonged to one invitee,
    // so they are deliberately left out of the export. Imported bookings get
    // fresh ones.
    bookings: listBookings(db, { limit: 100_000 }).map((booking) => ({
      publicId: booking.publicId,
      eventTypeSlug: byId.get(booking.eventTypeId) ?? "",
      inviteeName: booking.inviteeName,
      inviteeEmail: booking.inviteeEmail,
      notes: booking.notes,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      status: booking.status,
      isSample: booking.isSample,
      createdAt: booking.createdAt,
      cancelledAt: booking.cancelledAt,
    })),
  };
}

export interface ImportSummary {
  mode: "merge" | "replace";
  settingsApplied: boolean;
  eventTypes: number;
  availabilityRules: number;
  calendarEvents: number;
  bookings: number;
  skipped: string[];
}

/**
 * `replace` wipes everything first. `merge` keeps what is there and adds what
 * is missing, matching links on slug, events on UID and bookings on public id.
 */
export function applyBackup(db: Db, backup: Backup, mode: "merge" | "replace"): ImportSummary {
  const summary: ImportSummary = {
    mode,
    settingsApplied: false,
    eventTypes: 0,
    availabilityRules: 0,
    calendarEvents: 0,
    bookings: 0,
    skipped: [],
  };

  db.transaction(() => {
    if (mode === "replace") deleteAllData(db);

    if (backup.settings) {
      updateSettings(db, backup.settings);
      summary.settingsApplied = true;
    }

    const insertEventType = db.prepare(
      `INSERT INTO event_types
         (slug, title, description, location, duration_minutes, buffer_before_minutes,
          buffer_after_minutes, min_notice_minutes, max_days_ahead, slot_interval_minutes,
          is_active, is_sample, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const eventType of backup.eventTypes) {
      if (getEventTypeBySlug(db, eventType.slug)) {
        summary.skipped.push(`Booking link "${eventType.slug}" already exists — kept the local one.`);
        continue;
      }
      insertEventType.run(
        eventType.slug,
        eventType.title,
        eventType.description,
        eventType.location,
        eventType.durationMinutes,
        eventType.bufferBeforeMinutes,
        eventType.bufferAfterMinutes,
        eventType.minNoticeMinutes,
        eventType.maxDaysAhead,
        eventType.slotIntervalMinutes,
        eventType.isActive ? 1 : 0,
        eventType.isSample ? 1 : 0,
        new Date().toISOString(),
      );
      summary.eventTypes += 1;
    }

    if (backup.availabilityRules.length > 0) {
      if (mode === "merge") db.prepare("DELETE FROM availability_rules").run();
      const insertRule = db.prepare(
        "INSERT INTO availability_rules (weekday, start_minute, end_minute, is_sample) VALUES (?, ?, ?, ?)",
      );
      for (const rule of backup.availabilityRules) {
        if (rule.endMinute <= rule.startMinute) {
          summary.skipped.push(`Skipped a working-hours row that ends before it starts.`);
          continue;
        }
        insertRule.run(rule.weekday, rule.startMinute, rule.endMinute, rule.isSample ? 1 : 0);
        summary.availabilityRules += 1;
      }
    }

    const findEventByUid = db.prepare("SELECT id FROM calendar_events WHERE uid = ?");
    const insertEvent = db.prepare(
      `INSERT INTO calendar_events
         (uid, title, description, location, starts_at, ends_at, source, busy, is_sample, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Booking-backed events are recreated from the bookings below, so importing
    // them here as well would double-book the calendar.
    for (const event of backup.calendarEvents.filter((item) => item.source !== "booking")) {
      const uid = event.uid || `${randomToken(12)}@zcal.local`;
      if (findEventByUid.get(uid)) continue;
      if (Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
        summary.skipped.push(`Skipped "${event.title}" — it ends before it starts.`);
        continue;
      }
      const timestamp = new Date().toISOString();
      insertEvent.run(
        uid,
        event.title,
        event.description,
        event.location,
        event.startsAt,
        event.endsAt,
        event.source,
        event.busy ? 1 : 0,
        event.isSample ? 1 : 0,
        timestamp,
        timestamp,
      );
      summary.calendarEvents += 1;
    }

    const findBooking = db.prepare("SELECT id FROM bookings WHERE public_id = ?");
    const insertBookingRow = db.prepare(
      `INSERT INTO bookings
         (public_id, event_type_id, calendar_event_id, invitee_name, invitee_email, notes,
          starts_at, ends_at, status, cancel_token, is_sample, created_at, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const booking of backup.bookings) {
      const eventType = getEventTypeBySlug(db, booking.eventTypeSlug);
      if (!eventType) {
        summary.skipped.push(
          `Skipped a booking for "${booking.eventTypeSlug}" — no such booking link.`,
        );
        continue;
      }
      let publicId = booking.publicId;
      if (!publicId || findBooking.get(publicId)) {
        if (publicId && findBooking.get(publicId)) continue; // already imported
        publicId = randomPublicId();
      }

      let calendarEventId: number | null = null;
      if (booking.status === "confirmed") {
        const timestamp = new Date().toISOString();
        const created = insertEvent.run(
          `${randomToken(12)}@zcal.local`,
          `${eventType.title} with ${booking.inviteeName}`,
          `Imported booking for ${booking.inviteeName}`,
          eventType.location,
          booking.startsAt,
          booking.endsAt,
          "booking",
          1,
          booking.isSample ? 1 : 0,
          timestamp,
          timestamp,
        );
        calendarEventId = Number(created.lastInsertRowid);
      }

      try {
        insertBookingRow.run(
          publicId,
          eventType.id,
          calendarEventId,
          booking.inviteeName,
          booking.inviteeEmail,
          booking.notes,
          booking.startsAt,
          booking.endsAt,
          booking.status,
          randomToken(),
          booking.isSample ? 1 : 0,
          booking.createdAt ?? new Date().toISOString(),
          booking.cancelledAt ?? null,
        );
        summary.bookings += 1;
      } catch {
        // The unique-slot index rejected it: that time is already taken here.
        if (calendarEventId !== null) {
          db.prepare("DELETE FROM calendar_events WHERE id = ?").run(calendarEventId);
        }
        summary.skipped.push(
          `Skipped ${booking.inviteeName}'s booking — that slot is already taken locally.`,
        );
      }
    }
  })();

  return summary;
}
