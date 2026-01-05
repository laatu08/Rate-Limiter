import { Request, Response, NextFunction } from "express";
import { FixedWindowLimiter } from "../limiter/fixedWindow";
import { SlidingWindowLimiter } from "../limiter/slidingWindow";
// import { TokenBucketLimiter } from "../limiter/tokenBucket";
import { TokenBucketLimiter } from "../limiter/updatedTokenBucket";
import { RateLimitPolicy } from "../types/policy";

// const limiter = new FixedWindowLimiter();
// const limiter = new SlidingWindowLimiter();
const limiter = new TokenBucketLimiter();

// Factory function so each route can have its own policy
export function rateLimit(policy: RateLimitPolicy) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Identify client (simple version: IP)
      const key = req.ip || "unknown";

      // Consume from limiter
      const result = await limiter.consume(key, policy);

      // Set rate limit headers
      res.setHeader("X-RateLimit-Limit", policy.limit);
      res.setHeader("X-RateLimit-Remaining", result.remaining);
      res.setHeader("X-RateLimit-Reset", result.resetAt);

      // 4Allow or reject
      if (!result.allowed) {
        return res.status(429).json({
          message: "Too many requests",
        });
      }

      next();
    } catch (err) {
      // Fail-open strategy (important!)
      console.error("Rate limiter error:", err);
      next();
    }
  };
}
