// A run's result belongs to the inputs and options it started with. Anything that changes those
// bumps the tool's epoch, so a run that finishes afterwards can tell its result is stale.

export interface Versioned {
  epoch: number;
  result?: unknown;
}

/** The inputs changed: drop the shown result and mark any in-flight run as stale. */
export function invalidate(s: Versioned): void {
  s.epoch++;
  s.result = undefined;
}

/** True while nothing has invalidated `s` since `captured` was read from it. */
export const isCurrent = (s: Versioned, captured: number): boolean => s.epoch === captured;
