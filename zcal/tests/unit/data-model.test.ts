import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { openDatabase, schemaVersion, LATEST_SCHEMA_VERSION, type Db } from "@/lib/db";
import {
  cancelBooking,
  countSampleData,
  createCalendarEvent,
  createEventType,
  deleteAllData,
  deleteEventType,
  deleteSampleData,
  getBookingByPublicId,
  getEventTypeBySlug,
  getSettings,
  insertBooking,
  listAvailabilityRules,
  listCalendarEvents,
  listEventTypes,
  replaceAvailabilityRules,
  updateSettings,
  upsertIcsEvents,
  type EventType,
} from "@/lib/repo";

let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function makeEventType(overrides: Partial<EventType> = {}): EventType {
  return createEventType(db, {
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
    ...overrides,
  });
}

describe("schema", () => {
  it("migrates a fresh database to the latest version", () => {
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it("is idempotent — reopening applies nothing new", () => {
    const second = openDatabase(":memory:");
    expect(schemaVersion(second)).toBe(LATEST_SCHEMA_VERSION);
    second.close();
  });

  it("creates exactly one settings row", () => {
    const count = db.prepare("SELECT COUNT(*) AS n FROM settings").get() as { n: number };
    expect(count.n).toBe(1);
    expect(() => db.prepare("INSERT INTO settings (id, updated_at) VALUES (2, 'x')").run()).toThrow();
  });

  it("enforces foreign keys", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO bookings
             (public_id, event_type_id, invitee_name, invitee_email, starts_at, ends_at, cancel_token, created_at)
           VALUES ('abc', 9999, 'X', 'x@example.invalid', '2026-01-01T09:00:00Z', '2026-01-01T09:30:00Z', 't', '2026-01-01T00:00:00Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe("settings", () => {
  it("round-trips the owner's profile", () => {
    const saved = updateSettings(db, {
      ownerName: "Ada",
      ownerEmail: "ada@example.invalid",
      timeZone: "Europe/London",
      calendarName: "Work",
    });
    expect(saved.ownerName).toBe("Ada");
    expect(getSettings(db).timeZone).toBe("Europe/London");
  });
});

describe("event types", () => {
  it("rejects a duplicate slug", () => {
    makeEventType();
    expect(() => makeEventType()).toThrow(/UNIQUE/i);
  });

  it("rejects a duration outside the allowed range", () => {
    expect(() => makeEventType({ slug: "too-short", durationMinutes: 1 })).toThrow(/CHECK/i);
    expect(() => makeEventType({ slug: "too-long", durationMinutes: 10_000 })).toThrow(/CHECK/i);
  });

  it("finds a link by its slug", () => {
    makeEventType();
    expect(getEventTypeBySlug(db, "intro-call")?.title).toBe("Intro call");
    expect(getEventTypeBySlug(db, "nope")).toBeNull();
  });

  it("removes its bookings when deleted, but leaves the calendar alone", () => {
    const eventType = makeEventType();
    insertBooking(db, {
      eventType,
      startsAt: "2026-04-02T09:00:00.000Z",
      endsAt: "2026-04-02T09:30:00.000Z",
      inviteeName: "Sam",
      inviteeEmail: "sam@example.invalid",
      notes: "",
    });

    deleteEventType(db, eventType.id);

    const bookings = db.prepare("SELECT COUNT(*) AS n FROM bookings").get() as { n: number };
    const events = db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() as { n: number };
    expect(bookings.n).toBe(0);
    // The meeting is still committed time — it does not silently free itself.
    expect(events.n).toBe(1);
  });
});

describe("availability rules", () => {
  it("rejects a window that ends before it starts", () => {
    expect(() =>
      replaceAvailabilityRules(db, [{ weekday: 1, startMinute: 600, endMinute: 540 }]),
    ).toThrow(/CHECK/i);
  });

  it("rejects an impossible weekday", () => {
    expect(() =>
      replaceAvailabilityRules(db, [{ weekday: 9, startMinute: 540, endMinute: 600 }]),
    ).toThrow(/CHECK/i);
  });

  it("replaces the whole week atomically", () => {
    replaceAvailabilityRules(db, [
      { weekday: 1, startMinute: 540, endMinute: 720 },
      { weekday: 2, startMinute: 540, endMinute: 720 },
    ]);
    expect(listAvailabilityRules(db)).toHaveLength(2);

    replaceAvailabilityRules(db, [{ weekday: 3, startMinute: 600, endMinute: 660 }]);
    const rules = listAvailabilityRules(db);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.weekday).toBe(3);
  });

  it("leaves the previous week intact when the new one is invalid", () => {
    replaceAvailabilityRules(db, [{ weekday: 1, startMinute: 540, endMinute: 720 }]);
    expect(() =>
      replaceAvailabilityRules(db, [
        { weekday: 2, startMinute: 540, endMinute: 720 },
        { weekday: 2, startMinute: 800, endMinute: 700 },
      ]),
    ).toThrow();
    expect(listAvailabilityRules(db)).toHaveLength(1);
  });
});

describe("calendar events", () => {
  it("rejects an event that ends before it starts", () => {
    expect(() =>
      createCalendarEvent(db, {
        title: "Backwards",
        startsAt: "2026-04-02T10:00:00.000Z",
        endsAt: "2026-04-02T09:00:00.000Z",
      }),
    ).toThrow(/CHECK/i);
  });

  it("finds events that overlap a window, not only those inside it", () => {
    createCalendarEvent(db, {
      title: "Spans the window",
      startsAt: "2026-04-02T08:00:00.000Z",
      endsAt: "2026-04-02T18:00:00.000Z",
    });
    const found = listCalendarEvents(
      db,
      new Date("2026-04-02T10:00:00Z"),
      new Date("2026-04-02T11:00:00Z"),
    );
    expect(found).toHaveLength(1);
  });

  it("excludes events that merely touch the window edges", () => {
    createCalendarEvent(db, {
      title: "Ends as the window opens",
      startsAt: "2026-04-02T09:00:00.000Z",
      endsAt: "2026-04-02T10:00:00.000Z",
    });
    const found = listCalendarEvents(
      db,
      new Date("2026-04-02T10:00:00Z"),
      new Date("2026-04-02T11:00:00Z"),
    );
    expect(found).toHaveLength(0);
  });

  it("updates an imported event in place when its UID comes round again", () => {
    const event = {
      uid: "abc@example.invalid",
      title: "Standup",
      description: "",
      location: "",
      startsAt: "2026-04-02T09:00:00.000Z",
      endsAt: "2026-04-02T09:15:00.000Z",
    };
    expect(upsertIcsEvents(db, [event])).toMatchObject({ imported: 1, updated: 0 });

    const moved = { ...event, startsAt: "2026-04-02T10:00:00.000Z", endsAt: "2026-04-02T10:15:00.000Z" };
    expect(upsertIcsEvents(db, [moved])).toMatchObject({ imported: 0, updated: 1 });

    const all = listCalendarEvents(db, new Date("2026-04-01T00:00:00Z"), new Date("2026-04-03T00:00:00Z"));
    expect(all).toHaveLength(1);
    expect(all[0]!.startsAt).toBe("2026-04-02T10:00:00.000Z");
  });
});

describe("bookings", () => {
  it("writes the booking and the calendar event together", () => {
    const eventType = makeEventType();
    const booking = insertBooking(db, {
      eventType,
      startsAt: "2026-04-02T09:00:00.000Z",
      endsAt: "2026-04-02T09:30:00.000Z",
      inviteeName: "Sam",
      inviteeEmail: "sam@example.invalid",
      notes: "Looking forward to it",
    });

    expect(booking.status).toBe("confirmed");
    expect(booking.calendarEventId).not.toBeNull();
    expect(booking.publicId).toMatch(/^[a-z2-9]{12}$/);
    expect(booking.cancelToken.length).toBeGreaterThan(20);

    const events = listCalendarEvents(
      db,
      new Date("2026-04-02T00:00:00Z"),
      new Date("2026-04-03T00:00:00Z"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("booking");
    expect(events[0]!.title).toContain("Sam");
  });

  it("refuses two confirmed bookings on the same link at the same time", () => {
    const eventType = makeEventType();
    const slot = {
      startsAt: "2026-04-02T09:00:00.000Z",
      endsAt: "2026-04-02T09:30:00.000Z",
      inviteeName: "Sam",
      inviteeEmail: "sam@example.invalid",
      notes: "",
    };
    insertBooking(db, { eventType, ...slot });
    expect(() => insertBooking(db, { eventType, ...slot })).toThrow(/UNIQUE/i);

    // The failed attempt must not have left a calendar event behind.
    const events = db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() as { n: number };
    expect(events.n).toBe(1);
  });

  it("allows the same time again once the first booking is cancelled", () => {
    const eventType = makeEventType();
    const slot = {
      startsAt: "2026-04-02T09:00:00.000Z",
      endsAt: "2026-04-02T09:30:00.000Z",
      inviteeEmail: "sam@example.invalid",
      notes: "",
    };
    const first = insertBooking(db, { eventType, ...slot, inviteeName: "Sam" });
    cancelBooking(db, first);
    expect(() => insertBooking(db, { eventType, ...slot, inviteeName: "Kim" })).not.toThrow();
  });

  it("frees the calendar when a booking is cancelled", () => {
    const eventType = makeEventType();
    const booking = insertBooking(db, {
      eventType,
      startsAt: "2026-04-02T09:00:00.000Z",
      endsAt: "2026-04-02T09:30:00.000Z",
      inviteeName: "Sam",
      inviteeEmail: "sam@example.invalid",
      notes: "",
    });

    const cancelled = cancelBooking(db, booking);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).not.toBeNull();

    const events = db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() as { n: number };
    expect(events.n).toBe(0);
    // The record itself is kept, so the owner still has the history.
    expect(getBookingByPublicId(db, booking.publicId)?.inviteeName).toBe("Sam");
  });
});

describe("sample data", () => {
  it("counts and removes only the rows flagged as samples", () => {
    const sampleType = makeEventType({ slug: "sample-link", isSample: true });
    makeEventType({ slug: "real-link" });
    replaceAvailabilityRules(db, [
      { weekday: 1, startMinute: 540, endMinute: 720, isSample: true },
      { weekday: 2, startMinute: 540, endMinute: 720, isSample: false },
    ]);
    createCalendarEvent(db, {
      title: "Sample block",
      startsAt: "2026-04-02T09:00:00.000Z",
      endsAt: "2026-04-02T10:00:00.000Z",
      isSample: true,
    });
    insertBooking(db, {
      eventType: sampleType,
      startsAt: "2026-04-03T09:00:00.000Z",
      endsAt: "2026-04-03T09:30:00.000Z",
      inviteeName: "Sample Person",
      inviteeEmail: "sample@example.invalid",
      notes: "",
      isSample: true,
    });

    expect(countSampleData(db)).toMatchObject({
      eventTypes: 1,
      availabilityRules: 1,
      calendarEvents: 2, // the block plus the booking's own event
      bookings: 1,
      total: 5,
    });

    deleteSampleData(db);

    expect(countSampleData(db).total).toBe(0);
    expect(listEventTypes(db).map((item) => item.slug)).toEqual(["real-link"]);
    expect(listAvailabilityRules(db)).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get()).toEqual({ n: 0 });
  });

  it("wipes everything but the profile on a full reset", () => {
    updateSettings(db, {
      ownerName: "Ada",
      ownerEmail: "",
      timeZone: "UTC",
      calendarName: "Work",
    });
    makeEventType();
    deleteAllData(db);

    expect(listEventTypes(db)).toHaveLength(0);
    expect(getSettings(db).ownerName).toBe("Ada");
  });
});
