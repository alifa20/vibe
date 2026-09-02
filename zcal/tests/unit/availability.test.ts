import { describe, expect, it } from "vitest";
import {
  computeSlots,
  groupSlotsByLocalDate,
  isSlotBookable,
  mergeIntervals,
  type SlotQuery,
} from "@/lib/availability";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Thursday 5 March 2026, 08:00 UTC. */
const NOW = new Date("2026-03-05T08:00:00Z");

function query(overrides: Partial<SlotQuery> = {}): SlotQuery {
  return {
    rules: {
      durationMinutes: 30,
      slotIntervalMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minNoticeMinutes: 0,
      maxDaysAhead: 30,
    },
    // Thursday, 09:00-12:00.
    weekly: [{ weekday: 4, startMinute: 9 * 60, endMinute: 12 * 60 }],
    busy: [],
    timeZone: "UTC",
    rangeStart: new Date("2026-03-05T00:00:00Z"),
    rangeEnd: new Date("2026-03-06T00:00:00Z"),
    now: NOW,
    ...overrides,
  };
}

const times = (slots: { startsAt: string }[]) => slots.map((slot) => slot.startsAt.slice(11, 16));

describe("computeSlots", () => {
  it("fills a working window with back-to-back slots", () => {
    expect(times(computeSlots(query()))).toEqual([
      "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    ]);
  });

  it("never offers a slot that would run past the end of the window", () => {
    const slots = computeSlots(query({ rules: { ...query().rules, durationMinutes: 45 } }));
    // 11:30 + 45 minutes would end at 12:15, past the 12:00 boundary.
    expect(times(slots)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });

  it("respects a slot interval that differs from the duration", () => {
    const slots = computeSlots(
      query({ rules: { ...query().rules, durationMinutes: 30, slotIntervalMinutes: 60 } }),
    );
    expect(times(slots)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("returns nothing when there are no working hours", () => {
    expect(computeSlots(query({ weekly: [] }))).toEqual([]);
  });

  it("only generates slots on the weekdays that have rules", () => {
    const slots = computeSlots(
      query({
        rangeEnd: new Date("2026-03-12T00:00:00Z"), // a whole week
      }),
    );
    // Only the two Thursdays in range.
    const dates = [...new Set(slots.map((slot) => slot.startsAt.slice(0, 10)))];
    expect(dates).toEqual(["2026-03-05"]);
  });
});

describe("busy time", () => {
  it("removes slots that overlap an event", () => {
    const busy = [
      { start: Date.parse("2026-03-05T10:00:00Z"), end: Date.parse("2026-03-05T11:00:00Z") },
    ];
    expect(times(computeSlots(query({ busy })))).toEqual(["09:00", "09:30", "11:00", "11:30"]);
  });

  it("keeps a slot that merely touches an event end-to-end", () => {
    const busy = [
      { start: Date.parse("2026-03-05T09:00:00Z"), end: Date.parse("2026-03-05T09:30:00Z") },
    ];
    // 09:30 starts exactly when the event ends, so it survives.
    expect(times(computeSlots(query({ busy })))).toContain("09:30");
    expect(times(computeSlots(query({ busy })))).not.toContain("09:00");
  });

  it("applies the buffer before a meeting", () => {
    const busy = [
      { start: Date.parse("2026-03-05T10:00:00Z"), end: Date.parse("2026-03-05T10:30:00Z") },
    ];
    const slots = computeSlots(
      query({ busy, rules: { ...query().rules, bufferBeforeMinutes: 30 } }),
    );
    // 10:00 and 10:30 both need 30 clear minutes beforehand, and the event
    // occupies 10:00-10:30. 09:30 only needs 09:00-09:30, so it survives.
    expect(times(slots)).toEqual(["09:00", "09:30", "11:00", "11:30"]);
  });

  it("applies the buffer after a meeting", () => {
    const busy = [
      { start: Date.parse("2026-03-05T10:00:00Z"), end: Date.parse("2026-03-05T10:30:00Z") },
    ];
    const slots = computeSlots(query({ busy, rules: { ...query().rules, bufferAfterMinutes: 30 } }));
    // 09:30 ends at 10:00 but its buffer runs to 10:30, colliding with the event.
    expect(times(slots)).toEqual(["09:00", "10:30", "11:00", "11:30"]);
  });

  it("is not confused by overlapping busy intervals", () => {
    const busy = [
      { start: Date.parse("2026-03-05T09:00:00Z"), end: Date.parse("2026-03-05T10:00:00Z") },
      { start: Date.parse("2026-03-05T09:30:00Z"), end: Date.parse("2026-03-05T11:00:00Z") },
    ];
    expect(times(computeSlots(query({ busy })))).toEqual(["11:00", "11:30"]);
  });
});

describe("notice and horizon", () => {
  it("hides slots that are sooner than the minimum notice", () => {
    const slots = computeSlots(query({ rules: { ...query().rules, minNoticeMinutes: 150 } }));
    // Now is 08:00, so nothing before 10:30.
    expect(times(slots)).toEqual(["10:30", "11:00", "11:30"]);
  });

  it("hides slots beyond the booking horizon", () => {
    const slots = computeSlots(
      query({
        rules: { ...query().rules, maxDaysAhead: 1 },
        rangeStart: new Date("2026-03-05T00:00:00Z"),
        rangeEnd: new Date("2026-03-20T00:00:00Z"),
      }),
    );
    // Only today's Thursday is inside a one-day horizon.
    expect(new Set(slots.map((slot) => slot.startsAt.slice(0, 10)))).toEqual(
      new Set(["2026-03-05"]),
    );
  });

  it("returns nothing when the requested range is entirely in the past", () => {
    const slots = computeSlots(
      query({
        rangeStart: new Date("2026-02-01T00:00:00Z"),
        rangeEnd: new Date("2026-02-02T00:00:00Z"),
      }),
    );
    expect(slots).toEqual([]);
  });
});

describe("timezones", () => {
  it("generates slots from local wall-clock rules, not UTC ones", () => {
    // 09:00-12:00 on Thursday in New York is 14:00-17:00 UTC in March (EST).
    const slots = computeSlots(
      query({
        timeZone: "America/New_York",
        rangeEnd: new Date("2026-03-06T00:00:00Z"),
      }),
    );
    expect(times(slots)).toEqual(["14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]);
  });

  it("keeps working hours at the same local time across a DST change", () => {
    // Sunday 29 March 2026 is the London spring-forward. Rules run Sat and Sun.
    const slots = computeSlots({
      ...query(),
      timeZone: "Europe/London",
      weekly: [
        { weekday: 6, startMinute: 9 * 60, endMinute: 10 * 60 },
        { weekday: 0, startMinute: 9 * 60, endMinute: 10 * 60 },
      ],
      rangeStart: new Date("2026-03-28T00:00:00Z"),
      rangeEnd: new Date("2026-03-30T00:00:00Z"),
      now: new Date("2026-03-27T00:00:00Z"),
    });
    // Saturday 09:00 GMT = 09:00Z; Sunday 09:00 BST = 08:00Z.
    expect(slots.map((slot) => slot.startsAt)).toEqual([
      "2026-03-28T09:00:00.000Z",
      "2026-03-28T09:30:00.000Z",
      "2026-03-29T08:00:00.000Z",
      "2026-03-29T08:30:00.000Z",
    ]);
  });

  it("never offers a start time that the spring-forward skipped", () => {
    const slots = computeSlots({
      ...query(),
      timeZone: "Europe/London",
      // Sunday, covering the 01:00-02:00 gap.
      weekly: [{ weekday: 0, startMinute: 0, endMinute: 4 * 60 }],
      rules: { ...query().rules, durationMinutes: 30, slotIntervalMinutes: 30 },
      rangeStart: new Date("2026-03-29T00:00:00Z"),
      rangeEnd: new Date("2026-03-29T04:00:00Z"),
      now: new Date("2026-03-28T00:00:00Z"),
    });
    const local = slots.map((slot) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(slot.startsAt)),
    );
    expect(local).not.toContain("01:00");
    expect(local).not.toContain("01:30");
    expect(local).toContain("00:30");
    expect(local).toContain("02:00");
  });
});

describe("helpers", () => {
  it("merges overlapping and touching intervals", () => {
    expect(
      mergeIntervals([
        { start: 30, end: 40 },
        { start: 0, end: 10 },
        { start: 10, end: 20 },
        { start: 15, end: 25 },
      ]),
    ).toEqual([
      { start: 0, end: 25 },
      { start: 30, end: 40 },
    ]);
  });

  it("drops zero-length intervals", () => {
    expect(mergeIntervals([{ start: 5, end: 5 }])).toEqual([]);
  });

  it("groups slots by the owner's local date", () => {
    const slots = computeSlots(
      query({
        weekly: [
          { weekday: 4, startMinute: 9 * 60, endMinute: 10 * 60 },
          { weekday: 5, startMinute: 9 * 60, endMinute: 10 * 60 },
        ],
        rangeEnd: new Date("2026-03-07T00:00:00Z"),
      }),
    );
    const days = groupSlotsByLocalDate(slots, "UTC");
    expect(days.map((day) => day.date)).toEqual(["2026-03-05", "2026-03-06"]);
    expect(days[0]!.slots).toHaveLength(2);
  });

  it("answers whether one specific slot is bookable", () => {
    expect(isSlotBookable(query(), "2026-03-05T09:00:00.000Z")).toBe(true);
    expect(isSlotBookable(query(), "2026-03-05T09:15:00.000Z")).toBe(false);
    expect(isSlotBookable(query(), "2026-03-05T13:00:00.000Z")).toBe(false);
  });
});

describe("range edges", () => {
  it("covers every day of a multi-day range, including the last", () => {
    const slots = computeSlots(
      query({
        weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          startMinute: 9 * 60,
          endMinute: 10 * 60,
        })),
        rangeStart: new Date("2026-03-05T00:00:00Z"),
        rangeEnd: new Date(Date.parse("2026-03-05T00:00:00Z") + 3 * DAY),
      }),
    );
    expect([...new Set(slots.map((slot) => slot.startsAt.slice(0, 10)))]).toEqual([
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
    ]);
  });

  it("does not leak a slot that starts before the range does", () => {
    const slots = computeSlots(
      query({
        rangeStart: new Date("2026-03-05T10:00:00Z"),
        rangeEnd: new Date("2026-03-05T12:00:00Z"),
      }),
    );
    expect(times(slots)).toEqual(["10:00", "10:30", "11:00", "11:30"]);
  });
});
