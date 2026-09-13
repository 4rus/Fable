import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// Real, live Upstash Redis calls when configured — same skip-if-
// unconfigured convention as tests/bank-connections.test.ts
// (PLAID_CONFIGURED) and tests/narration.test.ts (ANTHROPIC_CONFIGURED).
// Without UPSTASH_REDIS_REST_URL/TOKEN set, checkRateLimit() falls back
// to the in-memory implementation, which the tests below already
// exercise — this block specifically proves the real Redis-backed path
// works, since that's the actual production behavior once configured.
const UPSTASH_CONFIGURED = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const describeIfConfigured = UPSTASH_CONFIGURED ? describe : describe.skip;

describe("checkRateLimit (in-memory fallback)", () => {
  // Deliberately force the in-memory path regardless of what's in the
  // developer's real .env — same reasoning as invoice-email.test.ts
  // forcing RESEND_API_KEY empty. Scoped to just this describe block
  // (not the real-Redis one below, which needs the real credentials):
  // without this, once real Upstash credentials are configured, these
  // calls silently start hitting the real network instead, and a tight
  // window (30ms, chosen when this was pure in-memory arithmetic)
  // becomes flaky against real round-trip latency — which is what
  // actually happened here real-world.
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("allows attempts up to the limit, then blocks", async () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit(key, 5, 60_000)).allowed).toBe(true);
    }
    const sixth = await checkRateLimit(key, 5, 60_000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", async () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    for (let i = 0; i < 3; i++) await checkRateLimit(keyA, 3, 60_000);
    // keyA is now exhausted; keyB should be unaffected.
    expect((await checkRateLimit(keyA, 3, 60_000)).allowed).toBe(false);
    expect((await checkRateLimit(keyB, 3, 60_000)).allowed).toBe(true);
  });

  it("resets after the window elapses", async () => {
    const key = `test-window-${Math.random()}`;
    expect((await checkRateLimit(key, 1, 30)).allowed).toBe(true);
    expect((await checkRateLimit(key, 1, 30)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect((await checkRateLimit(key, 1, 30)).allowed).toBe(true);
  });
});

describeIfConfigured("checkRateLimit (real Upstash Redis)", () => {
  it("enforces the limit against real Redis, shared across calls the way multiple server instances would see it", async () => {
    // The whole point of this migration: two independent "checks" (no
    // shared in-process state between them, which is exactly what two
    // separate Vercel function instances would look like) must still
    // agree on the same count, because they're both really hitting the
    // same Redis key.
    const key = `real-redis-test-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit(key, 3, 60_000);
      expect(result.allowed).toBe(true);
    }
    const fourth = await checkRateLimit(key, 3, 60_000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("expires the key and allows again once the window passes", async () => {
    const key = `real-redis-window-${Date.now()}-${Math.random()}`;
    expect((await checkRateLimit(key, 1, 1000)).allowed).toBe(true);
    expect((await checkRateLimit(key, 1, 1000)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 1200));
    expect((await checkRateLimit(key, 1, 1000)).allowed).toBe(true);
  }, 10_000);
});

describe("getClientIp", () => {
  it("prefers the first X-Forwarded-For entry", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(getClientIp(headers)).toBe("203.0.113.5");
  });

  it("falls back to X-Real-IP, then 'unknown'", () => {
    expect(getClientIp(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});
