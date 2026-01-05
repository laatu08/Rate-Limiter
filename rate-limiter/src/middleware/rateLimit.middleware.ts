import { Request, Response, NextFunction } from "express";
import { RateLimitPolicy } from "../types/policy";
import { getLimiter } from "../limiter/limiterFactory";
import { getRateLimitKey } from "../utils/identifier";
import { LocalFallbackLimiter } from "../limiter/localFallback";
import { recordAllowed, recordBlocked, recordRedisError } from "../utils/metrics";

const fallbackLimiter = new LocalFallbackLimiter();

export function rateLimit(policy: RateLimitPolicy) {
  const strategy = policy.failureStrategy ?? "fail-open";

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = getRateLimitKey(req);

    try {
      const limiter = getLimiter(policy.algorithm);
      const result = await limiter.consume(key, policy);

      setHeaders(res, policy, result);

      if (!result.allowed) {
        recordBlocked();
        return res.status(429).json({ message: "Too many requests" });
      }

      recordAllowed();

      next();
    } catch (err) {
      console.error("Rate limiter failure:", err);

      if (strategy === "fail-closed") {
        return res.status(503).json({
          message: "Rate limiting unavailable",
        });
      }

      if (strategy === "local-fallback") {
        const result = await fallbackLimiter.consume(key, policy);
        setHeaders(res, policy, result);

        if (!result.allowed) {
          return res.status(429).json({ message: "Too many requests" });
        }
      }
      recordRedisError();

      // fail-open
      next();
    }
  };
}

function setHeaders(res: Response, policy: RateLimitPolicy, result: any) {
  res.setHeader("X-RateLimit-Limit", policy.limit);
  res.setHeader("X-RateLimit-Remaining", result.remaining);
  res.setHeader("X-RateLimit-Reset", result.resetAt);
}
