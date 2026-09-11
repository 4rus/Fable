import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // e2e/ holds Playwright specs (a different `test` global, run via
    // `npm run test:e2e`) — excluded here so Vitest doesn't try to collect
    // them as its own tests.
    exclude: ["**/node_modules/**", "**/e2e/**"],
    // Every test file gets its own PrismaClient (its own connection pool,
    // capped at 3 -- see tests/db-url.ts) against the SAME Supabase
    // project, whose session-mode pooler hard-caps the whole project at
    // 15 concurrent connections. Left at Vitest's default (one worker per
    // CPU core), that alone can exceed the cap before a single query
    // runs. 4 workers x 3 connections = 12, safely under it.
    poolOptions: { threads: { maxThreads: 4, minThreads: 1 } },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // "server-only" is a Next.js build-time guard with no real runtime
      // export; stub it out for the Vitest/Node environment.
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
