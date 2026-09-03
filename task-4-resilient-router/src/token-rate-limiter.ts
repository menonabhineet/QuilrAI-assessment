import { RateLimiterOptions, RateLimitStatus } from "./types.js";

interface TenantUsage {
  prevWindowCount: number;
  currWindowCount: number;
  currWindowStartTime: number;
}

/**
 * Sliding window log rate limiter that tracks token usage per tenant.
 * Default: 50,000 tokens per minute (60,000ms).
 */
export class TokenAwareRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxTenants: number;
  private lastEvictionTime: number = 0;
  private tenantUsage: Map<string, TenantUsage> = new Map();

  constructor(options: RateLimiterOptions = {}) {
    this.limit = options.limitTokensPerWindow ?? 50000;
    this.windowMs = options.windowMs ?? 60000;
    this.maxTenants = options.maxTenants ?? 10000;
  }

  /**
   * Sweeps and evicts tenant records where activity has ceased for more than 2 sliding windows.
   * Returns count of evicted tenants.
   */
  public evictExpiredTenants(now = Date.now()): number {
    let evicted = 0;
    for (const [tenantId, record] of this.tenantUsage.entries()) {
      if (now - record.currWindowStartTime >= 2 * this.windowMs) {
        this.tenantUsage.delete(tenantId);
        evicted++;
      }
    }
    this.lastEvictionTime = now;
    return evicted;
  }

  /**
   * Reconciles estimated token quota reservation against actual tokens consumed.
   * Refunds unused tokens back to tenant's current window.
   */
  public reconcileTokens(tenantId: string, estimatedTokens: number, actualTokens: number): void {
    const record = this.tenantUsage.get(tenantId);
    if (!record) return;
    const unused = estimatedTokens - actualTokens;
    if (unused > 0) {
      record.currWindowCount = Math.max(0, record.currWindowCount - unused);
    }
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

  /**
   * Checks whether a tenant has sufficient quota to consume requestedTokens.
   * If allowed, commits the tokens to the sliding window log.
   */
  public checkAndConsume(tenantId: string, requestedTokens: number, now = Date.now()): RateLimitStatus {
    // Periodic active eviction check
    if (now - this.lastEvictionTime >= this.windowMs) {
      this.evictExpiredTenants(now);
    }

    let record = this.tenantUsage.get(tenantId);
    if (!record) {
      // Enforce bounded memory: evict oldest entry if at capacity limit
      if (this.tenantUsage.size >= this.maxTenants) {
        const oldestKey = this.tenantUsage.keys().next().value;
        if (oldestKey) this.tenantUsage.delete(oldestKey);
      }
      record = { prevWindowCount: 0, currWindowCount: 0, currWindowStartTime: now };
    }

    // Advance window if needed
    let elapsed = now - record.currWindowStartTime;
    if (elapsed >= this.windowMs) {
      const windowsPassed = Math.floor(elapsed / this.windowMs);
      if (windowsPassed === 1) {
        record.prevWindowCount = record.currWindowCount;
      } else {
        record.prevWindowCount = 0; // More than 2 windows passed
      }
      record.currWindowCount = 0;
      record.currWindowStartTime += windowsPassed * this.windowMs;
      elapsed = now - record.currWindowStartTime;
    }

    const weight = Math.max(0, 1 - (elapsed / this.windowMs));
    const estimatedUsage = record.prevWindowCount * weight + record.currWindowCount;
    const currentUsage = Math.ceil(estimatedUsage);

    if (currentUsage + requestedTokens > this.limit) {
      // Calculate how many seconds until fully requested quota is available
      let resetMs = this.windowMs;
      if (requestedTokens <= this.limit && record.prevWindowCount > 0) {
        const requiredWeight = (this.limit - record.currWindowCount - requestedTokens) / record.prevWindowCount;
        if (requiredWeight >= 0) {
          const targetElapsed = this.windowMs * (1 - requiredWeight);
          resetMs = Math.max(0, targetElapsed - elapsed);
        } else {
          resetMs = this.windowMs - elapsed;
        }
      } else if (requestedTokens <= this.limit) {
        resetMs = this.windowMs - elapsed;
      }
      
      const resetSeconds = Math.max(1, Math.ceil(resetMs / 1000));
      this.tenantUsage.set(tenantId, record);

      return {
        allowed: false,
        currentUsage,
        limit: this.limit,
        remaining: Math.max(0, this.limit - currentUsage),
        resetSeconds,
      };
    }

    // Quota permitted: record consumption
    record.currWindowCount += requestedTokens;
    this.tenantUsage.set(tenantId, record);

    const newUsage = Math.ceil(record.prevWindowCount * weight + record.currWindowCount);
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

  public getTenantCount(): number {
    return this.tenantUsage.size;
  }

  public getMaxTenants(): number {
    return this.maxTenants;
  }
}
