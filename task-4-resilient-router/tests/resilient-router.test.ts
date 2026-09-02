import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MockModelProvider } from "../src/mock-providers.js";
import { ResilientRouterGatewayServer } from "../src/gateway-server.js";
import { TokenAwareRateLimiter } from "../src/token-rate-limiter.js";

describe("Task 4: Rate-Limiting & Model Fallback Router", () => {
  describe("TokenAwareRateLimiter Unit Tests", () => {
    let rateLimiter: TokenAwareRateLimiter;

    beforeEach(() => {
      // 1,000 tokens limit per 1,000ms window for fast unit testing
      rateLimiter = new TokenAwareRateLimiter({
        limitTokensPerWindow: 1000,
        windowMs: 1000,
      });
    });

    it("allows token consumption within window limit", () => {
      const res1 = rateLimiter.checkAndConsume("tenant-1", 400);
      expect(res1.allowed).toBe(true);
      expect(res1.currentUsage).toBe(400);
      expect(res1.remaining).toBe(600);

      const res2 = rateLimiter.checkAndConsume("tenant-1", 500);
      expect(res2.allowed).toBe(true);
      expect(res2.currentUsage).toBe(900);
      expect(res2.remaining).toBe(100);
    });

    it("rejects token consumption that exceeds window limit", () => {
      rateLimiter.checkAndConsume("tenant-1", 800);

      // Attempting to consume 300 tokens (800 + 300 = 1100 > 1000)
      const rejected = rateLimiter.checkAndConsume("tenant-1", 300);
      expect(rejected.allowed).toBe(false);
      expect(rejected.currentUsage).toBe(800);
      expect(rejected.remaining).toBe(200);
      expect(rejected.resetSeconds).toBeGreaterThanOrEqual(1);
    });

    it("isolates rate limit quotas across separate tenants", () => {
      // Tenant A maxes out quota
      const resA = rateLimiter.checkAndConsume("tenant-a", 1000);
      expect(resA.allowed).toBe(true);

      const blockedA = rateLimiter.checkAndConsume("tenant-a", 50);
      expect(blockedA.allowed).toBe(false);

      // Tenant B has full quota available
      const resB = rateLimiter.checkAndConsume("tenant-b", 500);
      expect(resB.allowed).toBe(true);
      expect(resB.remaining).toBe(500);
    });

    it("evicts expired tokens when sliding window elapses", async () => {
      rateLimiter.checkAndConsume("tenant-1", 1000);

      const immediateCheck = rateLimiter.checkAndConsume("tenant-1", 100);
      expect(immediateCheck.allowed).toBe(false);

      // Wait for window to expire (1050ms)
      await new Promise((r) => setTimeout(r, 1050));

      const afterExpiryCheck = rateLimiter.checkAndConsume("tenant-1", 500);
      expect(afterExpiryCheck.allowed).toBe(true);
      expect(afterExpiryCheck.currentUsage).toBe(500);
    });

    it("handles exact boundary consumption when usage exactly matches limit", () => {
      // Consume 750 tokens
      const res1 = rateLimiter.checkAndConsume("tenant-exact", 750);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(250);

      // Consume exactly 250 tokens (total 1000 == limit 1000)
      const res2 = rateLimiter.checkAndConsume("tenant-exact", 250);
      expect(res2.allowed).toBe(true);
      expect(res2.currentUsage).toBe(1000);
      expect(res2.remaining).toBe(0);

      // Next single token request must be rejected
      const res3 = rateLimiter.checkAndConsume("tenant-exact", 1);
      expect(res3.allowed).toBe(false);
      expect(res3.remaining).toBe(0);
    });

    it("rejects a single oversized request exceeding total window limit", () => {
      const res = rateLimiter.checkAndConsume("tenant-heavy", 1500); // 1500 > 1000 limit
      expect(res.allowed).toBe(false);
      expect(res.currentUsage).toBe(0);
      expect(res.remaining).toBe(1000);
    });

    it("defensively estimates tokens for empty, null, or undefined inputs", () => {
      expect(rateLimiter.estimateTokens("")).toBe(101); // 1 prompt token + 100 default max_tokens
      expect(rateLimiter.estimateTokens(null, null)).toBe(101);
      expect(rateLimiter.estimateTokens(undefined, -10)).toBe(101);
      expect(rateLimiter.estimateTokens("12345678", 50)).toBe(52); // 2 prompt tokens + 50 max_tokens
    });
  });

  describe("HTTP Gateway & Resilient Router Integration", () => {
    let primaryProvider: MockModelProvider;
    let secondaryProvider: MockModelProvider;
    let gatewayServer: ResilientRouterGatewayServer;
    let gatewayUrl: string;

    beforeAll(async () => {
      // Ephemeral ports
      primaryProvider = new MockModelProvider("primary-model", 0);
      const primaryPort = await primaryProvider.start();

      secondaryProvider = new MockModelProvider("secondary-model", 0);
      const secondaryPort = await secondaryProvider.start();

      gatewayServer = new ResilientRouterGatewayServer({
        port: 0,
        rateLimiterOptions: {
          limitTokensPerWindow: 50000,
          windowMs: 60000,
        },
        routerOptions: {
          primaryUrl: `http://127.0.0.1:${primaryPort}`,
          secondaryUrl: `http://127.0.0.1:${secondaryPort}`,
          timeoutMs: 1500, // Configured for fast integration testing (1.5s timeout)
        },
      });

      const gatewayPort = await gatewayServer.start();
      gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
    });

    afterAll(async () => {
      await gatewayServer?.stop();
      await secondaryProvider?.stop();
      await primaryProvider?.stop();
    });

    beforeEach(() => {
      primaryProvider.resetStats();
      primaryProvider.setMode("healthy");
      secondaryProvider.resetStats();
      secondaryProvider.setMode("healthy");
      gatewayServer.rateLimiter.resetAll();
    });

    async function sendCompletion(
      payload: Record<string, unknown>,
      tenantId = "test-tenant-01"
    ): Promise<{ status: number; body: any; headers: Headers }> {
      const res = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${tenantId}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      return { status: res.status, body, headers: res.headers };
    }

    it("routes to primary model when primary is healthy", async () => {
      const { status, body, headers } = await sendCompletion({
        prompt: "Summarize financial performance for Q3",
        max_tokens: 150,
      });

      expect(status).toBe(200);
      expect(body.provider).toBe("primary");
      expect(body.fallback_occurred).toBe(false);
      expect(body.content).toContain("primary-model");
      expect(headers.get("x-model-provider")).toBe("primary");
      expect(headers.get("x-fallback-occurred")).toBe("false");

      expect(primaryProvider.requestCount).toBe(1);
      expect(secondaryProvider.requestCount).toBe(0);
    });

    it("enforces 50,000 tokens/minute rate limit and returns HTTP 429", async () => {
      // Simulate consuming close to 50k tokens
      gatewayServer.rateLimiter.checkAndConsume("heavy-tenant", 49000);

      // Request that requires ~1500 tokens (will exceed 50k limit)
      const prompt = "A".repeat(4000); // ~1000 prompt tokens + 500 max_tokens = 1500 tokens
      const { status, body, headers } = await sendCompletion(
        { prompt, max_tokens: 500 },
        "heavy-tenant"
      );

      expect(status).toBe(429);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(body.error.message).toContain("Rate limit exceeded");
      expect(headers.get("retry-after")).toBeDefined();
      expect(headers.get("x-ratelimit-remaining")).toBe("0");

      // No request should have reached upstream providers
      expect(primaryProvider.requestCount).toBe(0);
      expect(secondaryProvider.requestCount).toBe(0);
    });

    it("fails over to secondary provider when primary returns HTTP 429", async () => {
      // Configure primary to simulate rate limit
      primaryProvider.setMode("rate_limit_429");

      const { status, body, headers } = await sendCompletion({
        prompt: "Classify incoming customer support tickets",
      });

      expect(status).toBe(200);
      expect(body.provider).toBe("secondary");
      expect(body.fallback_occurred).toBe(true);
      expect(body.fallback_reason).toBe("primary_rate_limited_429");
      expect(body.content).toContain("secondary-model");
      expect(headers.get("x-model-provider")).toBe("secondary");
      expect(headers.get("x-fallback-occurred")).toBe("true");

      // Both providers were called (primary failed, secondary succeeded)
      expect(primaryProvider.requestCount).toBe(1);
      expect(secondaryProvider.requestCount).toBe(1);
    });

    it("fails over to secondary provider when primary times out after deadline", async () => {
      // Configure primary to hang for 3000ms (exceeds router's 1500ms timeout)
      primaryProvider.setMode("timeout");
      primaryProvider.timeoutDelayMs = 3000;

      const { status, body } = await sendCompletion({
        prompt: "Generate architectural review document",
      });

      expect(status).toBe(200);
      expect(body.provider).toBe("secondary");
      expect(body.fallback_occurred).toBe(true);
      expect(body.fallback_reason).toContain("primary_timeout");
      expect(body.content).toContain("secondary-model");

      expect(primaryProvider.requestCount).toBe(1);
      expect(secondaryProvider.requestCount).toBe(1);
    }, 6000);

    it("fails over to secondary provider when primary returns HTTP 500 internal error", async () => {
      primaryProvider.setMode("internal_error");

      const { status, body } = await sendCompletion({
        prompt: "Diagnose failing database transactions",
      });

      expect(status).toBe(200);
      expect(body.provider).toBe("secondary");
      expect(body.fallback_occurred).toBe(true);
      expect(body.fallback_reason).toBe("primary_server_error");
      expect(body.content).toContain("secondary-model");

      expect(primaryProvider.requestCount).toBe(1);
      expect(secondaryProvider.requestCount).toBe(1);
    });

    it("fails over to secondary provider when primary connection is refused", async () => {
      // Create a temporary router pointing to an unreachable port for primary
      const unreachableGateway = new ResilientRouterGatewayServer({
        port: 0,
        routerOptions: {
          primaryUrl: "http://127.0.0.1:59999", // Unreachable port
          secondaryUrl: `http://127.0.0.1:${secondaryProvider.getPort()}`,
          timeoutMs: 1000,
        },
      });
      const unreachablePort = await unreachableGateway.start();

      const res = await fetch(`http://127.0.0.1:${unreachablePort}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Testing network unreachable primary" }),
      });

      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.provider).toBe("secondary");
      expect(body.fallback_occurred).toBe(true);
      expect(body.fallback_reason).toBe("primary_server_error");

      await unreachableGateway.stop();
    });

    it("standardizes and sanitizes error response when all providers fail", async () => {
      // Both primary and secondary set to fail
      primaryProvider.setMode("rate_limit_429");
      secondaryProvider.setMode("internal_error");

      const { status, body } = await sendCompletion({
        prompt: "Attempt completion with both providers down",
      });

      expect(status).toBe(502);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("ALL_UPSTREAM_PROVIDERS_FAILED");
      expect(body.error.message).toContain("primary provider failed and secondary fallback was unreachable");
      expect(body.error.primary_failure).toBe("primary_rate_limited_429");

      // Critical: Ensure no raw internal stack traces or ports leaked in error
      const errorString = JSON.stringify(body);
      expect(errorString).not.toContain("ProviderCore.ts");
      expect(errorString).not.toContain("connection pool reset");
      expect(errorString).not.toContain("127.0.0.1");
    });
  });
});
