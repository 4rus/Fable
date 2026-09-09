import { defineConfig, devices } from "@playwright/test";
import path from "path";

const PORT = 3100;
const E2E_DB_PATH = path.resolve(__dirname, "e2e", "e2e.db");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false, // tests share one seeded-once database; keep them sequential and independent by construction
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 30_000,
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
      DATABASE_URL: `file:${E2E_DB_PATH}`,
      NEXTAUTH_URL: `http://localhost:${PORT}`,
      NEXTAUTH_SECRET: "e2e-test-secret-not-for-production-use-only",
    },
  },
});
