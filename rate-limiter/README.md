# Rate Limiter

A production-ready, Redis-backed rate limiting system for Node.js/Express applications with multiple algorithms, failure strategies, and comprehensive monitoring.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Rate Limiting Algorithms](#rate-limiting-algorithms)
  - [Fixed Window](#1-fixed-window)
  - [Sliding Window](#2-sliding-window)
  - [Token Bucket](#3-token-bucket)
  - [Leaky Bucket](#4-leaky-bucket)
- [Design Patterns](#design-patterns)
- [Failure Strategies](#failure-strategies)
- [Key Generation Strategy](#key-generation-strategy)
- [Installation & Setup](#installation--setup)
- [Usage Examples](#usage-examples)
- [Monitoring](#monitoring)
- [Performance Optimization](#performance-optimization)

---

## Overview

This rate limiter provides a flexible, scalable solution for controlling request rates in distributed systems. It supports four different rate limiting algorithms, each with unique characteristics suited for different use cases.

**Key Features:**
- Multiple rate limiting algorithms (Fixed Window, Sliding Window, Token Bucket, Leaky Bucket)
- Redis-backed for distributed systems
- Lua scripts for atomic operations
- Graceful failure handling (fail-open, fail-closed, local fallback)
- Real-time metrics and monitoring
- Flexible identifier strategies (API key, user ID, IP address)
- Express middleware integration

---

## Architecture

### Project Structure

```
src/
├── limiter/
│   ├── rateLimiter.ts           # Interface definition
│   ├── limiterFactory.ts        # Factory pattern for algorithm selection
│   ├── fixedWindow.ts           # Fixed window implementation
│   ├── slidingWindow.ts         # Sliding window implementation
│   ├── tokenBucket.ts           # Token bucket (non-Lua)
│   ├── updatedTokenBucket.ts    # Token bucket with Lua
│   ├── tokenBucket.lua          # Lua script for atomic token bucket
│   ├── leakyBucket.ts           # Leaky bucket with Lua
│   ├── leakyBucket.lua          # Lua script for atomic leaky bucket
│   └── localFallback.ts         # In-memory fallback limiter
├── middleware/
│   └── rateLimit.middleware.ts  # Express middleware
├── config/
│   └── redis.ts                 # Redis connection
├── types/
│   ├── policy.ts                # Rate limit policy types
│   ├── decision.ts              # Result types
│   └── failure.ts               # Failure strategy types
└── utils/
    ├── identifier.ts            # Key generation logic
    └── metrics.ts               # Metrics collection
```

### Core Components

1. **RateLimiter Interface**: Defines the contract all algorithms must follow
2. **LimiterFactory**: Creates appropriate limiter instances based on algorithm type
3. **Middleware**: Express middleware that orchestrates rate limiting logic
4. **Redis Configuration**: Manages Redis connection with error handling
5. **Metrics System**: Tracks allowed requests, blocked requests, and errors

---

## Rate Limiting Algorithms

### 1. Fixed Window

**File:** `src/limiter/fixedWindow.ts`

#### How It Works

The fixed window algorithm divides time into fixed-size windows and counts requests within each window.

```
Window 1: 00:00-00:10 → 5 requests
Window 2: 00:10-00:20 → 3 requests
Window 3: 00:20-00:30 → 7 requests
```

**Implementation Logic:**

1. Calculate current window start time: `windowStart = floor(now / windowSeconds) * windowSeconds`
2. Create Redis key: `rate_limit:{identifier}:{windowStart}`
3. Increment counter for this window using `INCR`
4. Set TTL on first request to auto-cleanup expired windows
5. Allow request if `count <= limit`

**Pros:**
- Simple to implement and understand
- Memory efficient (one counter per window)
- Predictable reset behavior
- Low computational overhead

**Cons:**
- **Boundary burst problem**: A user can make `2 × limit` requests by splitting them across window boundaries
  - Example: 5 requests at 00:09:59, then 5 more at 00:10:01 = 10 requests in 2 seconds
- Not ideal for strict rate limiting

**Best For:**
- Simple rate limiting needs
- When slight burstiness is acceptable
- Analytics and metrics collection
- Low-traffic APIs

**Redis Operations:**
```redis
INCR rate_limit:user123:1704470400
EXPIRE rate_limit:user123:1704470400 10
```

---

### 2. Sliding Window

**File:** `src/limiter/slidingWindow.ts`

#### How It Works

Sliding window improves upon fixed window by considering the previous window's traffic, creating a "sliding" effect that smooths out boundary issues.

**Formula:**
```
effectiveCount = currentWindowCount + (previousWindowCount × overlapRatio)
overlapRatio = (windowSize - elapsed) / windowSize
```

**Visual Example:**
```
Previous Window [========]      (8 requests)
Current Window          [====]  (4 requests, 40% elapsed)

Overlap ratio = (10s - 4s) / 10s = 0.6
Effective count = 4 + (8 × 0.6) = 4 + 4.8 = 8.8 ≈ 9 requests
```

**Implementation Logic:**

1. Maintain counters for current and previous windows
2. Calculate time elapsed in current window
3. Determine overlap ratio from previous window
4. Weight previous window's count by overlap ratio
5. Sum weighted previous count with current count
6. Allow request if effective count doesn't exceed limit

**Pros:**
- Significantly reduces boundary burst problem
- More accurate than fixed window
- Still relatively simple
- Better traffic distribution

**Cons:**
- Requires storing two window counters
- Slightly more complex calculation
- Small memory overhead
- Not perfectly precise (uses approximation)

**Best For:**
- General-purpose rate limiting
- APIs with moderate traffic
- When you need better accuracy than fixed window
- Balancing simplicity and effectiveness

**Redis Operations:**
```redis
INCR rate_limit:user123:1704470400      # Current window
GET rate_limit:user123:1704470390       # Previous window
```

---

### 3. Token Bucket

**File:** `src/limiter/updatedTokenBucket.ts` + `tokenBucket.lua`

#### How It Works

Token bucket is a classic algorithm where tokens are added to a bucket at a constant rate. Each request consumes one token. If no tokens are available, the request is denied.

**Conceptual Model:**
```
Bucket Capacity: 10 tokens
Refill Rate: 1 token/second

Time 0:  [••••••••••] 10 tokens → Request → [•••••••••] 9 tokens
Time 5:  [••••••••••] 10 tokens (refilled 5, was at 5)
Time 10: [••••••••••] 10 tokens (capped at capacity)
```

**Implementation Logic:**

1. Store bucket state: `{ tokens, lastRefillTs }`
2. Calculate elapsed time since last refill: `elapsed = now - lastRefillTs`
3. Calculate tokens to add: `refill = elapsed × refillRate`
4. Update token count: `tokens = min(capacity, tokens + refill)`
5. If `tokens >= 1`, consume one token and allow request
6. Update bucket state atomically using Lua script

**Lua Script Logic:**
```lua
-- Load current state (tokens, lastRefillTs)
-- Calculate refill based on elapsed time
-- Add refilled tokens (capped at capacity)
-- If tokens >= 1: consume one token, allow = 1
-- Else: allow = 0
-- Save new state
-- Return [allowed, tokens]
```

**Why Lua?**
- **Atomicity**: All operations execute as a single transaction
- **Race condition prevention**: No conflicts in distributed systems
- **Performance**: Single round-trip to Redis
- **Consistency**: Guaranteed correct state even under high concurrency

**Pros:**
- **Burst handling**: Allows bursts up to bucket capacity when tokens have accumulated
- Smooth traffic shaping
- Flexible refill rates
- Good for APIs with variable traffic patterns

**Cons:**
- More complex to implement
- Requires Lua scripting for atomicity
- State management overhead
- Can be "gamed" by waiting for token accumulation

**Best For:**
- APIs that need to allow short bursts
- Traffic shaping and throttling
- Cloud APIs (AWS, Google Cloud use this)
- Systems with variable load patterns

**Redis Operations:**
```redis
-- Lua script ensures atomicity
EVALSHA <sha> 1 token_bucket:user123 10 1.0 1704470450 20
-- Returns: [1, 9.5] → allowed=true, tokens=9.5
```

---

### 4. Leaky Bucket

**File:** `src/limiter/leakyBucket.ts` + `leakyBucket.lua`

#### How It Works

Leaky bucket models a bucket with a hole at the bottom. Requests add water to the bucket, which leaks out at a constant rate. If the bucket overflows, requests are denied.

**Conceptual Model:**
```
Capacity: 10 units
Leak Rate: 1 unit/second

Time 0:  [~~~~] 4 units → Request → [~~~~~] 5 units
Time 1:  [~~~~] 4 units (leaked 1 unit)
Time 5:  [empty] 0 units (fully leaked)
```

**Implementation Logic:**

1. Store bucket state: `{ water, lastLeakTs }`
2. Calculate elapsed time since last leak: `elapsed = now - lastLeakTs`
3. Calculate leaked amount: `leaked = elapsed × leakRate`
4. Update water level: `water = max(0, water - leaked)`
5. If `water + 1 <= capacity`, add request to bucket and allow
6. Update bucket state atomically using Lua script

**Lua Script Logic:**
```lua
-- Load current state (water, lastLeakTs)
-- Calculate leak based on elapsed time
-- Reduce water level by leaked amount
-- If water + 1 <= capacity: add request, allow = 1
-- Else: deny, allow = 0
-- Save new state
-- Return [allowed, water]
```

**Key Difference from Token Bucket:**
- **Token Bucket**: Tokens accumulate up to capacity (allows bursts)
- **Leaky Bucket**: Water is added by requests and drains at fixed rate (enforces steady rate)

**Pros:**
- **Strict rate enforcement**: Provides smooth, predictable output rate
- No burst allowance (can be a pro or con depending on needs)
- Simple conceptual model
- Excellent for traffic shaping

**Cons:**
- No burst handling (strict disadvantage for user experience)
- Complex implementation
- Requires Lua for atomicity
- Can frustrate users during legitimate traffic spikes

**Best For:**
- **Strict rate enforcement scenarios**
- Protecting downstream services from bursts
- Network traffic shaping
- APIs that must maintain consistent load
- When predictability is more important than flexibility

**Redis Operations:**
```redis
EVALSHA <sha> 1 leaky_bucket:user123 10 1.0 1704470450 20
-- Returns: [1, 5.2] → allowed=true, water=5.2
```

---

## Algorithm Comparison Table

| Algorithm | Burst Handling | Accuracy | Complexity | Memory | Use Case |
|-----------|---------------|----------|------------|---------|----------|
| **Fixed Window** | Poor (2× burst) | Low | Low | Low | Simple APIs, metrics |
| **Sliding Window** | Fair | Medium | Medium | Medium | General purpose |
| **Token Bucket** | Excellent (allows bursts) | High | High | Medium | Variable traffic, cloud APIs |
| **Leaky Bucket** | None (strict) | High | High | Medium | Traffic shaping, strict limits |

---

## Design Patterns

### 1. Strategy Pattern

**Location:** Algorithm implementations

Each rate limiting algorithm implements the `RateLimiter` interface, allowing them to be used interchangeably.

```typescript
interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitResult>;
}
```

**Benefits:**
- Easy to add new algorithms
- Algorithm selection at runtime
- Testable in isolation
- Clean separation of concerns

### 2. Factory Pattern

**Location:** `src/limiter/limiterFactory.ts`

The factory creates and manages singleton instances of each limiter algorithm.

```typescript
const limiters: Record<RateLimitAlgorithm, RateLimiter> = {
  fixed_window: new FixedWindowLimiter(),
  sliding_window: new SlidingWindowLimiter(),
  token_bucket: new TokenBucketLimiter(),
  leaky_bucket: new LeakyBucketLimiter(),
};
```

**Why Singletons?**
- **Lua SHA caching**: Lua scripts are loaded once and reused
- Memory efficiency
- Consistent state management

### 3. Middleware Pattern

**Location:** `src/middleware/rateLimit.middleware.ts`

Express middleware wraps rate limiting logic, making it easy to apply to routes.

```typescript
app.get("/api/test", rateLimit({
  limit: 5,
  windowSeconds: 10,
  algorithm: "token_bucket"
}), handler);
```

**Benefits:**
- Declarative rate limiting
- Reusable across routes
- Separation of concerns
- Easy to test

### 4. Fallback Pattern

**Location:** `src/limiter/localFallback.ts`

In-memory fallback when Redis is unavailable, providing graceful degradation.

**Benefits:**
- System resilience
- No single point of failure
- Graceful degradation
- Better user experience during outages

---

## Failure Strategies

### 1. Fail-Open (Default)

When Redis fails, **allow all requests** through.

**Use Case:** When availability is more important than strict rate limiting (e.g., public APIs, user-facing services)

**Trade-off:** Risk of overload during Redis outage

### 2. Fail-Closed

When Redis fails, **deny all requests**.

**Use Case:** When protection is critical (e.g., payment APIs, security-sensitive endpoints)

**Trade-off:** Service unavailability during Redis outage

### 3. Local-Fallback

When Redis fails, **use in-memory rate limiting**.

**Use Case:** Best of both worlds—maintain some protection while staying available

**Trade-off:** Rate limits are per-instance (not distributed), may allow higher overall rate

**Implementation:**
```typescript
rateLimit({
  limit: 5,
  windowSeconds: 10,
  algorithm: "token_bucket",
  failureStrategy: "local-fallback"  // ← Activate fallback
})
```

---

## Key Generation Strategy

**Location:** `src/utils/identifier.ts`

The system uses a **priority-based identifier strategy** to determine rate limit keys:

### Priority Order:

1. **API Key** (highest priority)
   - Header: `x-api-key`
   - Key format: `rl:apikey:{key}`
   - Most secure and reliable identifier

2. **User ID** (authenticated users)
   - From: `req.user.id`
   - Key format: `rl:user:{userId}`
   - Requires authentication middleware

3. **IP Address** (fallback)
   - From: `req.ip`
   - Key format: `rl:ip:{ipAddress}`
   - Least reliable (NAT, proxies, VPNs)

**Why This Order?**
- API keys are unique and can't be spoofed
- User IDs work across IPs (mobile users)
- IP addresses are last resort (shared IPs can cause false limits)

**Proxy Support:**
```typescript
app.set("trust proxy", true);  // Required for accurate IP detection
```

---

## Installation & Setup

### Prerequisites

- Node.js 18+
- Redis server
- TypeScript

### Install Dependencies

```bash
npm install
```

### Environment Variables

Create `.env` file:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
PORT=3000
```

### Build & Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

---

## Usage Examples

### Basic Usage

```typescript
import { rateLimit } from "./middleware/rateLimit.middleware";

app.get("/api/data",
  rateLimit({
    limit: 100,
    windowSeconds: 60,
    algorithm: "sliding_window"
  }),
  (req, res) => {
    res.json({ data: "..." });
  }
);
```

### Different Algorithms for Different Endpoints

```typescript
// Public endpoint: Allow bursts
app.get("/api/search",
  rateLimit({
    limit: 20,
    windowSeconds: 60,
    algorithm: "token_bucket"
  }),
  searchHandler
);

// Strict endpoint: No bursts
app.post("/api/payment",
  rateLimit({
    limit: 5,
    windowSeconds: 60,
    algorithm: "leaky_bucket",
    failureStrategy: "fail-closed"
  }),
  paymentHandler
);
```

### Custom Failure Handling

```typescript
app.get("/api/critical",
  rateLimit({
    limit: 10,
    windowSeconds: 60,
    algorithm: "fixed_window",
    failureStrategy: "fail-closed"  // Block on Redis failure
  }),
  criticalHandler
);
```

---

## Monitoring

### Metrics Endpoint

```bash
GET /metrics
```

**Response:**
```json
{
  "allowed": 1523,
  "blocked": 47,
  "redisErrors": 2
}
```

### Response Headers

Every rate-limited request includes headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1704470520
```

**Usage:**
- `Limit`: Maximum requests allowed
- `Remaining`: Requests left in current window
- `Reset`: Unix timestamp when limit resets

---

## Performance Optimization

### 1. Lua Script Caching

Lua scripts are loaded once and cached using SHA:

```typescript
let luaSha: string | null = null;

async function loadLuaScript(): Promise<string> {
  if (luaSha) return luaSha;  // ← Return cached SHA

  luaScript = fs.readFileSync("script.lua", "utf8");
  luaSha = await redis.script("LOAD", luaScript);
  return luaSha;
}
```

**Benefit:** Reduces Redis round-trips from 2 to 1 per request

### 2. Singleton Limiter Instances

Factory pattern creates limiters once:

```typescript
const limiters = {
  fixed_window: new FixedWindowLimiter(),  // ← Created once
  // ...
};
```

**Benefit:** Shared Lua SHA cache across all requests

### 3. TTL-Based Cleanup

Redis keys auto-expire:

```typescript
await redis.expire(key, windowSeconds * 2);
```

**Benefit:** Automatic memory management, no manual cleanup needed

### 4. Atomic Operations

All state updates use Lua scripts or Redis atomic commands:

```redis
INCR key        # ← Atomic increment
EVALSHA sha ...  # ← Atomic multi-step operation
```

**Benefit:** No race conditions in distributed systems

---

## Common Pitfalls & Solutions

### Problem: Boundary Burst with Fixed Window

**Solution:** Use sliding window or token/leaky bucket

### Problem: Redis Connection Failures

**Solution:** Implement appropriate failure strategy (local-fallback recommended)

### Problem: Shared IPs Causing False Limits

**Solution:** Use API keys or authentication-based rate limiting

### Problem: Memory Growth in Redis

**Solution:** All keys have TTL set automatically

---

## Advanced Configuration

### Per-User Custom Limits

```typescript
function getUserLimit(userId: string): RateLimitPolicy {
  const user = getUser(userId);

  return {
    limit: user.tier === "premium" ? 1000 : 100,
    windowSeconds: 60,
    algorithm: "token_bucket"
  };
}

app.get("/api/data",
  (req, res, next) => {
    const policy = getUserLimit(req.user.id);
    return rateLimit(policy)(req, res, next);
  },
  handler
);
```

### Multiple Rate Limits

```typescript
// Apply both per-second and per-hour limits
app.get("/api/data",
  rateLimit({ limit: 10, windowSeconds: 1, algorithm: "leaky_bucket" }),
  rateLimit({ limit: 1000, windowSeconds: 3600, algorithm: "sliding_window" }),
  handler
);
```

---

## Testing

### Health Check

```bash
curl http://localhost:3000/health
```

### Rate Limit Test

```bash
# Make multiple requests quickly
for i in {1..10}; do
  curl http://localhost:3000/api/test
done
```

### Expected Behavior

- First 5 requests: `200 OK`
- Next 5 requests: `429 Too Many Requests`

---

## Algorithm Selection Guide

**Choose Fixed Window when:**
- You need simple, lightweight rate limiting
- Slight burstiness is acceptable
- You're doing analytics/metrics

**Choose Sliding Window when:**
- You need general-purpose rate limiting
- You want better accuracy than fixed window
- Balance between simplicity and effectiveness is important

**Choose Token Bucket when:**
- You want to allow bursts
- Traffic is variable and unpredictable
- User experience during traffic spikes matters
- Building a cloud API or service

**Choose Leaky Bucket when:**
- You need strict, consistent rate enforcement
- Protecting downstream services from bursts
- Predictability is more important than flexibility
- Building network traffic shaper or strict API limits

---

## License

ISC

---

## Contributing

Contributions welcome! Please ensure:
- All tests pass
- Code follows existing patterns
- Lua scripts are documented
- Performance implications are considered

---

## References

- [Token Bucket Algorithm - Wikipedia](https://en.wikipedia.org/wiki/Token_bucket)
- [Leaky Bucket Algorithm - Wikipedia](https://en.wikipedia.org/wiki/Leaky_bucket)
- [Rate Limiting Strategies - Stripe Engineering](https://stripe.com/blog/rate-limiters)
- [Redis Lua Scripting](https://redis.io/docs/manual/programmability/eval-intro/)
