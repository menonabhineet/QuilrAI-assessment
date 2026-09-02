import { RateLimiterOptions, RateLimitStatus } from "./types.js";

interface TokenUsageRecord {
  timestamp: number;
  tokens: number;
}

/**
 * Sliding window log rate limiter that tracks token usage per tenant.
 * Default: 50,000 tokens per minute (60,000ms).
 */
export class TokenAwareRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private tenantUsage: Map<string, TokenUsageRecord[]> = new Map();

  constructor(options: RateLimiterOptions = {}) {
    this.limit = options.limitTokensPerWindow ?? 50000;
    this.windowMs = options.windowMs ?? 60000;
  }

  /**
   * Estimates token consumption based on prompt character length and requested max_tokens.
   * Standard rule of thumb: ~4 characters per token.
   * Defensively handles empty strings, null, undefined, or non-positive max_tokens.
   */
  public estimateTokens(prompt?: string | null, maxTokens?: number | null): number {
    const text = typeof prompt === "string" ? prompt : "";
    const promptTokens = Math.max(1, Math.ceil(text.length / 4));
    const safeMax = typeof maxTokens === "number" && maxTokens > 0 ? Math.floor(maxTokens) : 100;
    return promptTokens + safeMax;
  }

  private evictExpired(records: TokenUsageRecord[], now: number): TokenUsageRecord[] {
    const cutoff = now - this.windowMs;
    return records.filter((rec) => rec.timestamp > cutoff);
  }

  /**
   * Checks whether a tenant has sufficient quota to consume requestedTokens.
   * If allowed, commits the tokens to the sliding window log.
   */
  public checkAndConsume(tenantId: string, requestedTokens: number, now = Date.now()): RateLimitStatus {
    let records = this.tenantUsage.get(tenantId) || [];
    records = this.evictExpired(records, now);

    const currentUsage = records.reduce((sum, r) => sum + r.tokens, 0);

    if (currentUsage + requestedTokens > this.limit) {
      // Calculate how many seconds until the oldest active record expires
      const oldest = records[0];
      const resetMs = oldest ? Math.max(0, oldest.timestamp + this.windowMs - now) : this.windowMs;
      const resetSeconds = Math.max(1, Math.ceil(resetMs / 1000));

      this.tenantUsage.set(tenantId, records);

      return {
        allowed: false,
        currentUsage,
        limit: this.limit,
        remaining: Math.max(0, this.limit - currentUsage),
        resetSeconds,
      };
    }

    // Quota permitted: record consumption
    records.push({ timestamp: now, tokens: requestedTokens });
    this.tenantUsage.set(tenantId, records);

    const newUsage = currentUsage + requestedTokens;
    return {
      allowed: true,
      currentUsage: newUsage,
      limit: this.limit,
      remaining: Math.max(0, this.limit - newUsage),
      resetSeconds: Math.ceil(this.windowMs / 1000),
    };
  }

  public resetTenant(tenantId: string): void {
    this.tenantUsage.delete(tenantId);
  }

  public resetAll(): void {
    this.tenantUsage.clear();
  }

  public getLimit(): number {
    return this.limit;
  }

  public getWindowMs(): number {
    return this.windowMs;
  }
}
