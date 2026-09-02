import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./tests/e2e/fixture";

/**
 * One smoke test, run against a real production build.
 *
 * The server gets its own database and its own secrets through the environment,
 * so the suite never reads or writes your real calendar.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: E2E.baseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: `npm run build && npx next start --port ${E2E.port}`,
    url: E2E.baseUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      ZCAL_DATABASE_PATH: E2E.databasePath,
      ZCAL_OWNER_PASSWORD: E2E.ownerPassword,
      ZCAL_SESSION_SECRET: E2E.sessionSecret,
      ZCAL_PUBLIC_BASE_URL: E2E.baseUrl,
      ZCAL_ICS_FEED_URL: "",
    },
  },
});
