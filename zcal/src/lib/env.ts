import fs from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader for contexts that Next.js does not boot: CLI scripts and
 * the unit test runner. Inside the Next.js app this is a no-op, because Next
 * has already populated process.env by the time any of this runs.
 *
 * Existing environment variables always win, so `ZCAL_DATABASE_PATH=... npm test`
 * still overrides the file.
 */
let loaded = false;

export function loadEnvFile(root = process.cwd()): void {
  if (loaded) return;
  loaded = true;
  const file = path.join(root, ".env");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return; // No .env is fine — required values are validated at point of use.
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

export const DEFAULT_DATABASE_PATH = "./data/zcal.db";

export function databasePath(): string {
  const configured = process.env.ZCAL_DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function publicBaseUrl(): string {
  return (process.env.ZCAL_PUBLIC_BASE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

/** The optional read-only calendar feed. Empty string means "not configured". */
export function icsFeedUrl(): string {
  return process.env.ZCAL_ICS_FEED_URL?.trim() ?? "";
}

export function hasIcsFeed(): boolean {
  const url = icsFeedUrl();
  return url.length > 0 && /^https?:\/\//i.test(url);
}

/**
 * Secrets are returned, never logged. Callers that fail validation must report
 * only the *name* of the missing variable.
 */
export function ownerPassword(): string {
  return process.env.ZCAL_OWNER_PASSWORD ?? "";
}

export function sessionSecret(): string {
  return process.env.ZCAL_SESSION_SECRET ?? "";
}

export type ConfigProblem = { variable: string; message: string };

/** Startup self-check used by the setup script and the login page. */
export function configProblems(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const pw = ownerPassword();
  if (!pw) {
    problems.push({ variable: "ZCAL_OWNER_PASSWORD", message: "is not set." });
  } else if (pw.length < 12) {
    problems.push({ variable: "ZCAL_OWNER_PASSWORD", message: "is shorter than 12 characters." });
  }
  const secret = sessionSecret();
  if (!secret) {
    problems.push({ variable: "ZCAL_SESSION_SECRET", message: "is not set." });
  } else if (secret.length < 32) {
    problems.push({ variable: "ZCAL_SESSION_SECRET", message: "is shorter than 32 characters." });
  }
  return problems;
}
