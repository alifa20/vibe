import { describe, expect, it } from "vitest";
import { buildIcs, parseIcs, parseIcsDate, parseIcsDuration } from "@/lib/ics";

const wrap = (body: string) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", body, "END:VCALENDAR"].join("\r\n");

describe("reading iCalendar", () => {
  it("reads a plain UTC event", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:one@example.invalid",
          "SUMMARY:Standup",
          "LOCATION:Room 2",
          "DTSTART:20260402T090000Z",
          "DTEND:20260402T091500Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      "UTC",
    );
    expect(events).toEqual([
      {
        uid: "one@example.invalid",
        title: "Standup",
        description: "",
        location: "Room 2",
        startsAt: "2026-04-02T09:00:00.000Z",
        endsAt: "2026-04-02T09:15:00.000Z",
      },
    ]);
  });

  it("converts a TZID-qualified local time", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:two@example.invalid",
          "SUMMARY:Lunch",
          "DTSTART;TZID=America/New_York:20260702T120000",
          "DTEND;TZID=America/New_York:20260702T130000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      "UTC",
    );
    // Noon in New York in July is 16:00 UTC.
    expect(events[0]!.startsAt).toBe("2026-07-02T16:00:00.000Z");
  });

  it("reads a floating time in the calendar's own zone", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:three@example.invalid",
          "SUMMARY:Floating",
          "DTSTART:20260702T120000",
          "DTEND:20260702T130000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      "Europe/London",
    );
    expect(events[0]!.startsAt).toBe("2026-07-02T11:00:00.000Z");
  });

  it("treats an all-day event as a whole day of busy time", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:four@example.invalid",
          "SUMMARY:Public holiday",
          "DTSTART;VALUE=DATE:20260406",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      "UTC",
    );
    expect(events[0]!.startsAt).toBe("2026-04-06T00:00:00.000Z");
    expect(events[0]!.endsAt).toBe("2026-04-07T00:00:00.000Z");
  });

  it("uses DURATION when there is no DTEND", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:five@example.invalid",
          "SUMMARY:Call",
          "DTSTART:20260402T090000Z",
          "DURATION:PT1H30M",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      "UTC",
    );
    expect(events[0]!.endsAt).toBe("2026-04-02T10:30:00.000Z");
  });

  it("unfolds long lines and unescapes text", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:six@example.invalid",
          "SUMMARY:A meeting with a very long title that has been folded ac",
          " ross two lines",
          "DESCRIPTION:First line\\nSecond line\\, with a comma\\; and a semicolon",
          "DTSTART:20260402T090000Z",
          "DTEND:20260402T093000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      "UTC",
    );
    expect(events[0]!.title).toBe("A meeting with a very long title that has been folded across two lines");
    expect(events[0]!.description).toBe("First line\nSecond line, with a comma; and a semicolon");
  });

  it("ignores nested components such as alarms", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:seven@example.invalid",
          "SUMMARY:Real title",
          "DTSTART:20260402T090000Z",
          "DTEND:20260402T093000Z",
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "SUMMARY:Alarm title",
          "TRIGGER:-PT15M",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      "UTC",
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Real title");
  });

  it("says why it skipped an event instead of dropping it silently", () => {
    const { events, skipped } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:eight@example.invalid",
          "SUMMARY:Weekly standup",
          "DTSTART:20260402T090000Z",
          "DTEND:20260402T091500Z",
          "RRULE:FREQ=WEEKLY;COUNT=10",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:nine@example.invalid",
          "SUMMARY:No end time",
          "DTSTART:20260402T090000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      "UTC",
    );
    expect(events).toHaveLength(0);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]).toContain("repeats");
    expect(skipped[1]).toContain("no end time");
  });

  it("returns nothing rather than throwing on rubbish input", () => {
    expect(parseIcs("this is not a calendar", "UTC").events).toEqual([]);
    expect(parseIcs("", "UTC").events).toEqual([]);
  });
});

describe("writing iCalendar", () => {
  it("produces a document a calendar app will accept", () => {
    const ics = buildIcs(
      [
        {
          uid: "abc@zcal.local",
          title: "Intro call with Sam",
          description: "Line one\nLine two",
          location: "Phone; ask for Ada",
          startsAt: "2026-04-02T09:00:00.000Z",
          endsAt: "2026-04-02T09:30:00.000Z",
        },
      ],
      { calendarName: "Work" },
    );

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("UID:abc@zcal.local");
    expect(ics).toContain("DTSTART:20260402T090000Z");
    expect(ics).toContain("DTEND:20260402T093000Z");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
    expect(ics).toContain("LOCATION:Phone\\; ask for Ada");
    expect(ics).toContain("X-WR-CALNAME:Work");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // Every line must be CRLF-terminated and within the 75-octet fold limit.
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });

  it("survives a round trip through the reader", () => {
    const original = {
      uid: "round@zcal.local",
      title: "A title long enough that the writer has to fold it across lines",
      description: "Notes, with a comma; and a semicolon",
      location: "Room 2",
      startsAt: "2026-04-02T09:00:00.000Z",
      endsAt: "2026-04-02T09:30:00.000Z",
    };
    const { events } = parseIcs(buildIcs([original]), "UTC");
    expect(events).toEqual([original]);
  });

  it("keeps multi-byte characters intact when folding", () => {
    const title = "Café ☕ ".repeat(12).trim();
    const { events } = parseIcs(
      buildIcs([
        {
          uid: "utf@zcal.local",
          title,
          description: "",
          location: "",
          startsAt: "2026-04-02T09:00:00.000Z",
          endsAt: "2026-04-02T09:30:00.000Z",
        },
      ]),
      "UTC",
    );
    expect(events[0]!.title).toBe(title);
  });
});

describe("low-level parsers", () => {
  it("reads RFC 5545 durations", () => {
    expect(parseIcsDuration("PT30M")).toBe(1_800_000);
    expect(parseIcsDuration("PT1H30M")).toBe(5_400_000);
    expect(parseIcsDuration("P1D")).toBe(86_400_000);
    expect(parseIcsDuration("P1W")).toBe(604_800_000);
    expect(parseIcsDuration("nonsense")).toBeNull();
  });

  it("rejects a malformed date-time", () => {
    expect(parseIcsDate("not-a-date", {}, "UTC")).toBeNull();
    expect(parseIcsDate("20260402T0900", {}, "UTC")).toBeNull();
  });

  it("falls back to the calendar zone for an unknown TZID", () => {
    const parsed = parseIcsDate("20260702T120000", { TZID: "Mars/Olympus" }, "Europe/London");
    expect(parsed?.instant.toISOString()).toBe("2026-07-02T11:00:00.000Z");
  });
});
