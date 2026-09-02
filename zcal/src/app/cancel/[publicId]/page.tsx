import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CancelForm } from "./CancelForm";
import { Notice } from "@/components/Notice";
import { verifyCancelToken } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBookingByPublicId, getEventTypeById, getSettings } from "@/lib/repo";
import { formatDateLabel, formatSlotLabel } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cancel a booking" };

/**
 * Public, and gated by the one-time token issued at booking time. Without a
 * valid token the page says nothing about the booking at all.
 */
export default async function CancelPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { publicId } = await params;
  const { token } = await searchParams;

  const db = getDb();
  const booking = getBookingByPublicId(db, publicId);
  if (!booking) notFound();

  const settings = getSettings(db);
  const valid = !!token && verifyCancelToken(token, booking.cancelToken);
  const eventType = valid ? getEventTypeById(db, booking.eventTypeId) : null;

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
          <h1>Cancel a booking</h1>

          {!valid ? (
            <Notice tone="error" title="This cancellation link is not valid">
              <p>
                It may have been copied incompletely, or it may belong to a different booking.
                Contact {settings.ownerName || "the owner"} directly to change your time.
              </p>
            </Notice>
          ) : booking.status === "cancelled" ? (
            <Notice tone="info" title="Already cancelled">
              This booking was cancelled and the time has been released.
            </Notice>
          ) : (
            <>
              <div className="card stack">
                <h2 className="card__title">{eventType?.title ?? "Your meeting"}</h2>
                <dl className="stack stack--sm" style={{ margin: 0 }}>
                  <div className="summary-line">
                    <dt>When</dt>
                    <dd>
                      {formatDateLabel(new Date(booking.startsAt), settings.timeZone)},{" "}
                      {formatSlotLabel(new Date(booking.startsAt), settings.timeZone)}–
                      {formatSlotLabel(new Date(booking.endsAt), settings.timeZone)} (
                      {settings.timeZone})
                    </dd>
                  </div>
                  <div className="summary-line">
                    <dt>Booked by</dt>
                    <dd>{booking.inviteeName}</dd>
                  </div>
                </dl>
              </div>

              <CancelForm
                publicId={booking.publicId}
                token={token!}
                bookingSlug={eventType?.slug ?? null}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
