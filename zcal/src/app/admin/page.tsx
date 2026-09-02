import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { Notice } from "@/components/Notice";
import { getDb } from "@/lib/db";
import { publicBaseUrl } from "@/lib/env";
import {
  countSampleData,
  dashboardStats,
  getEventTypeById,
  listBookings,
  listCalendarEvents,
  listEventTypes,
} from "@/lib/repo";
import { DAY_MS, formatDateTimeLabel, formatSlotLabel } from "@/lib/time";
import { getSettings } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  const db = getDb();
  const settings = getSettings(db);
  const stats = dashboardStats(db);
  const sample = countSampleData(db);
  const eventTypes = listEventTypes(db);
  const upcoming = listBookings(db, { upcomingOnly: true, limit: 8 }).reverse();
  const now = new Date();
  const nextWeek = listCalendarEvents(db, now, new Date(now.getTime() + 7 * DAY_MS));

  return (
    <div className="stack stack--lg">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="page-head__lede">
            {settings.ownerName ? `${settings.ownerName}'s calendar. ` : ""}
            Everything below comes from one SQLite file on this machine.
          </p>
        </div>
        <Link className="btn" href="/admin/links">
          Manage booking links
        </Link>
      </div>

      {sample.total > 0 ? (
        <Notice tone="warning" title="This calendar contains sample data">
          <p>
            {sample.eventTypes} booking links, {sample.calendarEvents} calendar events and{" "}
            {sample.bookings} bookings are demo content, each labelled{" "}
            <span className="mono">[Sample]</span>.{" "}
            <Link href="/admin/data">Delete all of it in one click</Link> when you are ready to use
            this for real.
          </p>
        </Notice>
      ) : null}

      <section aria-labelledby="stats-heading" className="stack">
        <h2 id="stats-heading" className="visually-hidden">
          At a glance
        </h2>
        <div className="grid">
          <Stat label="Upcoming bookings" value={stats.upcomingBookings} />
          <Stat label="Events in calendar" value={stats.eventsInCalendar} />
          <Stat label="Active links" value={stats.activeLinks} />
          <Stat label="Bookable hours / week" value={stats.weeklyHours} />
        </div>
      </section>

      <section aria-labelledby="upcoming-heading" className="card stack">
        <div className="row row--between">
          <h2 id="upcoming-heading" className="card__title">
            Next bookings
          </h2>
          <Link className="text-small" href="/admin/calendar">
            Open the calendar
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Nothing booked yet</p>
            <p>
              When someone reserves a slot it appears here, and the meeting is written straight into
              your calendar.
            </p>
          </div>
        ) : (
          <ul className="list">
            {upcoming.map((booking) => {
              const eventType = getEventTypeById(db, booking.eventTypeId);
              return (
                <li key={booking.publicId} className="list__item">
                  <div className="list__main">
                    <p className="list__title">
                      {booking.inviteeName}{" "}
                      {booking.isSample ? <span className="tag tag--sample">Sample</span> : null}
                    </p>
                    <p className="list__meta">
                      {eventType?.title ?? "Deleted link"} ·{" "}
                      {formatDateTimeLabel(new Date(booking.startsAt), settings.timeZone)}–
                      {formatSlotLabel(new Date(booking.endsAt), settings.timeZone)}
                    </p>
                  </div>
                  <span className="mono text-muted">{booking.publicId}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="links-heading" className="card stack">
        <h2 id="links-heading" className="card__title">
          Your booking links
        </h2>

        {eventTypes.length === 0 ? (
          <div className="empty">
            <p className="empty__title">No booking links yet</p>
            <p>A booking link is the page you share. Make one and your free time is publishable.</p>
            <p style={{ marginTop: "1rem" }}>
              <Link className="btn" href="/admin/links">
                Create your first link
              </Link>
            </p>
          </div>
        ) : (
          <ul className="list">
            {eventTypes.map((eventType) => {
              const url = `${publicBaseUrl()}/book/${eventType.slug}`;
              return (
                <li key={eventType.id} className="list__item">
                  <div className="list__main">
                    <p className="list__title">
                      {eventType.title}{" "}
                      {eventType.isActive ? (
                        <span className="tag tag--live">Live</span>
                      ) : (
                        <span className="tag">Paused</span>
                      )}
                    </p>
                    <p className="list__meta mono">/book/{eventType.slug}</p>
                  </div>
                  <span className="row">
                    <CopyButton value={url} />
                    <a className="btn btn--secondary btn--sm" href={`/book/${eventType.slug}`}>
                      Preview
                    </a>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="week-heading" className="card stack">
        <h2 id="week-heading" className="card__title">
          The next seven days
        </h2>
        {nextWeek.length === 0 ? (
          <div className="empty">
            <p className="empty__title">A clear week</p>
            <p>Nothing in the calendar between now and this time next week.</p>
          </div>
        ) : (
          <ul className="list">
            {nextWeek.slice(0, 12).map((event) => (
              <li key={event.id} className="list__item">
                <div className="list__main">
                  <p className="list__title">{event.title}</p>
                  <p className="list__meta">
                    {formatDateTimeLabel(new Date(event.startsAt), settings.timeZone)}–
                    {formatSlotLabel(new Date(event.endsAt), settings.timeZone)}
                  </p>
                </div>
                <SourceTag source={event.source} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <p className="stat__value">{value}</p>
      <p className="stat__label">{label}</p>
    </div>
  );
}

function SourceTag({ source }: { source: "local" | "booking" | "ics" }) {
  if (source === "booking") return <span className="tag tag--booking">Booked</span>;
  if (source === "ics") return <span className="tag">Imported</span>;
  return <span className="tag">Added by you</span>;
}
