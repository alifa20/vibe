"use client";

import type { ReactNode } from "react";

/**
 * A button that shows and announces its own pending state, so every action in
 * the app has a visible "working on it".
 */
export function SubmitButton({
  pending,
  children,
  pendingLabel = "Working…",
  className = "btn",
  disabled,
  type = "submit",
  onClick,
}: {
  pending?: boolean;
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      className={className}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      {pending ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
