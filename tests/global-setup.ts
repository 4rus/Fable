import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * Runs once before the whole test suite: pushes the Prisma schema to a
 * throwaway SQLite file dedicated to tests, so tests never touch a
 * developer's real dev.db and always start from a known-empty schema.
 */
const TEST_DB_PATH = path.resolve(__dirname, "test.db");

export default async function globalSetup() {
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_PATH}` },
  });
}
