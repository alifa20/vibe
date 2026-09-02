import { apiError, guardOwner, invalid, ok, readJsonBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { createEventType, getEventTypeBySlug, listEventTypes } from "@/lib/repo";
import { eventTypeSchema } from "@/lib/validation";

export async function GET() {
  const denied = await guardOwner();
  if (denied) return denied;
  return ok({ eventTypes: listEventTypes(getDb()) });
}

export async function POST(request: Request) {
  const denied = await guardOwner();
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = eventTypeSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  const db = getDb();
  if (getEventTypeBySlug(db, parsed.data.slug)) {
    return apiError(409, "slug_taken", "You already have a booking link with that address.", {
      slug: "That address is already in use.",
    });
  }

  return ok(createEventType(db, parsed.data), 201);
}
