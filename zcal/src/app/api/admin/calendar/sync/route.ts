import { apiError, guardOwner, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { hasIcsFeed, icsFeedUrl } from "@/lib/env";
import { parseIcs } from "@/lib/ics";
import { getSettings, upsertIcsEvents } from "@/lib/repo";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_ICS_BYTES = 5 * 1024 * 1024;

/**
 * Optional. Pulls the read-only calendar feed named by ZCAL_ICS_FEED_URL.
 *
 * Without that variable the app is fully usable — you keep the calendar by
 * hand or by uploading .ics files. This endpoint says so rather than pretending
 * an integration exists. The URL itself is never returned, logged or stored.
 */
export async function POST() {
  const denied = await guardOwner();
  if (denied) return denied;

  if (!hasIcsFeed()) {
    return apiError(
      501,
      "feed_not_configured",
      "No calendar feed is configured. Set ZCAL_ICS_FEED_URL in .env and restart, or upload an .ics file instead.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(icsFeedUrl(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8" },
      cache: "no-store",
    });

    if (!response.ok) {
      // Report the status, never the URL: it is a credential.
      return apiError(
        502,
        "feed_unreachable",
        `The calendar feed answered with HTTP ${response.status}. Check ZCAL_ICS_FEED_URL in .env.`,
      );
    }

    const raw = await response.text();
    if (raw.length > MAX_ICS_BYTES) {
      return apiError(413, "feed_too_large", "That calendar feed is larger than 5 MB.");
    }
    if (!/BEGIN:VCALENDAR/i.test(raw)) {
      return apiError(422, "not_a_calendar", "The feed did not return an iCalendar document.");
    }

    const db = getDb();
    const { events, skipped } = parseIcs(raw, getSettings(db).timeZone);
    return ok(upsertIcsEvents(db, events, skipped));
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return apiError(
      504,
      aborted ? "feed_timeout" : "feed_unreachable",
      aborted
        ? "The calendar feed did not answer within 15 seconds."
        : "Could not reach the calendar feed. Check the address in .env and your connection.",
    );
  } finally {
    clearTimeout(timer);
  }
}
