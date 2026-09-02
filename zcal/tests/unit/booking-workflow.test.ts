import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import {
  cancelBooking,
  createCalendarEvent,
  createEventType,
  getBookingByPublicId,
  listCalendarEvents,
  replaceAvailabilityRules,
  updateSettings,
  type EventType,
} from "@/lib/repo";
import { getAvailability, reserveSlot } from "@/lib/scheduling";

/**
 * The core loop, end to end at the library level:
 *
 *   read one calendar -> publish availability -> reserve a slot ->
 *   write the event back -> the slot is gone.
 *
 * Everything is pinned to a fixed "now" and to UTC so the assertions do not
 * depend on when or where the suite runs.
 */

const NOW = new Date("2026-03-05T08:00:00Z"); // Thursday
let db: Db;
let eventType: EventType;

beforeEach(() => {
  db = openDatabase(":memory:");
  updateSettings(db, {
    ownerName: "Ada",
    ownerEmail: "ada@example.invalid",
    timeZone: "UTC",
    calendarName: "Work",
  });
  // Thursday and Friday, 09:00-12:00.
  replaceAvailabilityRules(db, [
    { weekday: 4, startMinute: 9 * 60, endMinute: 12 * 60 },
    { weekday: 5, startMinute: 9 * 60, endMinute: 12 * 60 },
  ]);
  eventType = createEventType(db, {
    slug: "intro-call",
    title: "Intro call",
    description: "",
    location: "Phone",
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 0,
    maxDaysAhead: 30,
    slotIntervalMinutes: 30,
    isActive: true,
  });
});

afterEach(() => {
  db.close();
});

const publish = (days = 1) =>
  getAvailability(
    db,
    eventType,
    new Date("2026-03-05T00:00:00Z"),
    new Date(Date.parse("2026-03-05T00:00:00Z") + days * 86_400_000),
    NOW,
  );

const book = (startsAt: string, name = "Sam") =>
  reserveSlot(
    db,
    {
      slug: "intro-call",
      startsAt,
      name,
      email: `${name.toLowerCase()}@example.invalid`,
      notes: "See you then",
    },
    NOW,
  );

describe("the core loop", () => {
  it("publishes availability, reserves a slot, and writes the event back", () => {
    const before = publish();
    expect(before.slots.map((slot) => slot.startsAt.slice(11, 16))).toEqual([
      "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    ]);
    expect(before.emptyReason).toBeNull();
    expect(before.timeZone).toBe("UTC");

    const result = book("2026-03-05T10:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // ...the event is in the one calendar, described so the owner recognises it
    const events = listCalendarEvents(
      db,
      new Date("2026-03-05T00:00:00Z"),
      new Date("2026-03-06T00:00:00Z"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "booking",
      startsAt: "2026-03-05T10:00:00.000Z",
      endsAt: "2026-03-05T10:30:00.000Z",
    });
    expect(events[0]!.title).toBe("Intro call with Sam");
    expect(events[0]!.description).toContain("sam@example.invalid");

    // ...and that time is no longer published to anyone else
    const after = publish();
    expect(after.slots.map((slot) => slot.startsAt.slice(11, 16))).toEqual([
      "09:00", "09:30", "10:30", "11:00", "11:30",
    ]);
  });

  it("refuses the same slot twice", () => {
    expect(book("2026-03-05T10:00:00.000Z").ok).toBe(true);
    const second = book("2026-03-05T10:00:00.000Z", "Kim");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("slot_unavailable");
    expect(second.message).toMatch(/no longer free/i);
  });

  it("refuses a time that was never on offer", () => {
    // 09:15 is not on the 30-minute grid.
    const offGrid = book("2026-03-05T09:15:00.000Z");
    expect(offGrid.ok).toBe(false);
    if (!offGrid.ok) expect(offGrid.reason).toBe("slot_unavailable");

    // 13:00 is outside the working window entirely.
    const outsideHours = book("2026-03-05T13:00:00.000Z");
    expect(outsideHours.ok).toBe(false);

    // Nothing was written for either attempt.
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get(),
    ).toEqual({ n: 0 });
  });

  it("refuses an unknown or paused link", () => {
    const unknown = reserveSlot(
      db,
      { slug: "does-not-exist", startsAt: "2026-03-05T09:00:00.000Z", name: "Sam", email: "s@example.invalid", notes: "" },
      NOW,
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("unknown_link");

    db.prepare("UPDATE event_types SET is_active = 0 WHERE id = ?").run(eventType.id);
    const paused = book("2026-03-05T09:00:00.000Z");
    expect(paused.ok).toBe(false);
    if (!paused.ok) expect(paused.reason).toBe("link_inactive");
  });

  it("releases the time again when the booking is cancelled", () => {
    const result = book("2026-03-05T10:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(publish().slots.some((slot) => slot.startsAt === "2026-03-05T10:00:00.000Z")).toBe(false);

    cancelBooking(db, result.booking);

    expect(publish().slots.some((slot) => slot.startsAt === "2026-03-05T10:00:00.000Z")).toBe(true);
    expect(getBookingByPublicId(db, result.booking.publicId)?.status).toBe("cancelled");
  });

  it("hands the invitee a reference and a cancellation token", () => {
    const result = book("2026-03-05T09:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.publicId).toHaveLength(12);
    expect(result.booking.cancelToken).not.toBe(result.booking.publicId);
    expect(result.booking.notes).toBe("See you then");
  });
});

describe("what the calendar does to availability", () => {
  it("subtracts a busy block the owner added", () => {
    createCalendarEvent(db, {
      title: "Dentist",
      startsAt: "2026-03-05T09:00:00.000Z",
      endsAt: "2026-03-05T10:00:00.000Z",
    });
    expect(publish().slots.map((slot) => slot.startsAt.slice(11, 16))).toEqual([
      "10:00", "10:30", "11:00", "11:30",
    ]);
  });

  it("honours buffers around an existing meeting", () => {
    db.prepare("UPDATE event_types SET buffer_after_minutes = 30 WHERE id = ?").run(eventType.id);
    eventType = { ...eventType, bufferAfterMinutes: 30 };
    createCalendarEvent(db, {
      title: "Standup",
      startsAt: "2026-03-05T10:00:00.000Z",
      endsAt: "2026-03-05T10:30:00.000Z",
    });
    // 09:30 would end at 10:00 but needs 30 clear minutes after it.
    expect(publish().slots.map((slot) => slot.startsAt.slice(11, 16))).toEqual([
      "09:00", "10:30", "11:00", "11:30",
    ]);
  });

  it("explains an empty day rather than showing a blank list", () => {
    createCalendarEvent(db, {
      title: "All morning",
      startsAt: "2026-03-05T08:00:00.000Z",
      endsAt: "2026-03-05T13:00:00.000Z",
    });
    expect(publish().emptyReason).toBe("fully_booked");

    replaceAvailabilityRules(db, []);
    expect(publish().emptyReason).toBe("no_working_hours");
  });

  it("stops publishing beyond the booking horizon", () => {
    db.prepare("UPDATE event_types SET max_days_ahead = 1 WHERE id = ?").run(eventType.id);
    eventType = { ...eventType, maxDaysAhead: 1 };
    const week = publish(7);
    expect([...new Set(week.slots.map((slot) => slot.startsAt.slice(0, 10)))]).toEqual([
      "2026-03-05",
    ]);
  });

  it("hides slots inside the minimum notice period", () => {
    db.prepare("UPDATE event_types SET min_notice_minutes = 180 WHERE id = ?").run(eventType.id);
    eventType = { ...eventType, minNoticeMinutes: 180 };
    // Now is 08:00, so nothing before 11:00.
    expect(publish().slots.map((slot) => slot.startsAt.slice(11, 16))).toEqual(["11:00", "11:30"]);
  });
});
