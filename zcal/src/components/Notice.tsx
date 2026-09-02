import type { ReactNode } from "react";

export type NoticeTone = "info" | "success" | "error" | "warning";

const ROLE: Record<NoticeTone, "status" | "alert"> = {
  info: "status",
  success: "status",
  error: "alert",
  warning: "status",
};

/**
 * One component for every success, failure and warning message in the app, so
 * they all announce themselves to screen readers the same way.
 */
export function Notice({
  tone = "info",
  title,
  children,
  id,
}: {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className={`notice notice--${tone}`} role={ROLE[tone]} aria-live="polite">
      <div className="notice__body">
        {title ? <p className="notice__title">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
