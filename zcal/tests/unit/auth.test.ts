import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSessionToken,
  randomPublicId,
  randomToken,
  verifyCancelToken,
  verifyPassword,
  verifySessionToken,
} from "@/lib/auth";
import { configProblems } from "@/lib/env";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.ZCAL_OWNER_PASSWORD = "a-long-enough-passphrase";
  process.env.ZCAL_SESSION_SECRET = "0".repeat(64);
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("passphrase", () => {
  it("accepts only the exact passphrase", () => {
    expect(verifyPassword("a-long-enough-passphrase")).toBe(true);
    expect(verifyPassword("a-long-enough-passphras")).toBe(false);
    expect(verifyPassword("A-Long-Enough-Passphrase")).toBe(false);
    expect(verifyPassword("")).toBe(false);
  });

  it("refuses everything when no passphrase is configured", () => {
    delete process.env.ZCAL_OWNER_PASSWORD;
    expect(verifyPassword("")).toBe(false);
    expect(verifyPassword("anything")).toBe(false);
  });
});

describe("session tokens", () => {
  it("accepts a token it just minted", () => {
    expect(verifySessionToken(createSessionToken())).toBe(true);
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken();
    process.env.ZCAL_SESSION_SECRET = "1".repeat(64);
    expect(verifySessionToken(token)).toBe(false);
  });

  it("rejects a tampered expiry", () => {
    const token = createSessionToken();
    const [version, , signature] = token.split(".");
    const forged = `${version}.${Date.now() + 10_000_000}.${signature}`;
    expect(verifySessionToken(forged)).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = createSessionToken(Date.now() - 40 * 24 * 60 * 60 * 1000);
    expect(verifySessionToken(token)).toBe(false);
  });

  it("rejects malformed and missing tokens", () => {
    expect(verifySessionToken(undefined)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
    expect(verifySessionToken("garbage")).toBe(false);
    expect(verifySessionToken("v1.123")).toBe(false);
    expect(verifySessionToken("v2.9999999999999.sig")).toBe(false);
  });
});

describe("cancellation tokens", () => {
  it("matches only the exact token", () => {
    const token = randomToken();
    expect(verifyCancelToken(token, token)).toBe(true);
    expect(verifyCancelToken(`${token}x`, token)).toBe(false);
    expect(verifyCancelToken("", token)).toBe(false);
    expect(verifyCancelToken(token, "")).toBe(false);
  });

  it("generates tokens that do not repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
  });

  it("generates readable, URL-safe booking references", () => {
    const ids = Array.from({ length: 200 }, () => randomPublicId());
    for (const id of ids) expect(id).toMatch(/^[a-z2-9]{12}$/);
    expect(new Set(ids).size).toBe(200);
  });
});

describe("configuration self-check", () => {
  it("is happy with a proper setup", () => {
    expect(configProblems()).toEqual([]);
  });

  it("names the variable that is wrong without printing its value", () => {
    process.env.ZCAL_OWNER_PASSWORD = "hunter2xyz";
    process.env.ZCAL_SESSION_SECRET = "swordfish42";
    const problems = configProblems();
    expect(problems.map((problem) => problem.variable)).toEqual([
      "ZCAL_OWNER_PASSWORD",
      "ZCAL_SESSION_SECRET",
    ]);
    // The report must be safe to show on screen: it names variables, never values.
    expect(JSON.stringify(problems)).not.toContain("hunter2xyz");
    expect(JSON.stringify(problems)).not.toContain("swordfish42");
  });
});
