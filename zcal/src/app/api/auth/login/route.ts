import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifyPassword,
} from "@/lib/auth";
import { apiError, clientKey, invalid, ok, rateLimit, readJsonBody } from "@/lib/api";
import { configProblems } from "@/lib/env";
import { loginSchema } from "@/lib/validation";

/**
 * Sign in as the owner.
 *
 * Attempts are rate limited per client, the passphrase is compared in constant
 * time, and neither the passphrase nor the session secret is ever logged.
 */
export async function POST(request: Request) {
  const problems = configProblems();
  if (problems.length > 0) {
    return apiError(
      503,
      "not_configured",
      `Set ${problems.map((problem) => problem.variable).join(" and ")} in .env, then restart.`,
    );
  }

  const limit = rateLimit(`login:${clientKey(request)}`, 10, 5 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "too_many_attempts",
        message: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = loginSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  if (!verifyPassword(parsed.data.password)) {
    return apiError(401, "bad_passphrase", "That passphrase is not right.");
  }

  const response = ok({ signedIn: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: new URL(request.url).protocol === "https:",
  });
  return response;
}
