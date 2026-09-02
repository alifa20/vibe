"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { Field } from "@/components/Field";
import { Notice, type NoticeTone } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import type { EventType } from "@/lib/repo";

interface Props {
  eventTypes: EventType[];
  baseUrl: string;
}

interface FormState {
  slug: string;
  title: string;
  description: string;
  location: string;
  durationMinutes: string;
  slotIntervalMinutes: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  minNoticeMinutes: string;
  maxDaysAhead: string;
  isActive: boolean;
}

const BLANK: FormState = {
  slug: "",
  title: "",
  description: "",
  location: "",
  durationMinutes: "30",
  slotIntervalMinutes: "30",
  bufferBeforeMinutes: "0",
  bufferAfterMinutes: "10",
  minNoticeMinutes: "120",
  maxDaysAhead: "30",
  isActive: true,
};

function toForm(eventType: EventType): FormState {
  return {
    slug: eventType.slug,
    title: eventType.title,
    description: eventType.description,
    location: eventType.location,
    durationMinutes: String(eventType.durationMinutes),
    slotIntervalMinutes: String(eventType.slotIntervalMinutes),
    bufferBeforeMinutes: String(eventType.bufferBeforeMinutes),
    bufferAfterMinutes: String(eventType.bufferAfterMinutes),
    minNoticeMinutes: String(eventType.minNoticeMinutes),
    maxDaysAhead: String(eventType.maxDaysAhead),
    isActive: eventType.isActive,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function LinksManager({ eventTypes, baseUrl }: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: NoticeTone; title: string; body?: string } | null>(
    null,
  );
  const [slugTouched, setSlugTouched] = useState(false);

  function startNew() {
    setEditingId("new");
    setForm(BLANK);
    setErrors({});
    setSlugTouched(false);
    setMessage(null);
  }

  function startEdit(eventType: EventType) {
    setEditingId(eventType.id);
    setForm(toForm(eventType));
    setErrors({});
    setSlugTouched(true);
    setMessage(null);
  }

  function cancel() {
    setEditingId(null);
    setErrors({});
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!form.title.trim()) local.title = "Give this link a title.";
    if (!form.slug.trim()) local.slug = "Add a web address for the link.";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug))
      local.slug = "Use lowercase letters, numbers and single hyphens, like intro-call.";
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    setPending(true);
    setMessage(null);
    const payload = {
      slug: form.slug.trim(),
      title: form.title.trim(),
      description: form.description.trim(),
      location: form.location.trim(),
      durationMinutes: Number(form.durationMinutes),
      slotIntervalMinutes: Number(form.slotIntervalMinutes),
      bufferBeforeMinutes: Number(form.bufferBeforeMinutes),
      bufferAfterMinutes: Number(form.bufferAfterMinutes),
      minNoticeMinutes: Number(form.minNoticeMinutes),
      maxDaysAhead: Number(form.maxDaysAhead),
      isActive: form.isActive,
    };

    try {
      const response = await fetch(
        editingId === "new" ? "/api/admin/event-types" : `/api/admin/event-types/${editingId}`,
        {
          method: editingId === "new" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await response.json()) as { message?: string; fields?: Record<string, string> };
      if (!response.ok) {
        setErrors(data.fields ?? {});
        setMessage({ tone: "error", title: "Not saved", body: data.message });
        return;
      }
      setMessage({
        tone: "success",
        title: editingId === "new" ? `Created "${payload.title}".` : `Saved "${payload.title}".`,
        body: `Share it at ${baseUrl}/book/${payload.slug}`,
      });
      setEditingId(null);
      router.refresh();
    } catch {
      setMessage({ tone: "error", title: "Could not reach the server." });
    } finally {
      setPending(false);
    }
  }

  async function remove(eventType: EventType) {
    const confirmed = window.confirm(
      `Delete "${eventType.title}"?\n\nThe link stops working and its booking records are removed. Meetings already in your calendar stay there.`,
    );
    if (!confirmed) return;

    setPending(true);
    try {
      const response = await fetch(`/api/admin/event-types/${eventType.id}`, { method: "DELETE" });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setMessage({ tone: "error", title: "Not deleted", body: data.message });
        return;
      }
      setMessage({ tone: "success", title: `Deleted "${eventType.title}".` });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const numberFields: { key: keyof FormState; label: string; hint: string; min: number; max: number }[] = [
    { key: "durationMinutes", label: "Meeting length (minutes)", hint: "How long the meeting runs.", min: 5, max: 480 },
    { key: "slotIntervalMinutes", label: "Offer a slot every (minutes)", hint: "The spacing between start times.", min: 5, max: 240 },
    { key: "bufferBeforeMinutes", label: "Buffer before (minutes)", hint: "Keep this much clear beforehand.", min: 0, max: 240 },
    { key: "bufferAfterMinutes", label: "Buffer after (minutes)", hint: "Keep this much clear afterwards.", min: 0, max: 240 },
    { key: "minNoticeMinutes", label: "Minimum notice (minutes)", hint: "Nothing bookable sooner than this.", min: 0, max: 20160 },
    { key: "maxDaysAhead", label: "Bookable up to (days ahead)", hint: "How far into the future the link shows.", min: 1, max: 365 },
  ];

  return (
    <div className="stack stack--lg">
      {message ? (
        <Notice tone={message.tone} title={message.title}>
          {message.body}
        </Notice>
      ) : null}

      {editingId === null ? (
        <div>
          <button type="button" className="btn" onClick={startNew}>
            New booking link
          </button>
        </div>
      ) : (
        <section className="card stack" aria-labelledby="form-heading">
          <h2 id="form-heading" className="card__title">
            {editingId === "new" ? "New booking link" : "Edit booking link"}
          </h2>

          <form className="stack" onSubmit={save} noValidate>
            <Field id="link-title" label="Title" error={errors.title}>
              {(props) => (
                <input
                  {...props}
                  className="input"
                  value={form.title}
                  maxLength={120}
                  placeholder="30 minute intro call"
                  onChange={(event) => {
                    const title = event.target.value;
                    setForm((current) => ({
                      ...current,
                      title,
                      slug: slugTouched ? current.slug : slugify(title),
                    }));
                  }}
                />
              )}
            </Field>

            <Field
              id="link-slug"
              label="Web address"
              hint={`People will book at ${baseUrl}/book/${form.slug || "…"}`}
              error={errors.slug}
            >
              {(props) => (
                <input
                  {...props}
                  className="input mono"
                  value={form.slug}
                  maxLength={60}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setForm({ ...form, slug: slugify(event.target.value) });
                  }}
                />
              )}
            </Field>

            <Field
              id="link-description"
              label="What should people know?"
              hint="Shown on the booking page, above the times."
              error={errors.description}
            >
              {(props) => (
                <textarea
                  {...props}
                  className="textarea"
                  value={form.description}
                  maxLength={2000}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              )}
            </Field>

            <Field
              id="link-location"
              label="Where does it happen?"
              hint="A phone number, a room, or how you will send a video link. zcal does not create meeting links."
              error={errors.location}
            >
              {(props) => (
                <input
                  {...props}
                  className="input"
                  value={form.location}
                  maxLength={300}
                  placeholder="Video call — link sent by hand after booking"
                  onChange={(event) => setForm({ ...form, location: event.target.value })}
                />
              )}
            </Field>

            <fieldset className="stack">
              <legend>Timing</legend>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
                {numberFields.map((field) => (
                  <Field
                    key={field.key}
                    id={`link-${field.key}`}
                    label={field.label}
                    hint={field.hint}
                    error={errors[field.key]}
                  >
                    {(props) => (
                      <input
                        {...props}
                        className="input"
                        type="number"
                        inputMode="numeric"
                        min={field.min}
                        max={field.max}
                        value={form[field.key] as string}
                        onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </fieldset>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
              <span>
                <strong>Accepting bookings</strong>
                <br />
                <span className="text-small text-muted">
                  Turn this off to pause the link without deleting it. Visitors see a clear message.
                </span>
              </span>
            </label>

            <div className="row">
              <SubmitButton pending={pending} pendingLabel="Saving…">
                {editingId === "new" ? "Create link" : "Save changes"}
              </SubmitButton>
              <button type="button" className="btn btn--ghost" onClick={cancel} disabled={pending}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card stack" aria-labelledby="list-heading">
        <h2 id="list-heading" className="card__title">
          All booking links
        </h2>

        {eventTypes.length === 0 ? (
          <div className="empty">
            <p className="empty__title">No booking links yet</p>
            <p>
              A booking link turns your free time into a page you can send someone. Create one and
              you have finished the setup.
            </p>
          </div>
        ) : (
          <ul className="list">
            {eventTypes.map((eventType) => (
              <li key={eventType.id} className="list__item">
                <div className="list__main">
                  <p className="list__title">
                    {eventType.title}{" "}
                    {eventType.isSample ? <span className="tag tag--sample">Sample</span> : null}{" "}
                    {eventType.isActive ? (
                      <span className="tag tag--live">Live</span>
                    ) : (
                      <span className="tag">Paused</span>
                    )}
                  </p>
                  <p className="list__meta">
                    {eventType.durationMinutes} min · every {eventType.slotIntervalMinutes} min ·{" "}
                    {eventType.minNoticeMinutes} min notice · up to {eventType.maxDaysAhead} days ahead
                  </p>
                  <p className="list__meta mono">/book/{eventType.slug}</p>
                </div>
                <span className="row">
                  <CopyButton value={`${baseUrl}/book/${eventType.slug}`} />
                  <a className="btn btn--secondary btn--sm" href={`/book/${eventType.slug}`}>
                    Preview
                  </a>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => startEdit(eventType)}
                  >
                    Edit<span className="visually-hidden"> {eventType.title}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={pending}
                    onClick={() => void remove(eventType)}
                  >
                    Delete<span className="visually-hidden"> {eventType.title}</span>
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
