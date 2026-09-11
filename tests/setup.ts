import { loadDotEnv, schemaScopedUrl } from "./db-url";

// globalSetup (tests/global-setup.ts) runs in a separate process from the
// worker that actually executes tests and imports src/lib/db.ts — pin the
// same schema-scoped Postgres URL here too, for that worker process.
loadDotEnv();
const url = schemaScopedUrl("test");
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;

// Fixed test-only key for src/lib/crypto.ts (AES-256-GCM, 32 raw bytes,
// base64-encoded) -- never used outside this test run.
process.env.ENCRYPTION_KEY = "odt3aCUp+jBgQrVbi8soULyUM2+jPMcffCwc/Z+M8xE=";

// NOTE: deleting RESEND_API_KEY here is NOT sufficient on its own --
// Vitest reloads .env per test file, AFTER setupFiles run, which silently
// re-adds it. The actual guarantee lives in tests/email.test.ts and
// tests/invoice-email.test.ts via vi.stubEnv("RESEND_API_KEY", ""), which
// wins that ordering. This delete is left as defense-in-depth for any
// other test that touches src/lib/email.ts without its own stub.
delete process.env.RESEND_API_KEY;
