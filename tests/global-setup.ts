import { execSync } from "node:child_process";
import { loadDotEnv, schemaScopedUrl } from "./db-url";

/**
 * Runs once before the whole test suite: pushes the current Prisma
 * schema to a dedicated "test" Postgres schema (see db-url.ts) so tests
 * never touch the real "public" dev data, and every run starts from a
 * known, freshly-synced schema (--accept-data-loss here is safe — this
 * schema holds nothing but test fixtures created by the tests
 * themselves, recreated every run).
 */
export default async function globalSetup() {
  loadDotEnv();
  const url = schemaScopedUrl("test");
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };

  // Drop and recreate the schema first -- the direct equivalent of the old
  // "delete the SQLite file" reset, so leftover rows from a previous run
  // (or an interrupted one) never leak into this run's tests.
  execSync('npx prisma db execute --stdin --url "' + url + '"', {
    input: "DROP SCHEMA IF EXISTS test CASCADE; CREATE SCHEMA test;",
    stdio: ["pipe", "inherit", "inherit"],
    env,
  });

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env,
  });
}
