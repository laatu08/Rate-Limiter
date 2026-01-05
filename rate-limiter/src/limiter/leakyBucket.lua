-- KEYS[1] = bucket key
-- ARGV[1] = capacity
-- ARGV[2] = leak rate (req/sec)
-- ARGV[3] = current timestamp (seconds)
-- ARGV[4] = ttl

local data = redis.call("HGETALL", KEYS[1])

local water = 0
local lastLeakTs = tonumber(ARGV[3])

if #data > 0 then
  for i = 1, #data, 2 do
    if data[i] == "water" then
      water = tonumber(data[i + 1])
    elseif data[i] == "lastLeakTs" then
      lastLeakTs = tonumber(data[i + 1])
    end
  end
end

local now = tonumber(ARGV[3])
local leakRate = tonumber(ARGV[2])
local capacity = tonumber(ARGV[1])

-- Leak water
local elapsed = now - lastLeakTs
local leaked = elapsed * leakRate
water = math.max(0, water - leaked)

local allowed = 0
if water + 1 <= capacity then
  water = water + 1
  allowed = 1
end

redis.call("HSET", KEYS[1],
  "water", water,
  "lastLeakTs", now
)

redis.call("EXPIRE", KEYS[1], ARGV[4])

return { allowed, water }
