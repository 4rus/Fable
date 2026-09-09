import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * Runs once before the whole Playwright suite, before the dev server (see
 * playwright.config.ts webServer) even starts. Same idea as
 * tests/global-setup.ts for Vitest: a dedicated, throwaway SQLite file so
 * end-to-end tests never touch a developer's real dev.db, and every run
 * starts from a known-empty schema.
 */
export default async function globalSetup() {
  const dbPath = path.resolve(__dirname, "e2e.db");
  if (existsSync(dbPath)) unlinkSync(dbPath);

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });
}
