import { RateLimiter } from "./rateLimiter";
import { RateLimitPolicy } from "../types/policy";
import { RateLimitResult } from "../types/decision";

const store = new Map<string, { count: number; resetAt: number }>();

export class LocalFallbackLimiter implements RateLimiter {
  async consume(
    key: string,
    policy: RateLimitPolicy
  ): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const windowEnd = now + policy.windowSeconds;

    const entry = store.get(key);

    if (!entry || entry.resetAt < now) {
      store.set(key, { count: 1, resetAt: windowEnd });
      return {
        allowed: true,
        remaining: policy.limit - 1,
        resetAt: windowEnd,
      };
    }

    if (entry.count >= policy.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
      };
    }

    entry.count += 1;

    return {
      allowed: true,
      remaining: policy.limit - entry.count,
      resetAt: entry.resetAt,
    };
  }
}
