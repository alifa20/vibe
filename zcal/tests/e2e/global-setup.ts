import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../../src/lib/db";
import { createEventType, replaceAvailabilityRules, updateSettings } from "../../src/lib/repo";
import { E2E } from "./fixture";

/**
 * Builds a throwaway database for the smoke test, so the run never touches the
 * developer's own ./data/zcal.db and always starts from the same state.
 *
 * Working hours cover the whole week, which keeps the test independent of the
 * day it happens to run on.
 */
export default function globalSetup(): void {
  const file = path.resolve(process.cwd(), E2E.databasePath);
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }

  const db = openDatabase(file);
  updateSettings(db, {
    ownerName: E2E.ownerName,
    ownerEmail: "ada@example.invalid",
    timeZone: "UTC",
    calendarName: "E2E calendar",
  });
  replaceAvailabilityRules(
    db,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })),
  );
  createEventType(db, {
    slug: E2E.slug,
    title: E2E.linkTitle,
    description: "A booking link used only by the automated smoke test.",
    location: "Phone",
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 0,
    maxDaysAhead: 30,
    slotIntervalMinutes: 30,
    isActive: true,
  });
  db.close();
}
