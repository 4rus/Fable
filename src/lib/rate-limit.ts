import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Fixed-window rate limiter, two backends:
 *
 *  - UPSTASH_REDIS_REST_URL/TOKEN set: backed by real Upstash Redis
 *    (REST-based, works fine from Vercel's serverless functions). Every
 *    instance/region checks the SAME counter, closing the real gap the
 *    in-memory fallback below has.
 *  - Not set (local dev default): falls back to the original in-memory
 *    counter. Same graceful-degradation pattern as every other
 *    integration in this app — the app still works and is still rate
 *    limited, just not correctly across multiple instances.
 *
 * HONEST HISTORY (Phase Q): the in-memory version's own comment already
 * admitted this exact weakness — "the moment this app runs behind a load
 * balancer with more than one instance (or on a serverless platform that
 * spins up multiple isolated function instances)... the effective limit
 * multiplies by the instance count." That is exactly what Vercel does,
 * so the in-memory limiter was never a real brute-force protection once
 * this app was actually deployed there (Phase C) — it just hadn't been
 * swapped out yet. Fixed here, not just documented, since login/signup
 * brute-force protection is a real security control, not a nice-to-have.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const inMemoryBuckets = new Map<string, Bucket>();

let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of inMemoryBuckets) {
    if (bucket.resetAt <= now) inMemoryBuckets.delete(key);
  }
}

function checkRateLimitInMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = inMemoryBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    inMemoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterMs: 0 };
}

let cachedRedis: Redis | null = null;
let cachedForUrl: string | undefined;

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  // Keyed on the actual URL value, not just "have we ever checked" — same
  // reasoning as src/lib/ai/anthropic.ts's client cache, so a key added
  // after the process started (or a test stubbing the env var) is picked
  // up rather than permanently ignored.
  if (url === cachedForUrl) return cachedRedis;
  cachedForUrl = url;
  cachedRedis = url && token ? new Redis({ url, token }) : null;
  return cachedRedis;
}

async function checkRateLimitRedis(
  redis: Redis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  // INCR then PEXPIRE-if-new is the standard atomic-enough fixed-window
  // pattern: INCR always runs atomically server-side; only the very first
  // caller to create the key (count === 1) sets its expiry, so a
  // concurrent burst of requests can never each reset the window.
  const redisKey = `ratelimit:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.pexpire(redisKey, windowMs);
  }

  if (count > limit) {
    const ttl = await redis.pttl(redisKey);
    return { allowed: false, remaining: 0, retryAfterMs: ttl > 0 ? ttl : windowMs };
  }

  return { allowed: true, remaining: Math.max(0, limit - count), retryAfterMs: 0 };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Checks and consumes one attempt against a fixed window.
 * @param key    Uniquely identifies what's being limited, e.g.
 *               `login:${ip}:${email}` — include both IP and identifier so
 *               one attacker can't lock out a legitimate user by hammering
 *               their email from many IPs into a single shared bucket, and
 *               a legitimate user behind a shared/corporate IP doesn't get
 *               starved by unrelated traffic on that same IP.
 * @param limit  Max attempts allowed within the window.
 * @param windowMs Window length in milliseconds.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const redis = getRedis();
  if (redis) return checkRateLimitRedis(redis, key, limit, windowMs);
  return checkRateLimitInMemory(key, limit, windowMs);
}

/** Best-effort client IP extraction behind a proxy/load balancer. Never
 * trust this for anything security-critical beyond rate-limiting (an
 * attacker fully controls the X-Forwarded-For header they send) — it only
 * needs to be "hard enough to rotate quickly," not authoritative. */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
