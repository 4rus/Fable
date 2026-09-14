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
  // apply, PLUS Next dev's on-demand compile of every distinct route the
  // journey touches for the first time in this fresh server process
  // (each one only pays that cost once, but the journey visits many).
  // 120s was enough early on; as the app has grown (more routes, a
  // heavier insight/forecast engine on /app) it started running out
  // consistently rather than occasionally — raised to keep pace, not
  // because any single step actually hangs.
  timeout: 240_000,
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
    // Phase Q: piped rather than the default "ignore" — this is what let
    // a real failure get root-caused with actual server-side timing
    // (compile durations, response times) instead of guessing from the
    // browser side alone. Prints during every run (compile/request
    // lines interleaved with the test reporter's own output), not just
    // failures — a bit more console noise on a normal green run, worth
    // it for being able to diagnose a timeout with real numbers instead
    // of another guess-and-bump cycle.
    stdout: "pipe",
    stderr: "pipe",
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
      // Real bug found in Phase Q's own final verification pass: without
      // this, e2e inherits the developer's real Upstash credentials from
      // .env and every run's one real signup shares the SAME external
      // Redis rate-limit bucket (keyed by IP, and every Playwright-driven
      // request comes from this same local machine) — unlike the old
      // in-memory limiter, which reset for free every run since a fresh
      // server process means a fresh empty counter. A handful of e2e
      // runs in the same hour silently exhausts the real 5-signups-per-
      // hour limit, and the test starts failing for a reason that has
      // nothing to do with the app being broken. Forced empty here so
      // e2e always gets the fast, always-fresh in-memory fallback,
      // matching this whole webServer block's existing isolation
      // philosophy (fresh schema every run, fake secrets, no real
      // external side effects).
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
    },
  },
});
