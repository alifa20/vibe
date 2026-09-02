"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Notice, type NoticeTone } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import type { Settings } from "@/lib/repo";

export function ProfileForm({
  settings,
  timeZones,
}: {
  settings: Settings;
  timeZones: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    ownerName: settings.ownerName,
    ownerEmail: settings.ownerEmail,
    timeZone: settings.timeZone,
    calendarName: settings.calendarName,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: NoticeTone; title: string; body?: string } | null>(
    null,
  );

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!form.calendarName.trim()) local.calendarName = "Give your calendar a name.";
    if (form.ownerEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.ownerEmail.trim())) {
      local.ownerEmail = "Enter a valid email address, or leave it empty.";
    }
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerName: form.ownerName.trim(),
          ownerEmail: form.ownerEmail.trim(),
          timeZone: form.timeZone,
          calendarName: form.calendarName.trim(),
        }),
      });
      const data = (await response.json()) as { message?: string; fields?: Record<string, string> };
      if (!response.ok) {
        setErrors(data.fields ?? {});
        setMessage({ tone: "error", title: "Not saved", body: data.message });
        return;
      }
      setMessage({
        tone: "success",
        title: "Saved.",
        body: `Working hours and every booking page now read in ${form.timeZone}.`,
      });
      router.refresh();
    } catch {
      setMessage({ tone: "error", title: "Could not reach the server." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card stack" onSubmit={save} noValidate aria-labelledby="profile-heading">
      <div>
        <h2 id="profile-heading" className="card__title">
          Your details
        </h2>
        <p className="card__hint">
          Your name is shown on booking pages. Your email is stored locally and used for nothing
          else — zcal sends no mail.
        </p>
      </div>

      {message ? (
        <Notice tone={message.tone} title={message.title}>
          {message.body}
        </Notice>
      ) : null}

      <Field id="owner-name" label="Your name" error={errors.ownerName}>
        {(props) => (
          <input
            {...props}
            className="input"
            value={form.ownerName}
            maxLength={120}
            autoComplete="name"
            onChange={(event) => setForm({ ...form, ownerName: event.target.value })}
          />
        )}
      </Field>

      <Field
        id="owner-email"
        label="Your email"
        hint="Optional. Kept locally, never sent anywhere."
        error={errors.ownerEmail}
      >
        {(props) => (
          <input
            {...props}
            className="input"
            type="email"
            value={form.ownerEmail}
            maxLength={200}
            autoComplete="email"
            onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })}
          />
        )}
      </Field>

      <Field id="calendar-name" label="Calendar name" error={errors.calendarName}>
        {(props) => (
          <input
            {...props}
            className="input"
            value={form.calendarName}
            maxLength={120}
            onChange={(event) => setForm({ ...form, calendarName: event.target.value })}
          />
        )}
      </Field>

      <Field
        id="time-zone"
        label="Timezone"
        hint="Working hours are written in this zone, and visitors see times converted to their own."
        error={errors.timeZone}
      >
        {(props) => (
          <select
            {...props}
            className="select"
            value={form.timeZone}
            onChange={(event) => setForm({ ...form, timeZone: event.target.value })}
          >
            {timeZones.includes(form.timeZone) ? null : (
              <option value={form.timeZone}>{form.timeZone}</option>
            )}
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save details
        </SubmitButton>
      </div>
    </form>
  );
}
