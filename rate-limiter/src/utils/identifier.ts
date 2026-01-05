import { Request } from "express";

/**
 * Determines the strongest possible identifier for rate limiting.
 *
 * Priority:
 * 1. API Key (x-api-key header)
 * 2. Authenticated user ID (req.user)
 * 3. IP address (fallback)
 */
export function getRateLimitKey(req: Request): string {
  // 1️⃣ API key (best identifier)
  const apiKey = req.header("x-api-key");
  if (apiKey) {
    return `rl:apikey:${apiKey}`;
  }

  // 2️⃣ Authenticated user (if auth middleware exists)
  const user = (req as any).user;
  if (user && user.id) {
    return `rl:user:${user.id}`;
  }

  // 3️⃣ Fallback to IP
  return `rl:ip:${req.ip}`;
}
