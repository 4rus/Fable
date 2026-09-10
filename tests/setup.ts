import path from "node:path";

// globalSetup runs in a separate process from test files in some Vitest
// configurations, so pin DATABASE_URL here too for the worker process that
// actually executes the tests and imports src/lib/db.ts.
process.env.DATABASE_URL = `file:${path.resolve(__dirname, "test.db")}`;

// Fixed test-only key for src/lib/crypto.ts (AES-256-GCM, 32 raw bytes,
// base64-encoded) -- never used outside this test run.
process.env.ENCRYPTION_KEY = "odt3aCUp+jBgQrVbi8soULyUM2+jPMcffCwc/Z+M8xE=";
