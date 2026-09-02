"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field } from "@/components/Field";
import { Notice, type NoticeTone } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import type { SampleDataCounts } from "@/lib/repo";

interface Props {
  sample: SampleDataCounts;
  databasePath: string;
}

type Busy = "idle" | "importing" | "removing-sample" | "seeding" | "resetting";

export function DataManager({ sample, databasePath }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirmText, setConfirmText] = useState("");
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [message, setMessage] = useState<{ tone: NoticeTone; title: string; body?: string } | null>(
    null,
  );

  async function importBackup(file: File) {
    setBusy("importing");
    setMessage(null);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        setMessage({
          tone: "error",
          title: "That file is not valid JSON",
          body: "Nothing was changed. Pick a file exported from zcal.",
        });
        return;
      }

      const response = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, payload }),
      });
      const data = (await response.json()) as {
        message?: string;
        eventTypes?: number;
        availabilityRules?: number;
        calendarEvents?: number;
        bookings?: number;
        skipped?: string[];
      };
      if (!response.ok) {
        setMessage({ tone: "error", title: "Nothing was imported", body: data.message });
        return;
      }
      setMessage({
        tone: "success",
        title: `Imported ${data.eventTypes ?? 0} links, ${data.availabilityRules ?? 0} working-hours rows, ${data.calendarEvents ?? 0} events and ${data.bookings ?? 0} bookings.`,
        body: data.skipped?.length
          ? `${data.skipped.length} item(s) were skipped. First: ${data.skipped[0]}`
          : undefined,
      });
      router.refresh();
    } catch {
      setMessage({ tone: "error", title: "Could not read that file." });
    } finally {
      setBusy("idle");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removeSample() {
    setBusy("removing-sample");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/sample-data", { method: "DELETE" });
      const data = (await response.json()) as { removed?: SampleDataCounts; message?: string };
      if (!response.ok) {
        setMessage({ tone: "error", title: "Not removed", body: data.message });
        return;
      }
      const removed = data.removed;
      setMessage({
        tone: "success",
        title: "Sample data deleted.",
        body: removed
          ? `Removed ${removed.eventTypes} links, ${removed.availabilityRules} working-hours rows, ${removed.calendarEvents} events and ${removed.bookings} bookings.`
          : undefined,
      });
      router.refresh();
    } finally {
      setBusy("idle");
    }
  }

  async function addSample() {
    setBusy("seeding");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/sample-data", { method: "POST" });
      const data = (await response.json()) as { alreadyPresent?: boolean; message?: string };
      if (!response.ok) {
        setMessage({ tone: "error", title: "Not added", body: data.message });
        return;
      }
      setMessage({
        tone: data.alreadyPresent ? "info" : "success",
        title: data.alreadyPresent ? "Sample data is already here." : "Sample data added.",
        body: "Every sample row is labelled [Sample] and can be deleted in one click.",
      });
      router.refresh();
    } finally {
      setBusy("idle");
    }
  }

  async function resetEverything(event: React.FormEvent) {
    event.preventDefault();
    if (confirmText !== "DELETE EVERYTHING") {
      setConfirmError("Type DELETE EVERYTHING exactly, in capitals.");
      return;
    }
    setConfirmError(undefined);
    setBusy("resetting");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      const data = (await response.json()) as { message?: string; fields?: Record<string, string> };
      if (!response.ok) {
        setConfirmError(data.fields?.confirm);
        setMessage({ tone: "error", title: "Nothing was deleted", body: data.message });
        return;
      }
      setConfirmText("");
      setMessage({
        tone: "success",
        title: "Everything deleted.",
        body: "Booking links, working hours, calendar events and bookings are gone. Your profile settings are still here.",
      });
      router.refresh();
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

      <section className="card stack" aria-labelledby="export-heading">
        <div>
          <h2 id="export-heading" className="card__title">
            Take your data with you
          </h2>
          <p className="card__hint">
            The JSON export is everything: your profile, links, working hours, every calendar event
            and every booking. Import it into another copy of zcal and you have moved house.
          </p>
        </div>
        <div className="row">
          <a className="btn" href="/api/admin/export" download>
            Export everything (JSON)
          </a>
          <a className="btn btn--secondary" href="/api/admin/export/ics" download>
            Export calendar (.ics)
          </a>
        </div>
        <p className="text-small text-muted">
          Cancellation tokens are left out of the export on purpose — they are secrets that belonged
          to one invitee each. Imported bookings get fresh ones.
        </p>
      </section>

      <section className="card stack" aria-labelledby="import-heading">
        <div>
          <h2 id="import-heading" className="card__title">
            Bring data back in
          </h2>
          <p className="card__hint">
            Choose a <span className="mono">zcal-backup-*.json</span> file. It is fully validated
            before anything is written — if any of it is unreadable, nothing changes.
          </p>
        </div>

        <fieldset className="stack stack--sm">
          <legend>How should it be merged?</legend>
          <label className="checkbox">
            <input
              type="radio"
              name="import-mode"
              checked={mode === "merge"}
              onChange={() => setMode("merge")}
            />
            <span>
              <strong>Merge</strong>
              <br />
              <span className="text-small text-muted">
                Keep what is here. Links that already exist are left alone; working hours are
                replaced by the file&rsquo;s.
              </span>
            </span>
          </label>
          <label className="checkbox">
            <input
              type="radio"
              name="import-mode"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            <span>
              <strong>Replace</strong>
              <br />
              <span className="text-small text-muted">
                Delete everything here first, then import. Use this when restoring a backup.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="row">
          <label className="btn btn--secondary" htmlFor="backup-file">
            {busy === "importing" ? "Importing…" : "Choose a backup file"}
          </label>
          <input
            ref={fileInput}
            id="backup-file"
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            disabled={busy !== "idle"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importBackup(file);
            }}
          />
        </div>
      </section>

      <section className="card stack" aria-labelledby="sample-heading">
        <div>
          <h2 id="sample-heading" className="card__title">
            Sample data
          </h2>
          <p className="card__hint">
            Demo content so the app is worth looking at on first run. Every row carries a{" "}
            <span className="mono">[Sample]</span> label and nothing depends on it.
          </p>
        </div>

        {sample.total === 0 ? (
          <>
            <Notice tone="info" title="No sample data here">
              This calendar contains only your own data.
            </Notice>
            <div>
              <SubmitButton
                type="button"
                className="btn btn--secondary"
                pending={busy === "seeding"}
                pendingLabel="Adding…"
                onClick={addSample}
              >
                Add sample data back
              </SubmitButton>
            </div>
          </>
        ) : (
          <>
            <ul className="list">
              <li className="list__item">
                <span className="list__main">Booking links</span>
                <strong>{sample.eventTypes}</strong>
              </li>
              <li className="list__item">
                <span className="list__main">Working-hours rows</span>
                <strong>{sample.availabilityRules}</strong>
              </li>
              <li className="list__item">
                <span className="list__main">Calendar events</span>
                <strong>{sample.calendarEvents}</strong>
              </li>
              <li className="list__item">
                <span className="list__main">Bookings</span>
                <strong>{sample.bookings}</strong>
              </li>
            </ul>
            <div>
              <SubmitButton
                type="button"
                className="btn"
                pending={busy === "removing-sample"}
                pendingLabel="Deleting…"
                onClick={removeSample}
              >
                Delete all {sample.total} sample rows
              </SubmitButton>
            </div>
          </>
        )}
      </section>

      <section className="card stack" aria-labelledby="where-heading">
        <div>
          <h2 id="where-heading" className="card__title">
            Where your data lives
          </h2>
          <p className="card__hint">
            One SQLite file. Copy it and you have a complete backup; delete it and nothing of yours
            remains.
          </p>
        </div>
        <p className="mono pre-wrap">{databasePath}</p>
        <p className="text-small text-muted">
          Stop the server before copying the file, so the write-ahead log is checkpointed first.
        </p>
      </section>

      <section className="card stack" aria-labelledby="danger-heading">
        <div>
          <h2 id="danger-heading" className="card__title">
            Delete everything
          </h2>
          <p className="card__hint">
            Removes all booking links, working hours, calendar events and bookings. Your profile
            settings stay. This cannot be undone — export first.
          </p>
        </div>
        <form className="stack" onSubmit={resetEverything} noValidate>
          <Field
            id="confirm-delete"
            label="Type DELETE EVERYTHING to confirm"
            error={confirmError}
          >
            {(props) => (
              <input
                {...props}
                className="input mono"
                value={confirmText}
                autoComplete="off"
                onChange={(event) => {
                  setConfirmText(event.target.value);
                  setConfirmError(undefined);
                }}
              />
            )}
          </Field>
          <div>
            <SubmitButton
              className="btn btn--danger"
              pending={busy === "resetting"}
              pendingLabel="Deleting…"
              disabled={confirmText !== "DELETE EVERYTHING"}
            >
              Delete everything
            </SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}
