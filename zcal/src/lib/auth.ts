import crypto from "node:crypto";
import { cookies } from "next/headers";
import { ownerPassword, sessionSecret } from "./env";

/**
 * Single-user authentication.
 *
 * There is no user table and no account system, because there is exactly one
 * user: whoever holds ZCAL_OWNER_PASSWORD. A successful login mints an
 * HMAC-signed, expiring cookie. No secret is ever written to the database, a
 * log line, or an export.
 */

export const SESSION_COOKIE = "zcal_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  // Hash first so the comparison is constant-time even for unequal lengths.
  const digestA = crypto.createHash("sha256").update(bufferA).digest();
  const digestB = crypto.createHash("sha256").update(bufferB).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function verifyPassword(candidate: string): boolean {
  const expected = ownerPassword();
  if (!expected) return false;
  return safeEqual(candidate, expected);
}

export function createSessionToken(now = Date.now()): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("ZCAL_SESSION_SECRET is not set");
  const expiresAt = now + SESSION_TTL_MS;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  const secret = sessionSecret();
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  return safeEqual(parts[2]!, sign(payload, secret));
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

/** Reads the request cookie. Safe to call from server components and handlers. */
export async function isOwnerSignedIn(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Compare a booking cancellation token without leaking timing information. */
export function verifyCancelToken(provided: string, stored: string): boolean {
  if (!provided || !stored) return false;
  return safeEqual(provided, stored);
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomPublicId(): string {
  // Short, unambiguous, URL-safe. Collisions are caught by the UNIQUE index.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const raw = crypto.randomBytes(12);
  let out = "";
  for (const byte of raw) out += alphabet[byte % alphabet.length];
  return out;
}
