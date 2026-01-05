const metrics = {
  allowed: 0,
  blocked: 0,
  redisErrors: 0,
};

export function recordAllowed() {
  metrics.allowed++;
}

export function recordBlocked() {
  metrics.blocked++;
}

export function recordRedisError() {
  metrics.redisErrors++;
}

export function getMetrics() {
  return metrics;
}
