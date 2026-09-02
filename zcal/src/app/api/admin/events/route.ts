import { guardOwner, invalid, ok, readJsonBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { createCalendarEvent, listCalendarEvents } from "@/lib/repo";
import { DAY_MS } from "@/lib/time";
import { calendarEventSchema } from "@/lib/validation";

export async function GET(request: Request) {
  const denied = await guardOwner();
  if (denied) return denied;

  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("days") ?? "30");
  const days = Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), 365) : 30;
  const from = new Date();
  const to = new Date(from.getTime() + days * DAY_MS);

  return ok({ events: listCalendarEvents(getDb(), from, to) });
}

/** Add a busy block by hand — the way you keep time for yourself. */
export async function POST(request: Request) {
  const denied = await guardOwner();
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = calendarEventSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  return ok(createCalendarEvent(getDb(), { ...parsed.data, source: "local", busy: true }), 201);
}
