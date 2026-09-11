import { defineConfig, devices } from "@playwright/test";
import { loadDotEnv, schemaScopedUrl } from "./tests/db-url";

const PORT = 3100;

loadDotEnv();
// Isolated "e2e" Postgres schema — see e2e/global-setup.ts, which drops
// and recreates it fresh before this webServer's dev process starts.
const E2E_DATABASE_URL = schemaScopedUrl("e2e");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false, // tests share one seeded-once database; keep them sequential and independent by construction
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  // Generous: this one test walks the entire critical path (signup ->
  // invoice -> payment -> attachment -> CSV import -> insight) against a
  // real Postgres connection, where SQLite's local-file latency doesn't
  // apply.
  timeout: 120_000,
  // Postgres (Supabase) is a real network round-trip, on top of Next
  // dev's first-compile cost per route — both add real latency SQLite
  // never had. 20s comfortably covers a cold compile + a slow query
  // stacking together without hiding an actual hang (the overall 30s test
  // timeout above still catches that).
  expect: { timeout: 20_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: `http://localhost:${PORT}`,
    // Always start a fresh server against the dedicated e2e database —
    // never reuse whatever might already be running on this port, which
    // could be a dev server pointed at a developer's real dev.db.
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL: E2E_DATABASE_URL,
      DIRECT_URL: E2E_DATABASE_URL,
      NEXTAUTH_URL: `http://localhost:${PORT}`,
      NEXTAUTH_SECRET: "e2e-test-secret-not-for-production-use-only",
      // 32 raw bytes, base64-encoded — required by src/lib/crypto.ts (used
      // for 2FA secrets). Test-only value, never used outside this suite.
      ENCRYPTION_KEY: "ZTJlLXRlc3Qtb25seS1lbmNyeXB0aW9uLWtleS0zMmI=",
      // Force src/lib/email.ts's "not configured" path even though the
      // developer's real .env has a live key — E2E must never depend on
      // it or make real outbound API calls.
      RESEND_API_KEY: "",
    },
  },
});
