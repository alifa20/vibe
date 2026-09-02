/** Shared constants for the end-to-end run, used by setup and by the spec. */
export const E2E = {
  port: 3100,
  baseUrl: "http://localhost:3100",
  databasePath: "./data/e2e.db",
  ownerPassword: "e2e-owner-passphrase-not-a-real-secret",
  sessionSecret: "e2e".padEnd(64, "0"),
  slug: "e2e-intro",
  linkTitle: "E2E Intro",
  ownerName: "Ada Test",
  inviteeName: "Casey Test",
  inviteeEmail: "casey@example.invalid",
  inviteeNote: "Booked by the end-to-end smoke test.",
} as const;
