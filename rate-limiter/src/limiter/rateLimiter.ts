import { RateLimitPolicy } from "../types/policy";
import { RateLimitResult } from "../types/decision";

export interface RateLimiter {
  consume(
    key: string,
    policy: RateLimitPolicy
  ): Promise<RateLimitResult>;
}

// This is intentionally named:

// “Consume one unit of rate limit capacity”