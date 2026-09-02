import { describe, expect, it } from "vitest";
import {
  getZonedParts,
  hhMmToMinutes,
  isValidTimeZone,
  isoDateInZone,
  minutesToHhMm,
  parseIsoDate,
  timeZoneOffsetMs,
  zonedTimeExists,
  zonedTimeToUtc,
} from "@/lib/time";

describe("timezone conversion", () => {
  it("converts a wall-clock time to the UTC instant it names", () => {
    // 09:00 in London on a winter date is 09:00 UTC.
    expect(zonedTimeToUtc(2026, 1, 15, 9, 0, "Europe/London").toISOString()).toBe(
      "2026-01-15T09:00:00.000Z",
    );
    // The same wall-clock time in summer is 08:00 UTC (BST).
    expect(zonedTimeToUtc(2026, 7, 15, 9, 0, "Europe/London").toISOString()).toBe(
      "2026-07-15T08:00:00.000Z",
    );
  });

  it("handles zones with a fixed negative offset", () => {
    expect(zonedTimeToUtc(2026, 1, 15, 9, 0, "America/New_York").toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });

  it("handles half-hour offsets", () => {
    expect(zonedTimeToUtc(2026, 3, 1, 9, 0, "Asia/Kolkata").toISOString()).toBe(
      "2026-03-01T03:30:00.000Z",
    );
  });

  it("reports the offset in force at a given instant", () => {
    const winter = timeZoneOffsetMs(new Date("2026-01-15T12:00:00Z"), "Europe/London");
    const summer = timeZoneOffsetMs(new Date("2026-07-15T12:00:00Z"), "Europe/London");
    expect(winter).toBe(0);
    expect(summer).toBe(3_600_000);
  });

  it("round-trips an instant through zoned parts", () => {
    const instant = new Date("2026-11-03T23:45:00Z");
    const parts = getZonedParts(instant, "Australia/Sydney");
    expect(zonedTimeToUtc(parts.year, parts.month, parts.day, parts.hour, parts.minute, "Australia/Sydney"))
      .toEqual(instant);
  });
});

describe("daylight saving edges", () => {
  it("knows that the hour skipped by a spring-forward does not exist", () => {
    // London jumps 01:00 -> 02:00 on 29 March 2026, so 01:30 is not a real time.
    expect(zonedTimeExists(2026, 3, 29, 1, 30, "Europe/London")).toBe(false);
    expect(zonedTimeExists(2026, 3, 29, 3, 30, "Europe/London")).toBe(true);
  });

  it("resolves an ambiguous autumn time to the earlier instant", () => {
    // Clocks go back on 25 October 2026: 01:30 happens twice.
    const resolved = zonedTimeToUtc(2026, 10, 25, 1, 30, "Europe/London");
    expect(resolved.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("keeps a 09:00 rule at 09:00 local across a transition", () => {
    const before = zonedTimeToUtc(2026, 3, 28, 9, 0, "Europe/London");
    const after = zonedTimeToUtc(2026, 3, 30, 9, 0, "Europe/London");
    expect(getZonedParts(before, "Europe/London").hour).toBe(9);
    expect(getZonedParts(after, "Europe/London").hour).toBe(9);
    // ...even though the UTC instants differ by an hour more than two days.
    expect(after.getTime() - before.getTime()).toBe(2 * 86_400_000 - 3_600_000);
  });
});

describe("parsing and formatting helpers", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(parseIsoDate("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseIsoDate("2026-02-31")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("26-01-01")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
  });

  it("round-trips times of day", () => {
    expect(hhMmToMinutes("09:30")).toBe(570);
    expect(hhMmToMinutes("24:00")).toBe(1440);
    expect(hhMmToMinutes("24:01")).toBeNull();
    expect(hhMmToMinutes("9:5")).toBeNull();
    expect(hhMmToMinutes("nope")).toBeNull();
    expect(minutesToHhMm(570)).toBe("09:30");
    expect(minutesToHhMm(0)).toBe("00:00");
  });

  it("names the local date for an instant", () => {
    // 23:30 UTC is already the next day in Sydney.
    expect(isoDateInZone(new Date("2026-05-04T23:30:00Z"), "Australia/Sydney")).toBe("2026-05-05");
    expect(isoDateInZone(new Date("2026-05-04T23:30:00Z"), "UTC")).toBe("2026-05-04");
  });

  it("recognises valid IANA zones", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
