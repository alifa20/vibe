import type { Metadata } from "next";
import { CalendarManager } from "./CalendarManager";
import { getDb } from "@/lib/db";
import { hasIcsFeed } from "@/lib/env";
import { getSettings, listCalendarEvents } from "@/lib/repo";
import { DAY_MS } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage() {
  const db = getDb();
  const settings = getSettings(db);
  const now = new Date();
  const events = listCalendarEvents(db, now, new Date(now.getTime() + 60 * DAY_MS));

  return (
    <div className="stack stack--lg">
      <div className="page-head">
        <div>
          <h1>{settings.calendarName}</h1>
          <p className="page-head__lede">
            One calendar, and it is the only thing that decides whether you are free. Bookings land
            here automatically; everything else you add, import, or pull in yourself.
          </p>
        </div>
      </div>

      <CalendarManager events={events} timeZone={settings.timeZone} hasFeed={hasIcsFeed()} />
    </div>
  );
}
