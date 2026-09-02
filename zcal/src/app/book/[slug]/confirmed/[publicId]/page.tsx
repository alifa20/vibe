import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getDb } from "@/lib/db";
import { verifyCancelToken } from "@/lib/auth";
import { getBookingByPublicId, getEventTypeById, getSettings } from "@/lib/repo";
import { formatDateLabel, formatSlotLabel } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking confirmed" };

/**
 * The end of the core loop. The time is reserved, the event is in the owner's
 * calendar, and the invitee can take an .ics away for their own.
 */
export default async function ConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; publicId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { slug, publicId } = await params;
  const { token } = await searchParams;
  const db = getDb();
  const booking = getBookingByPublicId(db, publicId);
  if (!booking) notFound();

  const eventType = getEventTypeById(db, booking.eventTypeId);
  const settings = getSettings(db);
  const start = new Date(booking.startsAt);
  const end = new Date(booking.endsAt);
  const cancelled = booking.status === "cancelled";
  // Only show the cancellation link to whoever arrived holding the token.
  const canCancel = !cancelled && !!token && verifyCancelToken(token, booking.cancelToken);

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
        <div className="container container--narrow stack stack--lg">
          {cancelled ? (
            <Notice tone="warning" title="This booking was cancelled">
              The time has been released. You can{" "}
              <Link href={`/book/${slug}`}>pick another time</Link> if you still need one.
            </Notice>
          ) : (
            <Notice tone="success" title="You are booked in">
              The time is held and it is already in
              {settings.ownerName ? ` ${settings.ownerName}'s` : " the"} calendar.
            </Notice>
          )}

          <div className="card stack">
            <h1>{eventType?.title ?? "Your meeting"}</h1>

            <dl className="stack stack--sm" style={{ margin: 0 }}>
              <div className="summary-line">
                <dt>When</dt>
                <dd>
                  {formatDateLabel(start, settings.timeZone)}
                  <br />
                  {formatSlotLabel(start, settings.timeZone)}–{formatSlotLabel(end, settings.timeZone)} (
                  {settings.timeZone})
                </dd>
              </div>
              {eventType?.location ? (
                <div className="summary-line">
                  <dt>Where</dt>
                  <dd className="pre-wrap">{eventType.location}</dd>
                </div>
              ) : null}
              <div className="summary-line">
                <dt>Booked by</dt>
                <dd>{booking.inviteeName}</dd>
              </div>
              {booking.notes ? (
                <div className="summary-line">
                  <dt>Your note</dt>
                  <dd className="pre-wrap">{booking.notes}</dd>
                </div>
              ) : null}
              <div className="summary-line">
                <dt>Reference</dt>
                <dd className="mono">{booking.publicId}</dd>
              </div>
            </dl>

            {!cancelled ? (
              <div className="row">
                <a className="btn" href={`/api/bookings/${booking.publicId}/ics`} download>
                  Add to your calendar (.ics)
                </a>
                {canCancel ? (
                  <Link
                    className="btn btn--secondary"
                    href={`/cancel/${booking.publicId}?token=${encodeURIComponent(token!)}`}
                  >
                    Cancel this booking
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>

          <Notice tone="info" title="No email is on its way">
            <p>
              zcal does not send mail — it has no mail account and no third-party service behind it.
              Download the <span className="mono">.ics</span> above for your own calendar, and keep
              this page&rsquo;s address if you want to come back to it.
            </p>
            <p style={{ marginTop: "0.5rem" }}>
              {canCancel
                ? "Keep this page's full address — the cancellation link is part of it, and it is the only copy."
                : `To cancel, open the confirmation link you were given right after booking. If you have lost it, contact ${settings.ownerName || "the owner"} directly.`}
            </p>
          </Notice>
        </div>
      </main>
    </div>
  );
}
