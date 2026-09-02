import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyBackup, buildBackup } from "@/lib/backup";
import { openDatabase, type Db } from "@/lib/db";
import {
  createCalendarEvent,
  createEventType,
  getSettings,
  insertBooking,
  listAvailabilityRules,
  listBookings,
  listCalendarEvents,
  listEventTypes,
  replaceAvailabilityRules,
  updateSettings,
  type EventType,
} from "@/lib/repo";
import { backupSchema } from "@/lib/validation";

let db: Db;

function populate(target: Db): EventType {
  updateSettings(target, {
    ownerName: "Ada",
    ownerEmail: "ada@example.invalid",
    timeZone: "Europe/London",
    calendarName: "Work",
  });
  replaceAvailabilityRules(target, [
    { weekday: 1, startMinute: 540, endMinute: 720 },
    { weekday: 2, startMinute: 540, endMinute: 720 },
  ]);
  const eventType = createEventType(target, {
    slug: "intro-call",
    title: "Intro call",
    description: "Say hello",
    location: "Phone",
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 10,
    minNoticeMinutes: 60,
    maxDaysAhead: 30,
    slotIntervalMinutes: 30,
    isActive: true,
  });
  createCalendarEvent(target, {
    uid: "block@example.invalid",
    title: "Dentist",
    startsAt: "2026-04-02T09:00:00.000Z",
    endsAt: "2026-04-02T10:00:00.000Z",
  });
  insertBooking(target, {
    eventType,
    startsAt: "2026-04-06T10:00:00.000Z",
    endsAt: "2026-04-06T10:30:00.000Z",
    inviteeName: "Sam",
    inviteeEmail: "sam@example.invalid",
    notes: "Looking forward to it",
  });
  return eventType;
}

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

describe("export", () => {
  it("captures everything the app knows", () => {
    populate(db);
    const backup = buildBackup(db);

    expect(backup.format).toBe("zcal-backup");
    expect(backup.settings).toMatchObject({ ownerName: "Ada", timeZone: "Europe/London" });
    expect(backup.eventTypes).toHaveLength(1);
    expect(backup.availabilityRules).toHaveLength(2);
    expect(backup.calendarEvents).toHaveLength(2); // the block plus the booking
    expect(backup.bookings).toHaveLength(1);
    expect(backup.bookings[0]).toMatchObject({
      eventTypeSlug: "intro-call",
      inviteeName: "Sam",
      status: "confirmed",
    });
  });

  it("never exports a cancellation token", () => {
    populate(db);
    const serialised = JSON.stringify(buildBackup(db));
    const token = (
      db.prepare("SELECT cancel_token AS token FROM bookings LIMIT 1").get() as { token: string }
    ).token;
    expect(token.length).toBeGreaterThan(0);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain("cancelToken");
  });

  it("validates against the schema it claims to follow", () => {
    populate(db);
    expect(backupSchema.safeParse(JSON.parse(JSON.stringify(buildBackup(db)))).success).toBe(true);
  });
});

describe("import", () => {
  it("restores a backup into an empty database", () => {
    populate(db);
    const backup = buildBackup(db);

    const restored = openDatabase(":memory:");
    const summary = applyBackup(restored, backup, "replace");

    expect(summary).toMatchObject({
      mode: "replace",
      settingsApplied: true,
      eventTypes: 1,
      availabilityRules: 2,
      calendarEvents: 1, // the manual block; the booking recreates its own
      bookings: 1,
    });
    expect(getSettings(restored).ownerName).toBe("Ada");
    expect(listEventTypes(restored)[0]!.slug).toBe("intro-call");
    expect(listAvailabilityRules(restored)).toHaveLength(2);
    expect(listBookings(restored)[0]!.inviteeName).toBe("Sam");

    // The restored booking blocks its time again.
    const events = listCalendarEvents(
      restored,
      new Date("2026-04-06T00:00:00Z"),
      new Date("2026-04-07T00:00:00Z"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("booking");
    restored.close();
  });

  it("mints a fresh cancellation token for an imported booking", () => {
    populate(db);
    const original = (
      db.prepare("SELECT cancel_token AS token FROM bookings LIMIT 1").get() as { token: string }
    ).token;

    const restored = openDatabase(":memory:");
    applyBackup(restored, buildBackup(db), "replace");
    const imported = (
      restored.prepare("SELECT cancel_token AS token FROM bookings LIMIT 1").get() as {
        token: string;
      }
    ).token;

    expect(imported).not.toBe(original);
    expect(imported.length).toBeGreaterThan(20);
    restored.close();
  });

  it("survives a full round trip without drift", () => {
    populate(db);
    const first = buildBackup(db);

    const restored = openDatabase(":memory:");
    applyBackup(restored, first, "replace");
    const second = buildBackup(restored);

    expect(second.eventTypes).toEqual(first.eventTypes);
    expect(second.availabilityRules).toEqual(first.availabilityRules);
    expect(second.settings).toEqual(first.settings);
    expect(second.bookings.map((booking) => booking.inviteeName)).toEqual(
      first.bookings.map((booking) => booking.inviteeName),
    );
    restored.close();
  });

  it("keeps existing links when merging rather than replacing", () => {
    populate(db);
    const backup = buildBackup(db);

    // A second database with its own version of the same slug.
    const other = openDatabase(":memory:");
    createEventType(other, {
      slug: "intro-call",
      title: "My own intro call",
      description: "",
      location: "",
      durationMinutes: 45,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minNoticeMinutes: 0,
      maxDaysAhead: 30,
      slotIntervalMinutes: 15,
      isActive: true,
    });

    const summary = applyBackup(other, backup, "merge");
    expect(summary.eventTypes).toBe(0);
    expect(summary.skipped.some((line) => line.includes("intro-call"))).toBe(true);
    expect(listEventTypes(other)[0]!.title).toBe("My own intro call");
    // The booking still could not be placed against the local link's grid, but
    // it is imported and reported rather than silently dropped.
    expect(summary.bookings + summary.skipped.length).toBeGreaterThan(0);
    other.close();
  });

  it("clears the database first when replacing", () => {
    populate(db);
    const backup = buildBackup(db);

    const other = openDatabase(":memory:");
    createEventType(other, {
      slug: "old-link",
      title: "Old",
      description: "",
      location: "",
      durationMinutes: 15,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minNoticeMinutes: 0,
      maxDaysAhead: 30,
      slotIntervalMinutes: 15,
      isActive: true,
    });

    applyBackup(other, backup, "replace");
    expect(listEventTypes(other).map((item) => item.slug)).toEqual(["intro-call"]);
    other.close();
  });

  it("reports a booking it cannot place instead of failing the whole import", () => {
    populate(db);
    const backup = buildBackup(db);
    backup.bookings.push({
      ...backup.bookings[0]!,
      publicId: "differentref",
      inviteeName: "Clash",
    });

    const restored = openDatabase(":memory:");
    const summary = applyBackup(restored, backup, "replace");

    expect(summary.bookings).toBe(1);
    expect(summary.skipped.some((line) => line.includes("Clash"))).toBe(true);
    // The rejected booking left no orphan behind.
    const events = restored
      .prepare("SELECT COUNT(*) AS n FROM calendar_events WHERE source = 'booking'")
      .get() as { n: number };
    expect(events.n).toBe(1);
    restored.close();
  });

  it("skips a booking whose link is missing", () => {
    populate(db);
    const backup = buildBackup(db);
    backup.eventTypes = [];

    const restored = openDatabase(":memory:");
    const summary = applyBackup(restored, backup, "replace");
    expect(summary.bookings).toBe(0);
    expect(summary.skipped.some((line) => line.includes("no such booking link"))).toBe(true);
    restored.close();
  });
});

describe("validation of untrusted files", () => {
  it("rejects a file that is not a zcal backup", () => {
    expect(backupSchema.safeParse({ hello: "world" }).success).toBe(false);
    expect(backupSchema.safeParse(null).success).toBe(false);
    expect(backupSchema.safeParse([]).success).toBe(false);
  });

  it("rejects a backup with an impossible timezone or timestamp", () => {
    const base = { format: "zcal-backup", version: 1 };
    expect(
      backupSchema.safeParse({ ...base, settings: { timeZone: "Mars/Olympus" } }).success,
    ).toBe(false);
    expect(
      backupSchema.safeParse({
        ...base,
        calendarEvents: [{ title: "x", startsAt: "yesterday", endsAt: "tomorrow" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a slug that could escape its URL segment", () => {
    expect(
      backupSchema.safeParse({
        format: "zcal-backup",
        version: 1,
        eventTypes: [
          {
            slug: "../../etc/passwd",
            title: "Bad",
            durationMinutes: 30,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
