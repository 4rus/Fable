/**
 * Builds a schema-scoped Postgres connection URL for tests/E2E, reusing
 * the same Supabase project as dev (via DIRECT_URL, the session-mode
 * pooler — supports the prepared statements `prisma db push` needs) but
 * pointed at an isolated Postgres schema ("test" / "e2e") instead of
 * "public" (real dev data). This is the Postgres-era equivalent of the
 * old "throwaway SQLite file" isolation: tests never touch dev data, but
 * without a local Postgres available, isolation is a schema namespace
 * within the same database rather than a separate file.
 *
 * Never hardcode connection details here — always derived from
 * DIRECT_URL, which lives in the gitignored .env, so no credential ever
 * lands in a committed file.
 */
export function schemaScopedUrl(schema: string): string {
  const base = process.env.DIRECT_URL;
  if (!base) {
    throw new Error(
      "DIRECT_URL is not set. Copy .env.example to .env and fill in your Postgres connection details before running tests.",
    );
  }
  const url = new URL(base);
  url.searchParams.set("schema", schema);
  return url.toString();
}

/** Loads .env into process.env if present — a no-op (not an error) when
 * it doesn't exist, e.g. a CI environment that provides real env vars
 * directly instead of a file. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // .env not found — fine, assume the environment already has what it needs.
  }
}
