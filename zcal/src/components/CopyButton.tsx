"use client";

import { useEffect, useState } from "react";

/**
 * Copies a booking link. Falls back to selecting the text when the clipboard
 * API is unavailable (it needs a secure context), so the button is never a
 * dead end.
 */
export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <span className="row" style={{ gap: "0.4rem" }}>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        {label}
      </button>
      <span aria-live="polite" className="text-small text-muted">
        {state === "copied" ? "Copied." : null}
        {state === "failed" ? "Could not copy — select the address and copy it by hand." : null}
      </span>
    </span>
  );
}
