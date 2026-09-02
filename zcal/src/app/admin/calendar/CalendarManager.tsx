"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field } from "@/components/Field";
import { Notice, type NoticeTone } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDateTimeLabel, formatSlotLabel, hhMmToMinutes, isoDateInZone, parseIsoDate, zonedTimeToUtc } from "@/lib/time";
import type { CalendarEvent } from "@/lib/repo";

interface Props {
  events: CalendarEvent[];
  timeZone: string;
  hasFeed: boolean;
}

type Message = { tone: NoticeTone; title: string; body?: string } | null;

export function CalendarManager({ events, timeZone, hasFeed }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const today = isoDateInZone(new Date(), timeZone);
  const [form, setForm] = useState({ title: "", date: today, start: "09:00", end: "10:00" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"idle" | "adding" | "importing" | "syncing" | "deleting">("idle");
  const [message, setMessage] = useState<Message>(null);

  function validate(): { startsAt: string; endsAt: string } | null {
    const next: Record<string, string> = {};
    if (!form.title.trim()) next.title = "Give the block a name so you recognise it later.";
    const date = parseIsoDate(form.date);
    if (!date) next.date = "Pick a date.";
    const startMinutes = hhMmToMinutes(form.start);
    const endMinutes = hhMmToMinutes(form.end);
    if (startMinutes === null) next.start = "Use a 24-hour time like 09:30.";
    if (endMinutes === null) next.end = "Use a 24-hour time like 17:00.";
    if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
      next.end = "The end must be after the start.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !date || startMinutes === null || endMinutes === null) {
      return null;
    }
    const startsAt = zonedTimeToUtc(
      date.year, date.month, date.day,
      Math.floor(startMinutes / 60), startMinutes % 60, timeZone,
    );
    const endsAt = zonedTimeToUtc(
      date.year, date.month, date.day,
      Math.floor(endMinutes / 60), endMinutes % 60, timeZone,
    );
    return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  }

  async function addBlock(event: React.FormEvent) {
    event.preventDefault();
    const times = validate();
    if (!times) return;

    setBusy("adding");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.title.trim(), description: "", location: "", ...times }),
      });
      const data = (await response.json()) as { message?: string; fields?: Record<string, string> };
      if (!response.ok) {
        setErrors(data.fields ?? {});
        setMessage({ tone: "error", title: "Could not add that block", body: data.message });
        return;
      }
      setForm({ ...form, title: "" });
      setMessage({ tone: "success", title: `Blocked out "${form.title.trim()}".` });
      router.refresh();
    } catch {
      setMessage({ tone: "error", title: "Could not reach the server.", body: "Is it still running?" });
    } finally {
      setBusy("idle");
    }
  }

  async function removeEvent(id: number, title: string) {
    setBusy("deleting");
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/events/${id}`, { method: "DELETE" });
      const data = (await response.json()) as { message?: string; freedSlot?: boolean };
      if (!response.ok) {
        setMessage({ tone: "error", title: "Could not delete that event", body: data.message });
        return;
      }
      setMessage({
        tone: "success",
        title: `Removed "${title}".`,
        body: data.freedSlot
          ? "That was a booked meeting. The time is free again, and the booking record stays on file."
          : "That time is bookable again.",
      });
      router.refresh();
    } finally {
      setBusy("idle");
    }
  }

  async function importFile(file: File) {
    setBusy("importing");
    setMessage(null);
    try {
      const text = await file.text();
      const response = await fetch("/api/admin/calendar/import", {
        method: "POST",
        headers: { "Content-Type": "text/calendar" },
        body: text,
      });
      const data = (await response.json()) as {
        message?: string;
        imported?: number;
        updated?: number;
        skipped?: string[];
      };
      if (!response.ok) {
        setMessage({ tone: "error", title: "Nothing was imported", body: data.message });
        return;
      }
      setMessage({
        tone: "success",
        title: `Imported ${data.imported ?? 0} new event(s), updated ${data.updated ?? 0}.`,
        body: data.skipped?.length ? `Skipped ${data.skipped.length}: ${data.skipped[0]}` : undefined,
      });
      router.refresh();
    } catch {
      setMessage({ tone: "error", title: "Could not read that file." });
    } finally {
      setBusy("idle");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function syncFeed() {
    setBusy("syncing");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/calendar/sync", { method: "POST" });
      const data = (await response.json()) as {
        message?: string;
        imported?: number;
        updated?: number;
        skipped?: string[];
      };
      if (!response.ok) {
        setMessage({ tone: "error", title: "Sync did not run", body: data.message });
        return;
      }
      setMessage({
        tone: "success",
        title: `Pulled ${data.imported ?? 0} new event(s), updated ${data.updated ?? 0}.`,
        body: data.skipped?.length ? `Skipped ${data.skipped.length}: ${data.skipped[0]}` : undefined,
      });
      router.refresh();
    } catch {
      setMessage({ tone: "error", title: "Could not reach the server." });
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div className="stack stack--lg">
      {message ? (
        <Notice tone={message.tone} title={message.title}>
          {message.body}
        </Notice>
      ) : null}

      <section className="card stack" aria-labelledby="add-heading">
        <div>
          <h2 id="add-heading" className="card__title">
            Block out some time
          </h2>
          <p className="card__hint">
            Anything in this calendar makes you unavailable. Times are in {timeZone}.
          </p>
        </div>

        <form className="stack" onSubmit={addBlock} noValidate>
          <Field id="block-title" label="What is it?" error={errors.title}>
            {(props) => (
              <input
                {...props}
                className="input"
                value={form.title}
                placeholder="Dentist"
                maxLength={200}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            )}
          </Field>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))" }}>
            <Field id="block-date" label="Date" error={errors.date}>
              {(props) => (
                <input
                  {...props}
                  className="input"
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                />
              )}
            </Field>
            <Field id="block-start" label="From" error={errors.start}>
              {(props) => (
                <input
                  {...props}
                  className="input"
                  type="time"
                  value={form.start}
                  onChange={(event) => setForm({ ...form, start: event.target.value })}
                />
              )}
            </Field>
            <Field id="block-end" label="To" error={errors.end}>
              {(props) => (
                <input
                  {...props}
                  className="input"
                  type="time"
                  value={form.end}
                  onChange={(event) => setForm({ ...form, end: event.target.value })}
                />
              )}
            </Field>
          </div>

          <div>
            <SubmitButton pending={busy === "adding"} pendingLabel="Adding…">
              Add to calendar
            </SubmitButton>
          </div>
        </form>
      </section>

      <section className="card stack" aria-labelledby="import-heading">
        <div>
          <h2 id="import-heading" className="card__title">
            Bring in another calendar
          </h2>
          <p className="card__hint">
            Upload an <span className="mono">.ics</span> file exported from any calendar app. Events
            are matched on their UID, so importing the same file twice updates rather than
            duplicates.
          </p>
        </div>

        <div className="row">
          <label className="btn btn--secondary" htmlFor="ics-file">
            {busy === "importing" ? "Reading…" : "Choose an .ics file"}
          </label>
          <input
            ref={fileInput}
            id="ics-file"
            className="visually-hidden"
            type="file"
            accept=".ics,text/calendar"
            disabled={busy !== "idle"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
          <a className="btn btn--ghost btn--sm" href="/api/admin/export/ics">
            Export this calendar as .ics
          </a>
        </div>

        <hr className="divider" />

        <div className="stack stack--sm">
          <p className="card__hint">
            <strong>Calendar feed (optional).</strong>{" "}
            {hasFeed
              ? "A read-only feed is configured in .env. Pulling is manual — zcal never polls it and never writes to it."
              : "No feed is configured. zcal works exactly the same without one; you keep this calendar by hand or by uploading .ics files. To enable it, set ZCAL_ICS_FEED_URL in .env and restart."}
          </p>
          <div>
            <SubmitButton
              type="button"
              className="btn btn--secondary"
              pending={busy === "syncing"}
              pendingLabel="Pulling…"
              disabled={!hasFeed}
              onClick={syncFeed}
            >
              Sync from feed
            </SubmitButton>
          </div>
        </div>
      </section>

      <section className="card stack" aria-labelledby="events-heading">
        <div className="row row--between">
          <h2 id="events-heading" className="card__title">
            What is in the calendar
          </h2>
          <span className="text-small text-muted">{events.length} event(s), next 60 days</span>
        </div>

        {events.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Your calendar is empty</p>
            <p>
              Every hour inside your working hours is bookable. Add a block above, or import an
              existing calendar, to protect time.
            </p>
          </div>
        ) : (
          <ul className="list">
            {events.map((event) => (
              <li key={event.id} className="list__item">
                <div className="list__main">
                  <p className="list__title">
                    {event.title}{" "}
                    {event.isSample ? <span className="tag tag--sample">Sample</span> : null}
                  </p>
                  <p className="list__meta">
                    {formatDateTimeLabel(new Date(event.startsAt), timeZone)}–
                    {formatSlotLabel(new Date(event.endsAt), timeZone)}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                </div>
                <span className="row">
                  {event.source === "booking" ? (
                    <span className="tag tag--booking">Booked</span>
                  ) : event.source === "ics" ? (
                    <span className="tag">Imported</span>
                  ) : (
                    <span className="tag">Added by you</span>
                  )}
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={busy !== "idle"}
                    onClick={() => void removeEvent(event.id, event.title)}
                  >
                    Delete<span className="visually-hidden"> {event.title}</span>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
