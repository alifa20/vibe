"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import type { AvailabilityResponse } from "@/lib/scheduling";
import { browserTimeZone, formatDateLabel, formatSlotLabel } from "@/lib/time";

interface Props {
  initial: AvailabilityResponse;
  /** The owner's local date the first page of results started from. */
  initialFrom: string;
  daysPerPage: number;
}

const EMPTY_COPY: Record<NonNullable<AvailabilityResponse["emptyReason"]>, { title: string; body: string }> = {
  no_working_hours: {
    title: "No times are published yet",
    body: "The owner of this calendar has not set any working hours. Nothing can be booked until they do.",
  },
  fully_booked: {
    title: "Nothing free in these dates",
    body: "Every slot in this window is already taken. Try looking further ahead.",
  },
  outside_window: {
    title: "Nothing free in these dates",
    body: "There is nothing bookable in this window. Try a different set of dates.",
  },
};

export function BookingFlow({ initial, initialFrom, daysPerPage }: Props) {
  const router = useRouter();
  const [availability, setAvailability] = useState(initial);
  const [from, setFrom] = useState(initialFrom);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(initial.days[0]?.date ?? null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", email: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [viewerZone, setViewerZone] = useState<string | null>(null);
  useEffect(() => {
    const zone = browserTimeZone();
    setViewerZone(zone === availability.timeZone ? null : zone);
  }, [availability.timeZone]);

  const days = availability.days;
  const activeDay = days.find((day) => day.date === selectedDate) ?? days[0] ?? null;

  async function loadRange(nextFrom: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(
        `/api/availability/${encodeURIComponent(availability.eventType.slug)}?from=${nextFrom}&days=${daysPerPage}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as AvailabilityResponse & { message?: string };
      if (!response.ok) {
        setLoadError(data.message ?? "Could not load times. Try again.");
        return;
      }
      setAvailability(data);
      setFrom(nextFrom);
      setSelectedDate(data.days[0]?.date ?? null);
      setSelectedSlot(null);
    } catch {
      setLoadError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function shiftFrom(days: number): string {
    const [year, month, day] = from.split("-").map(Number);
    const shifted = new Date(Date.UTC(year!, month! - 1, day!) + days * 86_400_000);
    return shifted.toISOString().slice(0, 10);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSlot) return;

    const local: Record<string, string> = {};
    if (!form.name.trim()) local.name = "Tell us your name.";
    if (!form.email.trim()) local.email = "We need an email address to confirm.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()))
      local.email = "That does not look like an email address.";
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: availability.eventType.slug,
          startsAt: selectedSlot,
          name: form.name.trim(),
          email: form.email.trim(),
          notes: form.notes.trim(),
        }),
      });
      const data = (await response.json()) as {
        message?: string;
        fields?: Record<string, string>;
        publicId?: string;
        cancelUrl?: string;
      };

      if (!response.ok) {
        setErrors(data.fields ?? {});
        setSubmitError(data.message ?? "That booking did not go through.");
        // The slot may have gone while the form was open: refresh the times.
        if (response.status === 409) {
          setSelectedSlot(null);
          await loadRange(from);
        }
        return;
      }

      // Carry the one-time cancellation token straight to the confirmation
      // page, so the invitee leaves with a link they can actually use.
      const token = data.cancelUrl ? new URL(data.cancelUrl).searchParams.get("token") : null;
      const query = token ? `?token=${encodeURIComponent(token)}` : "";
      router.push(`/book/${availability.eventType.slug}/confirmed/${data.publicId}${query}`);
    } catch {
      setSubmitError("Could not reach the server. Nothing has been booked — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack stack--lg">
      <div className="booking-layout">
        <section className="card stack" aria-labelledby="dates-heading">
          <div className="row row--between">
            <h2 id="dates-heading" className="card__title">
              Pick a day
            </h2>
            {loading ? (
              <span className="row text-small text-muted" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                Loading
              </span>
            ) : null}
          </div>

          {loadError ? <Notice tone="error">{loadError}</Notice> : null}

          {loading ? (
            <div className="stack stack--sm" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((index) => (
                <div key={index} className="skeleton" style={{ height: "2.75rem" }} />
              ))}
            </div>
          ) : days.length === 0 ? (
            <div className="empty">
              <p className="empty__title">
                {EMPTY_COPY[availability.emptyReason ?? "outside_window"].title}
              </p>
              <p>{EMPTY_COPY[availability.emptyReason ?? "outside_window"].body}</p>
            </div>
          ) : (
            <div className="day-list" role="group" aria-label="Available days">
              {days.map((day) => {
                const label = formatDateLabel(new Date(day.slots[0]!.startsAt), availability.timeZone);
                return (
                  <button
                    key={day.date}
                    type="button"
                    className="day-button"
                    data-testid="day"
                    data-date={day.date}
                    aria-pressed={day.date === activeDay?.date}
                    onClick={() => {
                      setSelectedDate(day.date);
                      setSelectedSlot(null);
                    }}
                  >
                    <span>{label}</span>
                    <span className="day-button__count">
                      {day.slots.length} slot{day.slots.length === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="row">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={loading}
              onClick={() => void loadRange(shiftFrom(-daysPerPage))}
            >
              ← Earlier
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={loading}
              onClick={() => void loadRange(shiftFrom(daysPerPage))}
            >
              Later →
            </button>
          </div>

          <p className="text-small text-muted">
            Times shown in <strong>{availability.timeZone}</strong>
            {viewerZone ? (
              <>
                {" "}
                — your device is set to <strong>{viewerZone}</strong>, so check the day carefully.
              </>
            ) : null}
          </p>
        </section>

        <section className="card stack" aria-labelledby="times-heading">
          <h2 id="times-heading" className="card__title">
            {activeDay
              ? `Times on ${formatDateLabel(new Date(activeDay.slots[0]!.startsAt), availability.timeZone)}`
              : "Times"}
          </h2>

          {!activeDay ? (
            <div className="empty">
              <p className="empty__title">Nothing to choose yet</p>
              <p>Pick a day on the left, or look further ahead.</p>
            </div>
          ) : (
            <div className="slot-grid" role="group" aria-label="Available times">
              {activeDay.slots.map((slot) => (
                <button
                  key={slot.startsAt}
                  type="button"
                  className="slot-button"
                  data-testid="slot"
                  data-start={slot.startsAt}
                  aria-pressed={slot.startsAt === selectedSlot}
                  onClick={() => {
                    setSelectedSlot(slot.startsAt);
                    setSubmitError(null);
                  }}
                >
                  {formatSlotLabel(new Date(slot.startsAt), availability.timeZone)}
                  <span className="visually-hidden">
                    , {availability.eventType.durationMinutes} minutes
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {selectedSlot ? (
        <section className="card stack" aria-labelledby="details-heading">
          <h2 id="details-heading" className="card__title">
            Your details
          </h2>

          <dl className="stack stack--sm" style={{ margin: 0 }}>
            <div className="summary-line">
              <dt>When</dt>
              <dd>
                {formatDateLabel(new Date(selectedSlot), availability.timeZone)},{" "}
                {formatSlotLabel(new Date(selectedSlot), availability.timeZone)} (
                {availability.timeZone})
              </dd>
            </div>
            <div className="summary-line">
              <dt>How long</dt>
              <dd>{availability.eventType.durationMinutes} minutes</dd>
            </div>
            {availability.eventType.location ? (
              <div className="summary-line">
                <dt>Where</dt>
                <dd>{availability.eventType.location}</dd>
              </div>
            ) : null}
          </dl>

          {submitError ? (
            <Notice tone="error" title="Not booked">
              {submitError}
            </Notice>
          ) : null}

          <form className="stack" onSubmit={submit} noValidate>
            <Field id="booking-name" label="Your name" error={errors.name}>
              {(props) => (
                <input
                  {...props}
                  className="input"
                  value={form.name}
                  maxLength={120}
                  autoComplete="name"
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              )}
            </Field>

            <Field
              id="booking-email"
              label="Your email"
              hint="Kept on the owner's machine. No mail is sent by this app."
              error={errors.email}
            >
              {(props) => (
                <input
                  {...props}
                  className="input"
                  type="email"
                  value={form.email}
                  maxLength={200}
                  autoComplete="email"
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              )}
            </Field>

            <Field
              id="booking-notes"
              label="Anything they should know?"
              hint="Optional."
              error={errors.notes}
            >
              {(props) => (
                <textarea
                  {...props}
                  className="textarea"
                  value={form.notes}
                  maxLength={1000}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                />
              )}
            </Field>

            <div className="row">
              <SubmitButton pending={submitting} pendingLabel="Reserving…">
                Confirm this time
              </SubmitButton>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={submitting}
                onClick={() => setSelectedSlot(null)}
              >
                Choose a different time
              </button>
            </div>
          </form>
        </section>
      ) : (
        <p className="text-small text-muted" aria-live="polite">
          Choose a time above to continue.
        </p>
      )}
    </div>
  );
}
