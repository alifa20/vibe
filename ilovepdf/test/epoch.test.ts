import { describe, expect, it } from "vitest";
import { invalidate, isCurrent, type Versioned } from "../src/ui/epoch.ts";

describe("run epoch", () => {
  it("keeps a run current when nothing changed while it ran", () => {
    const s: Versioned = { epoch: 0 };
    const started = s.epoch;
    expect(isCurrent(s, started)).toBe(true);
  });

  it("marks a run stale once inputs change mid-run, and clears the old result", () => {
    const s: Versioned = { epoch: 3, result: { files: [] } };
    const started = s.epoch;
    invalidate(s);
    expect(s.result).toBeUndefined();
    expect(isCurrent(s, started)).toBe(false);
  });

  it("stays stale even after several changes", () => {
    const s: Versioned = { epoch: 0 };
    const started = s.epoch;
    invalidate(s);
    invalidate(s);
    expect(isCurrent(s, started)).toBe(false);
    expect(isCurrent(s, s.epoch)).toBe(true);
  });
});
