import type { Db } from "./db";
import { computeSlots } from "./availability";
import {
  countSampleData,
  createCalendarEvent,
  createEventType,
  getSettings,
  insertBooking,
  listAvailabilityRules,
  replaceAvailabilityRules,
  updateSettings,
  type SampleDataCounts,
} from "./repo";
import { buildSlotQuery } from "./scheduling";
import { DAY_MS, MINUTE_MS, zonedTimeToUtc, getZonedParts } from "./time";

/**
 * Realistic demo content so the app is worth looking at on first run.
 *
 * Every row it writes carries is_sample = 1 and a "[Sample]" label, and
 * `deleteSampleData` removes all of it in one transaction. Nothing here is
 * load-bearing — an app with the sample data deleted works identically.
 */

export const SAMPLE_LABEL = "[Sample]";

export interface SeedResult extends SampleDataCounts {
  alreadyPresent: boolean;
}

export function seedSampleData(db: Db, nowInstant = new Date()): SeedResult {
  const existing = countSampleData(db);
  if (existing.total > 0) return { ...existing, alreadyPresent: true };

  const settings = getSettings(db);
  if (!settings.ownerName) {
    updateSettings(db, {
      ...settings,
      ownerName: "Sample Owner",
      ownerEmail: "sample.owner@example.invalid",
      calendarName: `${SAMPLE_LABEL} My calendar`,
    });
  }

  if (listAvailabilityRules(db).length === 0) {
    replaceAvailabilityRules(
      db,
      [1, 2, 3, 4, 5].flatMap((weekday) => [
        { weekday, startMinute: 9 * 60, endMinute: 12 * 60 + 30, isSample: true },
        { weekday, startMinute: 13 * 60 + 30, endMinute: 17 * 60, isSample: true },
      ]),
    );
  }

  const introCall = createEventType(db, {
    slug: "sample-intro-call",
    title: `${SAMPLE_LABEL} 30 minute intro call`,
    description:
      "A first conversation. Tell me what you are working on and what you would like help with — I will read your note before we speak.\n\nThis is sample content. Delete it from the Data page whenever you like.",
    location: "Phone — I will call the number you leave in your note",
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 10,
    minNoticeMinutes: 120,
    maxDaysAhead: 30,
    slotIntervalMinutes: 30,
    isActive: true,
    isSample: true,
  });

  createEventType(db, {
    slug: "sample-quick-chat",
    title: `${SAMPLE_LABEL} 15 minute quick chat`,
    description:
      "A short slot for one specific question.\n\nThis is sample content. Delete it from the Data page whenever you like.",
    location: "Video call — link sent by hand after booking",
    durationMinutes: 15,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 5,
    minNoticeMinutes: 60,
    maxDaysAhead: 21,
    slotIntervalMinutes: 15,
    isActive: true,
    isSample: true,
  });

  const timeZone = getSettings(db).timeZone;
  for (const block of sampleBusyBlocks(nowInstant, timeZone)) {
    createCalendarEvent(db, { ...block, source: "local", busy: true, isSample: true });
  }

  // Book two real slots through the same availability engine the app uses, so
  // the demo calendar is internally consistent.
  const query = buildSlotQuery(
    db,
    introCall,
    new Date(nowInstant.getTime() + DAY_MS),
    new Date(nowInstant.getTime() + 12 * DAY_MS),
    nowInstant,
  );
  const slots = computeSlots(query);
  const invitees = [
    { name: "Sample Invitee (Priya)", email: "priya@example.invalid", notes: "Sample booking — happy to be moved if something urgent comes up." },
    { name: "Sample Invitee (Tom)", email: "tom@example.invalid", notes: "Sample booking — I have a short question about pricing." },
  ];
  for (const [index, invitee] of invitees.entries()) {
    const slot = slots[index * 3 + 2];
    if (!slot) continue;
    insertBooking(db, {
      eventType: introCall,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      inviteeName: invitee.name,
      inviteeEmail: invitee.email,
      notes: invitee.notes,
      isSample: true,
    });
  }

  return { ...countSampleData(db), alreadyPresent: false };
}

/** A believable week: a standup, a review, a lunch and an all-afternoon block. */
function sampleBusyBlocks(
  nowInstant: Date,
  timeZone: string,
): { title: string; description: string; location: string; startsAt: string; endsAt: string }[] {
  const blocks: {
    title: string;
    description: string;
    location: string;
    startsAt: string;
    endsAt: string;
  }[] = [];

  const shape = [
    { dayOffset: 1, startMinute: 9 * 60, minutes: 30, title: "Team standup", location: "Video call" },
    { dayOffset: 2, startMinute: 14 * 60, minutes: 90, title: "Design review", location: "Meeting room 2" },
    { dayOffset: 3, startMinute: 12 * 60, minutes: 60, title: "Lunch with Sam", location: "The cafe on the corner" },
    { dayOffset: 4, startMinute: 13 * 60 + 30, minutes: 210, title: "Focus block — quarterly plan", location: "" },
    { dayOffset: 8, startMinute: 10 * 60, minutes: 60, title: "Dentist", location: "High Street" },
    { dayOffset: 9, startMinute: 9 * 60, minutes: 30, title: "Team standup", location: "Video call" },
  ];

  for (const item of shape) {
    const target = new Date(nowInstant.getTime() + item.dayOffset * DAY_MS);
    const parts = getZonedParts(target, timeZone);
    const start = zonedTimeToUtc(
      parts.year,
      parts.month,
      parts.day,
      Math.floor(item.startMinute / 60),
      item.startMinute % 60,
      timeZone,
    );
    blocks.push({
      title: `${SAMPLE_LABEL} ${item.title}`,
      description: "Sample calendar event. Safe to delete.",
      location: item.location,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + item.minutes * MINUTE_MS).toISOString(),
    });
  }

  return blocks;
}
