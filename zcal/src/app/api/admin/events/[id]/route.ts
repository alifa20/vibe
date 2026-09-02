import { guardOwner, notFound, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { deleteCalendarEvent, getCalendarEvent } from "@/lib/repo";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guardOwner();
  if (denied) return denied;

  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return notFound("No calendar event with that id.");

  const db = getDb();
  const event = getCalendarEvent(db, id);
  if (!event) return notFound("No calendar event with that id.");

  deleteCalendarEvent(db, id);
  return ok({ deleted: true, id, freedSlot: event.source === "booking" });
}
