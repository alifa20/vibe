import { apiError, guardOwner, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { parseIcs } from "@/lib/ics";
import { getSettings, upsertIcsEvents } from "@/lib/repo";

const MAX_ICS_BYTES = 5 * 1024 * 1024;

/**
 * Upload an .ics file into the one calendar. Accepts a raw text/calendar body
 * so it works from the browser and from `curl --data-binary @file.ics`.
 */
export async function POST(request: Request) {
  const denied = await guardOwner();
  if (denied) return denied;

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_ICS_BYTES) {
    return apiError(413, "payload_too_large", "That calendar file is larger than 5 MB.");
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return apiError(400, "unreadable_body", "Could not read that file.");
  }
  if (!raw.trim()) {
    return apiError(400, "empty_file", "That file is empty.");
  }
  if (!/BEGIN:VCALENDAR/i.test(raw)) {
    return apiError(
      422,
      "not_a_calendar",
      "That does not look like an iCalendar file. It should start with BEGIN:VCALENDAR.",
    );
  }

  const db = getDb();
  const { events, skipped } = parseIcs(raw, getSettings(db).timeZone);
  if (events.length === 0) {
    return apiError(422, "no_events", "No usable events were found in that file.", undefined);
  }

  return ok(upsertIcsEvents(db, events, skipped));
}
