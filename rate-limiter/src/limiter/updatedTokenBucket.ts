import fs from "fs";
import path from "path";
import redis from "../config/redis";
import { RateLimiter } from "./rateLimiter";
import { RateLimitPolicy } from "../types/policy";
import { RateLimitResult } from "../types/decision";

let luaSha: string | null = null;
let luaScript: string | null = null;

async function loadLuaScript(): Promise<string> {
  if (luaSha) {
    return luaSha;
  }

  if (!luaScript) {
    luaScript = fs.readFileSync(
      path.join(__dirname, "tokenBucket.lua"),
      "utf8"
    );
  }

  const result = await redis.script("LOAD", luaScript);

  luaSha = result as string; // ✅ explicit assertion
  return luaSha;
}


export class TokenBucketLimiter implements RateLimiter {
  async consume(
    key: string,
    policy: RateLimitPolicy
  ): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const refillRate = policy.limit / policy.windowSeconds;

    const sha = await loadLuaScript();

    const result = (await redis.evalsha(
      sha,
      1,
      `token_bucket:${key}`,
      policy.limit,
      refillRate,
      now,
      policy.windowSeconds * 2
    )) as [number, number];

    const [allowedFlag, tokens] = result;

    return {
      allowed: allowedFlag === 1,
      remaining: Math.floor(tokens),
      resetAt: now + Math.ceil((policy.limit - tokens) / refillRate),
    };
  }
}
