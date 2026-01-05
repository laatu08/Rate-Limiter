-- KEYS[1] = bucket key
-- ARGV[1] = capacity
-- ARGV[2] = refill rate (tokens per second)
-- ARGV[3] = current timestamp (seconds)
-- ARGV[4] = ttl (seconds)

local bucket = redis.call("HGETALL", KEYS[1])

local tokens = tonumber(ARGV[1])
local lastRefill = tonumber(ARGV[3])

if #bucket > 0 then
  for i = 1, #bucket, 2 do
    if bucket[i] == "tokens" then
      tokens = tonumber(bucket[i + 1])
    elseif bucket[i] == "lastRefillTs" then
      lastRefill = tonumber(bucket[i + 1])
    end
  end
end

local now = tonumber(ARGV[3])
local refillRate = tonumber(ARGV[2])

local elapsed = now - lastRefill
local refill = elapsed * refillRate
tokens = math.min(tonumber(ARGV[1]), tokens + refill)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call("HSET", KEYS[1],
  "tokens", tokens,
  "lastRefillTs", now
)

redis.call("EXPIRE", KEYS[1], ARGV[4])

return { allowed, tokens }
