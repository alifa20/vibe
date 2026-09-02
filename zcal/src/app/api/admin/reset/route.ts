import { apiError, guardOwner, ok, readJsonBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { deleteAllData } from "@/lib/repo";

/**
 * Erase every booking link, working hour, calendar event and booking.
 *
 * Requires an explicit confirmation phrase in the body so it cannot be
 * triggered by a stray request. Your settings survive; the data does not.
 */
export async function POST(request: Request) {
  const denied = await guardOwner();
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const confirm = (body.value as { confirm?: unknown })?.confirm;
  if (confirm !== "DELETE EVERYTHING") {
    return apiError(
      400,
      "confirmation_required",
      'Type DELETE EVERYTHING exactly to confirm.',
      { confirm: "That does not match." },
    );
  }

  deleteAllData(getDb());
  return ok({ deleted: true });
}
