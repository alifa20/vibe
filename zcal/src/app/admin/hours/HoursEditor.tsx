"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice, type NoticeTone } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import type { AvailabilityRule } from "@/lib/repo";
import { WEEKDAY_NAMES, hhMmToMinutes, minutesToHhMm } from "@/lib/time";

interface Window {
  key: string;
  start: string;
  end: string;
}

type Week = Window[][];

function toWeek(rules: AvailabilityRule[]): Week {
  const week: Week = [[], [], [], [], [], [], []];
  for (const rule of rules) {
    week[rule.weekday]!.push({
      key: `${rule.id}`,
      start: minutesToHhMm(rule.startMinute),
      end: minutesToHhMm(rule.endMinute),
    });
  }
  return week;
}

let nextKey = 0;
const newKey = () => `new-${nextKey++}`;

export function HoursEditor({ rules, timeZone }: { rules: AvailabilityRule[]; timeZone: string }) {
  const router = useRouter();
  const [week, setWeek] = useState<Week>(() => toWeek(rules));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: NoticeTone; title: string; body?: string } | null>(
    null,
  );

  const totalMinutes = week
    .flat()
    .reduce((sum, window) => {
      const start = hhMmToMinutes(window.start);
      const end = hhMmToMinutes(window.end);
      return start !== null && end !== null && end > start ? sum + (end - start) : sum;
    }, 0);

  function update(weekday: number, key: string, patch: Partial<Window>) {
    setWeek((current) =>
      current.map((day, index) =>
        index === weekday
          ? day.map((window) => (window.key === key ? { ...window, ...patch } : window))
          : day,
      ),
    );
  }

  function addWindow(weekday: number) {
    setWeek((current) =>
      current.map((day, index) =>
        index === weekday ? [...day, { key: newKey(), start: "09:00", end: "17:00" }] : day,
      ),
    );
  }

  function removeWindow(weekday: number, key: string) {
    setWeek((current) =>
      current.map((day, index) =>
        index === weekday ? day.filter((window) => window.key !== key) : day,
      ),
    );
  }

  function copyMondayToWeekdays() {
    setWeek((current) => {
      const monday = current[1] ?? [];
      return current.map((day, index) =>
        index >= 2 && index <= 5
          ? monday.map((window) => ({ ...window, key: newKey() }))
          : day,
      );
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    const payload: { weekday: number; start: string; end: string }[] = [];

    week.forEach((day, weekday) => {
      const sorted = [...day].sort(
        (a, b) => (hhMmToMinutes(a.start) ?? 0) - (hhMmToMinutes(b.start) ?? 0),
      );
      let previousEnd = -1;
      for (const window of sorted) {
        const start = hhMmToMinutes(window.start);
        const end = hhMmToMinutes(window.end);
        if (start === null) local[window.key] = "Use a 24-hour time like 09:00.";
        else if (end === null) local[window.key] = "Use a 24-hour time like 17:00.";
        else if (end <= start) local[window.key] = "The end must be after the start.";
        else if (start < previousEnd) local[window.key] = "This overlaps the window before it.";
        else {
          previousEnd = end;
          payload.push({ weekday, start: window.start, end: window.end });
        }
      }
    });

    setErrors(local);
    if (Object.keys(local).length > 0) {
      setMessage({
        tone: "error",
        title: "Some windows need fixing",
        body: "The highlighted times were not saved.",
      });
      return;
    }

    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: payload }),
      });
      const data = (await response.json()) as { message?: string; rules?: AvailabilityRule[] };
      if (!response.ok) {
        setMessage({ tone: "error", title: "Not saved", body: data.message });
        return;
      }
      if (data.rules) setWeek(toWeek(data.rules));
      setMessage({
        tone: "success",
        title:
          payload.length === 0
            ? "Saved. With no working hours set, your links show nothing bookable."
            : `Saved ${payload.length} window(s).`,
      });
      router.refresh();
    } catch {
      setMessage({ tone: "error", title: "Could not reach the server." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card stack" onSubmit={save} noValidate aria-labelledby="hours-heading">
      <div className="row row--between">
        <div>
          <h2 id="hours-heading" className="card__title">
            When are you bookable?
          </h2>
          <p className="card__hint">
            Times are in {timeZone}. Anything in your calendar is subtracted from these hours.
          </p>
        </div>
        <p className="text-small text-muted">
          {Math.round((totalMinutes / 60) * 10) / 10} hours a week
        </p>
      </div>

      {message ? (
        <Notice tone={message.tone} title={message.title}>
          {message.body}
        </Notice>
      ) : null}

      <div className="stack">
        {WEEKDAY_NAMES.map((name, weekday) => {
          const windows = week[weekday] ?? [];
          return (
            <fieldset key={name} className="stack stack--sm">
              <legend>{name}</legend>
              {windows.length === 0 ? (
                <p className="text-small text-muted">Not bookable.</p>
              ) : (
                windows.map((window) => {
                  const error = errors[window.key];
                  const errorId = error ? `${window.key}-error` : undefined;
                  return (
                    <div key={window.key} className="stack stack--sm">
                      <div className="row">
                        <label className="visually-hidden" htmlFor={`${window.key}-start`}>
                          {name} window start
                        </label>
                        <input
                          id={`${window.key}-start`}
                          className="input"
                          style={{ width: "8rem" }}
                          type="time"
                          value={window.start}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={errorId}
                          onChange={(event) =>
                            update(weekday, window.key, { start: event.target.value })
                          }
                        />
                        <span aria-hidden="true">to</span>
                        <label className="visually-hidden" htmlFor={`${window.key}-end`}>
                          {name} window end
                        </label>
                        <input
                          id={`${window.key}-end`}
                          className="input"
                          style={{ width: "8rem" }}
                          type="time"
                          value={window.end}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={errorId}
                          onChange={(event) =>
                            update(weekday, window.key, { end: event.target.value })
                          }
                        />
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => removeWindow(weekday, window.key)}
                        >
                          Remove<span className="visually-hidden"> the {window.start} window on {name}</span>
                        </button>
                      </div>
                      {error ? (
                        <p className="field__error" id={errorId}>
                          {error}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
              <div>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => addWindow(weekday)}
                >
                  Add a window<span className="visually-hidden"> on {name}</span>
                </button>
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="row">
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save working hours
        </SubmitButton>
        <button type="button" className="btn btn--secondary" onClick={copyMondayToWeekdays}>
          Copy Monday to Tue–Fri
        </button>
      </div>
    </form>
  );
}
