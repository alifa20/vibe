import { NextResponse } from "next/server";
import { z } from "zod";
import { isOwnerSignedIn } from "./auth";
import { fieldErrors } from "./validation";

/** Shared shapes so every endpoint fails in the same, predictable way. */

export interface ApiError {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(
  status: number,
  error: string,
  message: string,
  fields?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ error, message, ...(fields ? { fields } : {}) } satisfies ApiError, {
    status,
  });
}

export function invalid(error: z.ZodError, message = "Please correct the highlighted fields."): NextResponse {
  return apiError(422, "validation_failed", message, fieldErrors(error));
}

export function notFound(message = "Not found."): NextResponse {
  return apiError(404, "not_found", message);
}

/**
 * Guard for owner-only endpoints. Returns a response to send when the caller
 * is not signed in, or null when it is safe to continue.
 */
export async function guardOwner(): Promise<NextResponse | null> {
  if (await isOwnerSignedIn()) return null;
  return apiError(401, "unauthorized", "Sign in to do that.");
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Parse a JSON body without trusting its size or its syntax. */
export async function readJsonBody(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; response: NextResponse }
> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: apiError(413, "payload_too_large", "That request body is larger than 8 MB."),
    };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: apiError(400, "unreadable_body", "Could not read the request body.") };
  }
  if (text.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: apiError(413, "payload_too_large", "That request body is larger than 8 MB."),
    };
  }
  try {
    return { ok: true, value: text.length ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "That request body is not valid JSON.") };
  }
}

/**
 * A small fixed-window limiter held in this process's memory.
 *
 * It exists to slow down passphrase guessing on a box that is exposed to a
 * network. It is not a distributed rate limiter and it resets when the server
 * restarts — see "Limitations" in the README.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    if (attempts.size > 5000) {
      for (const [existingKey, value] of attempts) {
        if (value.resetAt <= now) attempts.delete(existingKey);
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** A coarse client key for rate limiting. Never logged, never stored. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0] ?? "local").trim() || "local";
}
