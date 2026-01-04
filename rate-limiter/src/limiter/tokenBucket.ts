import redis from "../config/redis";
import { RateLimiter } from "./rateLimiter";
import { RateLimitPolicy } from "../types/policy";
import { RateLimitResult } from "../types/decision";

export class TokenBucketLimiter implements RateLimiter {
  async consume(
    key: string,
    policy: RateLimitPolicy
  ): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const bucketKey = `token_bucket:${key}`;

    const refillRate = policy.limit / policy.windowSeconds;

    const data = await redis.hgetall(bucketKey);

    let tokens = data.tokens ? parseFloat(data.tokens) : policy.limit;
    let lastRefillTs = data.lastRefillTs
      ? parseInt(data.lastRefillTs, 10)
      : now;

    // Refill tokens based on elapsed time
    const elapsed = now - lastRefillTs;
    const refill = elapsed * refillRate;

    tokens = Math.min(policy.limit, tokens + refill);

    let allowed = false;

    if (tokens >= 1) {
      tokens -= 1;
      allowed = true;
    }

    await redis.hset(bucketKey, {
      tokens: tokens.toString(),
      lastRefillTs: now.toString(),
    });

    // Optional cleanup
    await redis.expire(bucketKey, policy.windowSeconds * 2);

    return {
      allowed,
      remaining: Math.floor(tokens),
      resetAt: now + Math.ceil((policy.limit - tokens) / refillRate),
    };
  }
}
