import path from "node:path";

// globalSetup runs in a separate process from test files in some Vitest
// configurations, so pin DATABASE_URL here too for the worker process that
// actually executes the tests and imports src/lib/db.ts.
process.env.DATABASE_URL = `file:${path.resolve(__dirname, "test.db")}`;
