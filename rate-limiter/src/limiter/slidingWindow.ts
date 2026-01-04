import redis from "../config/redis";
import { RateLimiter } from "./rateLimiter";
import { RateLimitPolicy } from "../types/policy";
import { RateLimitResult } from "../types/decision";

export class SlidingWindowLimiter implements RateLimiter {
  async consume(
    key: string,
    policy: RateLimitPolicy
  ): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const windowSize = policy.windowSeconds;

    const currentWindowStart =
      Math.floor(now / windowSize) * windowSize;

    const previousWindowStart =
      currentWindowStart - windowSize;

    const currentKey = `rate_limit:${key}:${currentWindowStart}`;
    const prevKey = `rate_limit:${key}:${previousWindowStart}`;

    // Increment current window
    const currentCount = await redis.incr(currentKey);
    if (currentCount === 1) {
      await redis.expire(currentKey, windowSize * 2);
    }

    // Get previous window count
    const prevCountRaw = await redis.get(prevKey);
    const prevCount = prevCountRaw ? parseInt(prevCountRaw, 10) : 0;

    // Calculate overlap ratio
    const elapsed = now - currentWindowStart;
    const overlapRatio = (windowSize - elapsed) / windowSize;

    const effectiveCount =
      currentCount + Math.floor(prevCount * overlapRatio);

    const allowed = effectiveCount <= policy.limit;

    return {
      allowed,
      remaining: Math.max(0, policy.limit - effectiveCount),
      resetAt: currentWindowStart + windowSize,
    };
  }
}
