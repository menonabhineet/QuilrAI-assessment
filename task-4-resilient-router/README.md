# Task 4: Rate-Limiting & Model Fallback Router

Resilient model router and token-aware sliding window rate limiter for LLM gateways. Protects upstream model quotas, enforces per-tenant token budgets, guarantees sub-3000ms failover SLA to secondary backup models, and sanitizes failure responses.

---

## Architectural State Machine

```
[Incoming Completion Request]
               │
               ▼
[Token-Aware Sliding Window Rate Limiter]
  ├── Estimate prompt tokens + max_tokens
  ├── Sum active window consumption for Tenant
  └── If usage + requested > 50,000 tokens/min:
        └── Reject with HTTP 429 Too Many Requests (Retry-After header set)
               │ (Quota Permitted)
               ▼
[Resilient Model Router]
  ├── Step 1: Dispatch to Primary Model Provider with 3000ms timeout race
  │     ├── Success (HTTP 200 within 3000ms): Return primary completion
  │     ├── Upstream 429 Too Many Requests: Trigger immediate secondary failover
  │     └── Upstream Timeout (3000ms elapsed): Abort primary -> Trigger secondary failover
  │
  └── Step 2: Fallback to Secondary Model Provider
        ├── Success (HTTP 200): Return secondary completion with fallback metadata
        └── Failure: Sanitize error payload (HTTP 502 Bad Gateway)
```

---

## Technical Specifications

### 1. Token-Aware Sliding Window Rate Limiter
- **Limit**: Configurable (default 50,000 tokens per 60,000ms window per tenant).
- **Tenant Identification**: Extracted from `Authorization: Bearer <tenant_id>` or `X-Tenant-ID`.
- **Estimation Heuristic**: `ceil(prompt.length / 4) + max_tokens`.
- **Eviction Strategy**: Lazy sliding window eviction of records older than 60 seconds.
- **HTTP 429 Headers**:
  - `Retry-After`: Seconds until the oldest token record in the active window expires.
  - `X-RateLimit-Limit`: Maximum tokens per minute (50000).
  - `X-RateLimit-Remaining`: Tokens remaining in current window.
  - `X-RateLimit-Reset`: Reset countdown in seconds.

### 2. Resilient Fallback Mechanics
- **3000ms Timeout Deadline**: Uses `AbortController` coupled with a hardware timer to abort unresponsive primary requests at exactly 3000ms.
- **429 Rate Limit Failover**: Intercepts primary upstream quota saturation and immediately redirects the completion request to the secondary provider.
- **Metadata Transparency**: Responses return `X-Model-Provider: secondary` and `fallback_occurred: true` alongside the exact failure reason (`primary_timeout_3000ms` or `primary_rate_limited_429`).

### 3. Error Sanitization Policy
If all upstream model providers fail:
- Internal connection strings, private IP addresses, port numbers, and authentication tokens are stripped.
- Raw runtime stack traces are completely suppressed.
- A standardized, machine-readable gateway error payload is returned with HTTP 502.

---

## Directory Structure

```
task-4-resilient-router/
├── src/
│   ├── types.ts              # Completion schemas, rate limiter status, router config
│   ├── token-rate-limiter.ts # Sliding window log token rate limiter
│   ├── mock-providers.ts     # Mock upstream model providers (healthy, 429, timeout, error)
│   ├── router.ts             # Resilient router engine with 3000ms race and 429 fallback
│   ├── gateway-server.ts     # HTTP gateway server combining rate limiter and router
│   └── index.ts              # Standalone service runner
├── tests/
│   └── resilient-router.test.ts # Comprehensive test suite
├── demo.ts                   # Live interactive client demonstrating fallbacks and rate limits
└── README.md
```

---

## Running the Server & Tests

### Interactive Live Demonstration
Run the end-to-end interactive demonstration exercising primary routing, 429 failover, 3000ms timeout fallback, token rate limit rejection, and error sanitization:
```bash
npm run demo:task4
```

### Running Automated Tests
Run all Task 4 unit and integration tests:
```bash
npm run test:task4
```

Run with verbose step-by-step reporting:
```bash
npx vitest run task-4-resilient-router/tests --reporter=verbose
```

### Direct Standalone Execution
Start primary provider (port 8301), secondary provider (port 8302), and resilient gateway (port 8300):
```bash
npx tsx task-4-resilient-router/src/index.ts
```

### Sample curl Commands

#### 1. Standard Completion Request
```bash
curl -X POST http://127.0.0.1:8300 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer enterprise-tenant-01" \
  -d '{"prompt": "Summarize customer incident ticket", "max_tokens": 100}'
```

#### 2. Specifying Custom Tenant ID Header
```bash
curl -X POST http://127.0.0.1:8300 \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: tenant-analytics-dept" \
  -d '{"prompt": "Generate latency metric chart summary", "max_tokens": 50}'
```
