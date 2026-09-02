import { apiError, invalid, notFound, ok, readJsonBody } from "@/lib/api";
import { verifyCancelToken } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { cancelBooking, getBookingByPublicId } from "@/lib/repo";
import { cancelRequestSchema } from "@/lib/validation";

/**
 * Public, but only with the one-time token issued when the booking was made.
 * Cancelling deletes the calendar event, which frees the slot again.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = cancelRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  const db = getDb();
  const booking = getBookingByPublicId(db, publicId);
  if (!booking) return notFound("No booking with that reference.");

  if (!verifyCancelToken(parsed.data.token, booking.cancelToken)) {
    return apiError(403, "bad_token", "That cancellation link is not valid.");
  }
  if (booking.status === "cancelled") {
    return ok({ publicId: booking.publicId, status: "cancelled", alreadyCancelled: true });
  }

  const cancelled = cancelBooking(db, booking);
  return ok({ publicId: cancelled.publicId, status: cancelled.status, alreadyCancelled: false });
}
