export type RateLimitAlgorithm =
  | "fixed_window"
  | "sliding_window"
  | "token_bucket";

export interface RateLimitPolicy {
  limit: number;          // max requests or tokens
  windowSeconds: number;  // time window (for window-based)
  algorithm: RateLimitAlgorithm;
}
