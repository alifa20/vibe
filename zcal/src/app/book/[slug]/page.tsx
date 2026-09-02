import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "./BookingFlow";
import { Notice } from "@/components/Notice";
import { getDb } from "@/lib/db";
import { getEventTypeBySlug, getSettings } from "@/lib/repo";
import { getAvailability } from "@/lib/scheduling";
import { DAY_MS, isoDateInZone, zonedTimeToUtc, parseIsoDate } from "@/lib/time";
import { slugString } from "@/lib/validation";

export const dynamic = "force-dynamic";

const DAYS_PER_PAGE = 10;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = slugString.safeParse(slug);
  if (!parsed.success) return { title: "Booking link" };
  const eventType = getEventTypeBySlug(getDb(), parsed.data);
  return { title: eventType?.title ?? "Booking link" };
}

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = slugString.safeParse(slug);
  if (!parsed.success) notFound();

  const db = getDb();
  const eventType = getEventTypeBySlug(db, parsed.data);
  if (!eventType) notFound();

  const settings = getSettings(db);
  const now = new Date();
  const fromDate = isoDateInZone(now, settings.timeZone);
  const parsedFrom = parseIsoDate(fromDate)!;
  const rangeStart = zonedTimeToUtc(
    parsedFrom.year,
    parsedFrom.month,
    parsedFrom.day,
    0,
    0,
    settings.timeZone,
  );
  const availability = getAvailability(
    db,
    eventType,
    rangeStart,
    new Date(rangeStart.getTime() + DAYS_PER_PAGE * DAY_MS),
    now,
  );

  return (
    <div className="shell">
      <header className="site-header">
        <div className="container site-header__inner">
          <span className="brand">
            <span className="brand__dot" aria-hidden="true" />
            {settings.ownerName || "zcal"}
          </span>
        </div>
      </header>

      <main className="main" id="main">
        <div className="container stack stack--lg">
          <div className="page-head">
            <div>
              <h1>{eventType.title}</h1>
              <p className="page-head__lede">
                {eventType.durationMinutes} minutes
                {settings.ownerName ? ` with ${settings.ownerName}` : ""}
                {eventType.location ? ` · ${eventType.location}` : ""}
              </p>
            </div>
          </div>

          {eventType.description ? (
            <div className="marker prose pre-wrap">{eventType.description}</div>
          ) : null}

          {!eventType.isActive ? (
            <Notice tone="warning" title="This link is not accepting bookings">
              <p>
                It has been paused. If you were expecting to book a time, get in touch with
                {settings.ownerName ? ` ${settings.ownerName}` : " the owner"} directly.
              </p>
            </Notice>
          ) : (
            <BookingFlow
              initial={availability}
              initialFrom={fromDate}
              daysPerPage={DAYS_PER_PAGE}
            />
          )}
        </div>
      </main>

      <footer className="site-footer">
        <div className="container">
          Scheduled with zcal. Your name, email and note are stored on
          {settings.ownerName ? ` ${settings.ownerName}'s` : " the owner's"} own machine and are not
          shared with anyone else.
        </div>
      </footer>
    </div>
  );
}
