import { execSync } from "node:child_process";
import { loadDotEnv, schemaScopedUrl } from "../tests/db-url";

/**
 * Runs once before the whole Playwright suite, before the dev server (see
 * playwright.config.ts webServer) even starts. Same idea as
 * tests/global-setup.ts for Vitest: an isolated "e2e" Postgres schema
 * (distinct from "public" dev data AND from the Vitest suite's "test"
 * schema) that's dropped and recreated fresh on every run.
 */
export default async function globalSetup() {
  loadDotEnv();
  const url = schemaScopedUrl("e2e");
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };

  execSync('npx prisma db execute --stdin --url "' + url + '"', {
    input: "DROP SCHEMA IF EXISTS e2e CASCADE; CREATE SCHEMA e2e;",
    stdio: ["pipe", "inherit", "inherit"],
    env,
  });

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env,
  });
}
