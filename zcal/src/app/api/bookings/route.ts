import { apiError, clientKey, invalid, ok, rateLimit, readJsonBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { publicBaseUrl } from "@/lib/env";
import { reserveSlot } from "@/lib/scheduling";
import { bookingRequestSchema } from "@/lib/validation";

/**
 * Public. Reserves a slot and writes the event back to the calendar.
 *
 * The requested time is re-checked against live availability inside
 * `reserveSlot`; the browser's idea of what is free is never trusted.
 */
export async function POST(request: Request) {
  const limit = rateLimit(`book:${clientKey(request)}`, 20, 10 * 60_000);
  if (!limit.allowed) {
    return apiError(429, "too_many_requests", "That is a lot of bookings at once. Try again shortly.");
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = bookingRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  const db = getDb();
  const result = reserveSlot(db, parsed.data);

  if (!result.ok) {
    const status = result.reason === "unknown_link" ? 404 : 409;
    return apiError(status, result.reason, result.message);
  }

  return ok(
    {
      publicId: result.booking.publicId,
      startsAt: result.booking.startsAt,
      endsAt: result.booking.endsAt,
      confirmationUrl: `${publicBaseUrl()}/book/${result.eventType.slug}/confirmed/${result.booking.publicId}`,
      // The token goes to the person who booked, once, so they can cancel.
      cancelUrl: `${publicBaseUrl()}/cancel/${result.booking.publicId}?token=${encodeURIComponent(result.booking.cancelToken)}`,
    },
    201,
  );
}
