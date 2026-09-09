import { describe, it, expect } from "vitest";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows attempts up to the limit, then blocks", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true);
    }
    const sixth = checkRateLimit(key, 5, 60_000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(keyA, 3, 60_000);
    // keyA is now exhausted; keyB should be unaffected.
    expect(checkRateLimit(keyA, 3, 60_000).allowed).toBe(false);
    expect(checkRateLimit(keyB, 3, 60_000).allowed).toBe(true);
  });

  it("resets after the window elapses", async () => {
    const key = `test-window-${Math.random()}`;
    expect(checkRateLimit(key, 1, 30).allowed).toBe(true);
    expect(checkRateLimit(key, 1, 30).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(checkRateLimit(key, 1, 30).allowed).toBe(true);
  });
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
