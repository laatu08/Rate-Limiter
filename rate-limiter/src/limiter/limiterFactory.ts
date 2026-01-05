import { RateLimiter } from "./rateLimiter";
import { FixedWindowLimiter } from "./fixedWindow";
import { SlidingWindowLimiter } from "./slidingWindow";
import { TokenBucketLimiter } from "./updatedTokenBucket";
import { LeakyBucketLimiter } from "./leakyBucket";
import { RateLimitAlgorithm } from "../types/policy";

/**
 * Singleton instances (important for Lua SHA caching)
 */
const limiters: Record<RateLimitAlgorithm, RateLimiter> = {
  fixed_window: new FixedWindowLimiter(),
  sliding_window: new SlidingWindowLimiter(),
  token_bucket: new TokenBucketLimiter(),
  leaky_bucket: new LeakyBucketLimiter(),
};

export function getLimiter(
  algorithm: RateLimitAlgorithm
): RateLimiter {
  const limiter = limiters[algorithm];
  if (!limiter) {
    throw new Error(`Unsupported rate limit algorithm: ${algorithm}`);
  }
  return limiter;
}
