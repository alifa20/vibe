import { notFound } from "@/lib/api";
import { getDb } from "@/lib/db";
import { buildIcs } from "@/lib/ics";
import { getBookingByPublicId, getEventTypeById, getSettings } from "@/lib/repo";

/**
 * Public. The single-event .ics the invitee downloads for their own calendar.
 * zcal sends no email, so this is how a booking reaches the other person's
 * calendar — see "No email is sent" in the README.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  const db = getDb();
  const booking = getBookingByPublicId(db, publicId);
  if (!booking || booking.status !== "confirmed") return notFound("No confirmed booking with that reference.");

  const eventType = getEventTypeById(db, booking.eventTypeId);
  const settings = getSettings(db);
  const organiser = settings.ownerName || "your host";

  const ics = buildIcs(
    [
      {
        uid: `booking-${booking.publicId}@zcal.local`,
        title: eventType ? eventType.title : "Meeting",
        description: `Booked with ${organiser} via zcal.\nReference: ${booking.publicId}`,
        location: eventType?.location ?? "",
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
      },
    ],
    { method: "PUBLISH" },
  );

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="zcal-${booking.publicId}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
