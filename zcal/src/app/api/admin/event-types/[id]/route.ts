import { apiError, guardOwner, invalid, notFound, ok, readJsonBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { deleteEventType, getEventTypeById, getEventTypeBySlug, updateEventType } from "@/lib/repo";
import { eventTypeSchema } from "@/lib/validation";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guardOwner();
  if (denied) return denied;

  const id = parseId((await context.params).id);
  if (id === null) return notFound("No booking link with that id.");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = eventTypeSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  const db = getDb();
  const clash = getEventTypeBySlug(db, parsed.data.slug);
  if (clash && clash.id !== id) {
    return apiError(409, "slug_taken", "Another booking link already uses that address.", {
      slug: "That address is already in use.",
    });
  }

  const updated = updateEventType(db, id, parsed.data);
  if (!updated) return notFound("No booking link with that id.");
  return ok(updated);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guardOwner();
  if (denied) return denied;

  const id = parseId((await context.params).id);
  if (id === null) return notFound("No booking link with that id.");

  const db = getDb();
  const existing = getEventTypeById(db, id);
  if (!existing) return notFound("No booking link with that id.");

  // Bookings cascade with the link; the calendar events they created stay, so
  // time that is already committed does not silently free itself up.
  deleteEventType(db, id);
  return ok({ deleted: true, id });
}
