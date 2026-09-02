import { guardOwner } from "@/lib/api";
import { getDb } from "@/lib/db";
import { buildIcs } from "@/lib/ics";
import { getSettings, listAllCalendarEvents } from "@/lib/repo";

/** The whole calendar as a standard .ics, for any other calendar app. */
export async function GET() {
  const denied = await guardOwner();
  if (denied) return denied;

  const db = getDb();
  const settings = getSettings(db);
  const ics = buildIcs(
    listAllCalendarEvents(db).map((event) => ({
      uid: event.uid,
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    })),
    { calendarName: settings.calendarName },
  );
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="zcal-calendar-${stamp}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
