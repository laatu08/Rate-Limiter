import redis from "../config/redis";
import { RateLimiter } from "./rateLimiter";
import { RateLimitPolicy } from "../types/policy";
import { RateLimitResult } from "../types/decision";

export class FixedWindowLimiter implements RateLimiter {
  async consume(
    key: string,
    policy: RateLimitPolicy
  ): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);

    const windowStart =
      Math.floor(now / policy.windowSeconds) * policy.windowSeconds;

    const redisKey = `rate_limit:${key}:${windowStart}`;

    const count = await redis.incr(redisKey);

    if (count === 1) {
      // set TTL only once per window
      await redis.expire(redisKey, policy.windowSeconds);
    }

    const allowed = count <= policy.limit;

    return {
      allowed,
      remaining: Math.max(0, policy.limit - count),
      resetAt: windowStart + policy.windowSeconds,
    };
  }
}
