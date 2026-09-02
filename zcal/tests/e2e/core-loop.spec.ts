import { expect, test } from "@playwright/test";
import { E2E } from "./fixture";

/**
 * The smoke test: one pass through the whole reason this app exists.
 *
 *   the owner's calendar publishes free time
 *     -> a visitor reserves a slot
 *       -> the event is written back to the owner's calendar
 *         -> that time stops being offered to anyone else
 *
 * If this passes, the core loop works.
 */
test("a visitor books a slot and it lands in the owner's calendar", async ({ page }) => {
  // --- 1. The booking link publishes free time ----------------------------
  await page.goto(`/book/${E2E.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: E2E.linkTitle })).toBeVisible();
  await expect(page.getByText("Times shown in UTC")).toBeVisible();

  const days = page.getByTestId("day");
  await expect(days.first()).toBeVisible();

  // Pick the furthest published day, so the choice cannot expire mid-test.
  const chosenDay = days.last();
  const chosenDate = await chosenDay.getAttribute("data-date");
  expect(chosenDate).toBeTruthy();
  await chosenDay.click();

  const slots = page.getByTestId("slot");
  await expect(slots.first()).toBeVisible();
  const chosenSlot = slots.first();
  const chosenStart = await chosenSlot.getAttribute("data-start");
  expect(chosenStart).toBeTruthy();
  // The calendar is configured in UTC for this run, so the wall-clock label is
  // just the time part of the instant.
  const chosenTime = chosenStart!.slice(11, 16);

  // --- 2. A visitor reserves it -------------------------------------------
  await chosenSlot.click();
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();

  await page.getByLabel("Your name").fill(E2E.inviteeName);
  await page.getByLabel("Your email").fill(E2E.inviteeEmail);
  await page.getByLabel("Anything they should know?").fill(E2E.inviteeNote);
  await page.getByRole("button", { name: "Confirm this time" }).click();

  // --- 3. The visitor gets a confirmation ---------------------------------
  await page.waitForURL(new RegExp(`/book/${E2E.slug}/confirmed/`));
  await expect(page.getByText("You are booked in")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: E2E.linkTitle })).toBeVisible();
  await expect(page.getByText(E2E.inviteeName)).toBeVisible();

  const reference = page.url().split("/").pop()!.split("?")[0]!;
  expect(reference).toMatch(/^[a-z2-9]{12}$/);

  // The .ics they can take away is a real calendar document.
  const ics = await page.request.get(`/api/bookings/${reference}/ics`);
  expect(ics.status()).toBe(200);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  const icsBody = await ics.text();
  expect(icsBody).toContain("BEGIN:VEVENT");
  expect(icsBody).toContain(`SUMMARY:${E2E.linkTitle}`);

  // --- 4. That time is no longer offered to anyone else -------------------
  await page.goto(`/book/${E2E.slug}`);
  await page.locator(`[data-testid="day"][data-date="${chosenDate}"]`).click();
  await expect(page.getByTestId("slot").first()).toBeVisible();
  await expect(page.locator(`[data-testid="slot"][data-start="${chosenStart}"]`)).toHaveCount(0);

  // --- 5. The owner sees the meeting in their calendar --------------------
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(E2E.ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByText(E2E.inviteeName).first()).toBeVisible();

  await page.goto("/admin/calendar");
  const title = `${E2E.linkTitle} with ${E2E.inviteeName}`;
  const written = page.locator(".list__item").filter({ has: page.locator(".list__title", { hasText: title }) });
  await expect(written).toHaveCount(1);
  // ...at the time that was chosen, and marked as having come from a booking.
  await expect(written.locator(".list__meta")).toContainText(chosenTime);
  await expect(written.getByText("Booked", { exact: true })).toBeVisible();
});

test("the owner side is private and the booking page is not", async ({ page }) => {
  // A signed-out visitor is sent to sign in, not shown the calendar.
  await page.goto("/admin/calendar");
  await page.waitForURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();

  // Owner-only endpoints refuse to answer at all.
  const denied = await page.request.get("/api/admin/export");
  expect(denied.status()).toBe(401);

  // The public booking page still works without any credentials.
  const booking = await page.request.get(`/book/${E2E.slug}`);
  expect(booking.status()).toBe(200);

  // A wrong passphrase is rejected.
  await page.getByLabel("Passphrase").fill("definitely-not-the-passphrase");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That passphrase is not right.").first()).toBeVisible();
});
