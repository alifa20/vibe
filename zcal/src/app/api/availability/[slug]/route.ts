import { apiError, notFound, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getEventTypeBySlug } from "@/lib/repo";
import { MAX_QUERY_DAYS, getAvailability } from "@/lib/scheduling";
import { DAY_MS, parseIsoDate, zonedTimeToUtc } from "@/lib/time";
import { getSettings } from "@/lib/repo";
import { slugString } from "@/lib/validation";

/**
 * Public. Publishes free slots for one booking link.
 *
 * Query: ?from=YYYY-MM-DD&days=7 — both optional, both clamped. Nothing
 * private is exposed: no event titles, no invitee details, only free times.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug: rawSlug } = await context.params;
  const slug = slugString.safeParse(rawSlug);
  if (!slug.success) return notFound("No booking link with that address.");

  const db = getDb();
  const eventType = getEventTypeBySlug(db, slug.data);
  if (!eventType) return notFound("No booking link with that address.");
  if (!eventType.isActive) {
    return apiError(403, "link_inactive", "This booking link is not accepting bookings right now.");
  }

  const timeZone = getSettings(db).timeZone;
  const url = new URL(request.url);
  const now = new Date();

  const fromParam = url.searchParams.get("from");
  const parsedFrom = fromParam ? parseIsoDate(fromParam) : null;
  if (fromParam && !parsedFrom) {
    return apiError(400, "bad_range", "The `from` parameter must look like 2026-03-01.");
  }

  const rangeStart = parsedFrom
    ? zonedTimeToUtc(parsedFrom.year, parsedFrom.month, parsedFrom.day, 0, 0, timeZone)
    : now;

  const requestedDays = Number(url.searchParams.get("days") ?? "7");
  const days = Number.isFinite(requestedDays)
    ? Math.min(Math.max(Math.trunc(requestedDays), 1), MAX_QUERY_DAYS)
    : 7;

  const rangeEnd = new Date(
    (parsedFrom ? rangeStart.getTime() : startOfToday(now, timeZone)) + days * DAY_MS,
  );

  return ok(getAvailability(db, eventType, rangeStart, rangeEnd, now));
}

function startOfToday(now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(now).split("-").map(Number);
  return zonedTimeToUtc(year!, month!, day!, 0, 0, timeZone).getTime();
}
