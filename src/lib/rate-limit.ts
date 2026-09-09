import "server-only";

/**
 * In-memory fixed-window rate limiter.
 *
 * HONEST LIMITATION, stated up front: this state lives in the Node
 * process's memory. It works correctly for exactly one server instance.
 * The moment this app runs behind a load balancer with more than one
 * instance (or on a serverless platform that spins up multiple isolated
 * function instances), each instance has its own counters and the
 * effective limit multiplies by the instance count. That is an accepted
 * gap for a single-instance MVP, not a hidden one — swap this module's
 * internals for a Redis/Upstash-backed limiter (same function signature)
 * before running more than one instance in production.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Prevent unbounded memory growth from a flood of distinct keys (e.g. an
// attacker cycling through many fake emails/IPs) — periodically drop
// expired entries rather than letting the map grow forever.
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
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
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterMs: 0 };
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
