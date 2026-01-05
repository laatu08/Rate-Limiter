import fs from "fs";
import path from "path";
import redis from "../config/redis";
import { RateLimiter } from "./rateLimiter";
import { RateLimitPolicy } from "../types/policy";
import { RateLimitResult } from "../types/decision";

let luaSha: string | null = null;
let luaScript: string | null = null;

async function loadLuaScript(): Promise<string> {
  if (luaSha) return luaSha;

  if (!luaScript) {
    luaScript = fs.readFileSync(
      path.join(__dirname, "leakyBucket.lua"),
      "utf8"
    );
  }

  const result = await redis.script("LOAD", luaScript);

  luaSha=result as string
  return luaSha;
}

export class LeakyBucketLimiter implements RateLimiter {
  async consume(
    key: string,
    policy: RateLimitPolicy
  ): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);

    const leakRate = policy.limit / policy.windowSeconds;
    const sha = await loadLuaScript();

    const result = (await redis.evalsha(
      sha,
      1,
      `leaky_bucket:${key}`,
      policy.limit,
      leakRate,
      now,
      policy.windowSeconds * 2
    )) as [number, number];

    const [allowedFlag, water] = result;

    return {
      allowed: allowedFlag === 1,
      remaining: Math.max(0, policy.limit - Math.ceil(water)),
      resetAt: now + Math.ceil(water / leakRate),
    };
  }
}
