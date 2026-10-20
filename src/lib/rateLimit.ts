type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Simple fixed-window rate limit for server routes (per key, e.g. client IP). */
export function rateLimitAllowed(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}
