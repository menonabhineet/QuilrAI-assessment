# QuilrAI FDE Assessment: MCP & LLM Gateways Monorepo

Production-grade implementations for the Forward Deployed Engineer (FDE) and AI Integration Engineer technical assessment.

This repository provides robust, runnable solutions for all five assessment tasks across Model Context Protocol (MCP) servers, security proxy gateways, real-time streaming guardrails, resilient rate-limited routers, and enterprise zero-trust network troubleshooting. Every task operates locally on the free tier with zero external API dependencies and comes equipped with automated Vitest suites and interactive demonstrations.

---

## 1. Repository Architecture Overview

```
quilrai-assessment/
├── docs/                             # Interactive GitHub Pages Architecture Visualizer
│   ├── index.html                    # Single-page dashboard shell
│   ├── styles.css                    # Glassmorphic dark theme design system
│   ├── app.js                        # Client state and tab router
│   └── modules/                      # Task 1-5 algorithmic simulation modules
├── task-1-mcp-server/             # Task 1: MCP Server with strict validation and stdio isolation
│   ├── src/                       # Official @modelcontextprotocol/sdk implementation
│   ├── tests/                     # 23 unit and stdio child process integration tests
│   └── demo.ts                    # Live interactive JSON-RPC stdio client
├── task-2-mcp-gateway/            # Task 2: MCP Security Gateway Proxy (Tool Filtering & Auth)
│   ├── src/                       # HTTP reverse proxy with Bearer token RBAC
│   ├── tests/                     # 17 authentication, wire parsing, and tool filtering tests
│   └── demo.ts                    # Live proxy demo (Admin vs Viewer tool execution)
├── task-3-streaming-guardrail/    # Task 3: LLM Gateway Streaming Guardrail (PII Redaction)
│   ├── src/                       # O(1) rolling-window PII redaction engine
│   ├── tests/                     # 15 streaming, boundary redaction, and OpenAI delta tests
│   └── demo.ts                    # Real-time token stream demonstration (TTFT < 40ms)
├── task-4-resilient-router/       # Task 4: Rate-Limiting & Model Fallback Router
│   ├── src/                       # Sliding window token rate limiter and 3000ms fallback router
│   ├── tests/                     # 21 rate-limiting, TTL eviction, timeout failover, and error tests
│   └── demo.ts                    # Live failover demo (429 failover, 3s timeout, rate limits)
├── task-5-network-debugging/      # Task 5: Enterprise Zero-Trust Debugging Playbook
│   ├── ENTERPRISE_DEBUGGING_PLAYBOOK.md # Production diagnostic runbook and decision tree
│   └── README.md                  # Task 5 overview and executive summary
├── package.json                   # Root workspace configuration with test and demo scripts
├── tsconfig.json                  # Root TypeScript configuration
└── README.md                      # Comprehensive repository documentation
```

### Component Summary Matrix

| Task | Component | Key Capabilities | Port / Transport | Tests Passing |
|---|---|---|---|---|
| **Task 1** | MCP Server | Stdio isolation, Zod schemas, JSON-RPC -32602/-32603 | Stdio (JSON-RPC) | 23 passing |
| **Task 2** | MCP Security Gateway | Bearer token auth, role-based tool filtering, 2MB DoS payload limit | HTTP (8100 proxy -> 8101 mcp) | 17 passing |
| **Task 3** | Streaming Guardrail | O(1) rolling window, SSE multi-schema deltas, [DONE] flush ordering | HTTP SSE (8200 gateway -> 8201 llm) | 16 passing |
| **Task 4** | Resilient Model Router | Token rate limiter, tenant TTL eviction, 3s timeout failover | HTTP (8300 router -> 8301/8302) | 21 passing |
| **Task 5** | Zero-Trust Playbook | Packet triage, root cause decision tree, transport redesign | Enterprise Architecture Doc | N/A |
| **Total** | **Full Monorepo** | **Production-grade, zero external API dependencies** | **5 Active Services** | **77 passing** |

---

## 2. Assessment Tasks Deep Dive

### Task 1: Custom MCP Server with Strict Validation & Transport
- **Path**: `task-1-mcp-server/`
- **Specification**: Implements `get_customer_record` and `trigger_refund` (with `admin_trigger_refund` alias) using `@modelcontextprotocol/sdk`.
- **Strict Stdio Isolation**: `stdout` is reserved exclusively for JSON-RPC message frames. All application logging, startup messages, and error diagnostics route strictly to `stderr` with line-buffered JSON-RPC frame inspection on `process.stdout.write`.
- **Zod Schema Validation**: Enforces `^CUST-[0-9]{5}$` customer ID format, positive finite refund amounts, and non-whitespace minimum 10-character reason strings. Validation errors are mapped to JSON-RPC error `-32602` (InvalidParams), and unexpected exceptions map to `-32603` (InternalError).
- **Automated Tests**: 23 tests verifying schema validation, finite number bounds, whitespace sanitization, and end-to-end child process stdio interaction.

### Task 2: MCP Security Gateway Proxy (Tool Filtering & Auth)
- **Path**: `task-2-mcp-gateway/`
- **Specification**: Enterprise reverse proxy sitting between untrusted client applications and internal downstream MCP servers on port 8100.
- **Role-Based Access Control & Dual Credentials**:
  - `Admin` role (`Bearer admin-token-secret-key` or `Bearer admin-secret-token`): Permitted to execute all tools including sensitive administrative functions.
  - `Viewer` role (`Bearer viewer-token-read-only` or `Bearer viewer-secret-token`): Permitted read-only access (`system_health`, `get_metrics`, `tools/list`), but prohibited from executing administrative tools (`admin_*`).
- **Wire Interception & Memory Limits**: Rejects `null`, numeric, and array payloads cleanly via `-32600 (Invalid Request)`. Unprivileged callers attempting to call restricted tools receive JSON-RPC error code `-32001` (Unauthorized) with zero downstream traffic generated. Additionally enforces a 2MB DoS payload limit with immediate socket destruction and streams downstream responses via `pipe()`.
- **Automated Tests**: 17 tests validating token authentication, admin tool authorization, viewer tool rejection, and wire parser safety.

### Task 3: LLM Gateway Streaming Guardrail (PII Redaction)
- **Path**: `task-3-streaming-guardrail/`
- **Specification**: High-throughput streaming proxy on port 8200 that redacts Emails, SSNs, and Credit Card numbers in real time.
- **O(1) Bounded Rolling Window & Multi-Schema SSE Parsing**:
  - Operates strictly on Server-Sent Events (SSE) JSON deltas, supporting standard OpenAI schemas (`choices[0].delta.content`), Anthropic schemas (`delta.text`), and custom schemas.
  - Does NOT buffer full LLM responses in memory.
  - Maintains a small 48-character sliding window buffer for ambiguous trailing tokens.
  - Delivers safe prefixes immediately to the client to preserve low Time To First Token (TTFT < 40ms).
  - Flushes safe trailing tokens before emitting the terminal `data: [DONE]` sentinel.
  - Aborts upstream token generation when client disconnects prematurely.
- **Token Boundary Handling**: Catches sensitive patterns split across multiple chunks, such as email addresses split before the `@` symbol (e.g. `"john.doe"` in Chunk 1 and `"@gmail.com"` in Chunk 2).
- **Automated Tests**: 16 tests verifying regex redaction, boundary splits, chunk streaming, OpenAI delta schemas, and terminal sentinel ordering.

### Task 4: Rate-Limiting & Model Fallback Router
- **Path**: `task-4-resilient-router/`
- **Specification**: Resilient model completion gateway on port 8300 with per-tenant rate limiting and automatic model failover.
- **O(1) Token-Aware Sliding Window Rate Limiting & Bounded Memory**:
  - Tracks timestamped consumption per tenant API key (default: 50,000 tokens/minute) using an O(1) sliding window counter.
  - Features active TTL tenant eviction and an LRU capacity cap (`maxTenants`, default 10,000) to prevent memory growth under arbitrary tenant traffic.
  - Reconciles consumed token counts upon completion, refunding unused token reservations.
  - Returns HTTP 429 Too Many Requests with standard headers (`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`).
- **Resilient Fallback & Selective Failover Policies**:
  - Primary model request races against a strict 3000ms deadline using `AbortController`.
  - Automatically fails over to secondary backup model if primary returns HTTP 429, times out at 3000ms, or fails with 5xx.
  - Does NOT failover on non-retryable client errors (HTTP 400), returning client error immediately.
  - Sanitizes error payloads (HTTP 502) if both providers fail, preventing exposure of internal URLs or stack traces.
- **Automated Tests**: 21 tests verifying rate limits, tenant TTL eviction, token reconciliation, 3000ms timeout fallback, primary 429 failover, client 400 non-fallback, and error sanitization.

### Task 5: System Design & Debugging Playbook (Enterprise Zero-Trust)
- **Path**: `task-5-network-debugging/ENTERPRISE_DEBUGGING_PLAYBOOK.md`
- **Scenario**: Addresses enterprise customer issue where multi-turn agent tool executions experience intermittent connection drops and hanging requests behind strict egress proxies.
- **Core Sections**:
  1. Executive Summary & Diagnostic Triage Matrix.
  2. Live Diagnostic Toolkit with exact Linux CLI commands (`tcpdump`, `tshark`, `ss -tiepm`, `strace`, `openssl s_client`, `curl -ivv`).
  3. Systematic Root Cause Isolation Decision Tree (mTLS renegotiation vs proxy SSE idle timeouts vs LLM context truncation).
  4. Architectural Remediation & Transport Redesign (SSE `: ping` heartbeats, TCP keepalives `tcp_keepalive_time=15`, HTTP/2 multiplexing, WebSocket migration, idempotency keys, and egress proxy bypass rules).
  5. Field Engineering 15-minute emergency on-site triage runbook.

---

## 3. Setup & Quick Start

### Prerequisites
- Node.js 20+ (Node.js v22 or v24 recommended)
- npm 10+
- Git

### Installation
Clone the repository and install all dependencies:
```bash
git clone https://github.com/menonabhineet/QuilrAI-assessment.git
cd QuilrAI-assessment
npm install
```

---

## 4. Running Automated Tests

Run the complete test suite across all tasks (76 automated tests):
```bash
npm test
```

### Running Individual Task Test Suites

```bash
# Task 1: MCP Server Zod validation and stdio child process tests (23 tests)
npm run test:task1

# Task 2: MCP Security Gateway Proxy authentication and RBAC tests (17 tests)
npm run test:task2

# Task 3: Streaming Guardrail rolling buffer and PII redaction tests (15 tests)
npm run test:task3

# Task 4: Rate Limiter and Resilient Fallback Router tests (21 tests)
npm run test:task4
```

### Verbose Step-by-Step Reporting
To view every individual assertion and execution time:
```bash
npx vitest run --reporter=verbose
```

---

## 5. Running Interactive Live Demonstrations

Each task includes an interactive, colorized terminal demonstration exercising real-time services, network round-trips, and failure scenarios:

```bash
# Task 1: Stdio JSON-RPC Handshake, tool list, and valid/invalid refund calls
npm run demo:task1

# Task 2: Security Gateway with Admin vs Viewer Bearer token access
npm run demo:task2

# Task 3: Real-Time Streaming Guardrail with boundary-split PII redaction
npm run demo:task3

# Task 4: Resilient Router with 429 failover, 3000ms timeout, and rate limits
npm run demo:task4
```

---

## 6. Manual Verification & Sample curl Commands

### Task 2: MCP Security Gateway
Start services (proxy on port 8100, downstream on port 8101):
```bash
npx tsx task-2-mcp-gateway/src/index.ts
```

1. **Viewer calling permitted tool (Success: HTTP 200)**:
```bash
curl -X POST http://127.0.0.1:8100 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer viewer-token-read-only" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "system_health", "arguments": {}}}'
```

2. **Viewer attempting administrative tool (Blocked: JSON-RPC -32001)**:
```bash
curl -X POST http://127.0.0.1:8100 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer viewer-token-read-only" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "admin_reset_key", "arguments": {"key_name": "prod_oauth_key"}}}'
```

3. **Admin calling administrative tool (Success: HTTP 200)**:
```bash
curl -X POST http://127.0.0.1:8100 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin-token-secret-key" \
  -d '{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "admin_reset_key", "arguments": {"key_name": "prod_oauth_key"}}}'
```

---

### Task 3: Streaming Guardrail Gateway
Start services (gateway on port 8200, mock upstream on port 8201):
```bash
npx tsx task-3-streaming-guardrail/src/index.ts
```

Stream completions with live PII redaction:
```bash
curl -N -X POST http://127.0.0.1:8200 \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Generate customer incident summary"}'
```

---

### Task 4: Rate-Limiting & Model Fallback Router
Start services (gateway on port 8300, primary on port 8301, secondary on port 8302):
```bash
npx tsx task-4-resilient-router/src/index.ts
```

1. **Standard Completion Request**:
```bash
curl -X POST http://127.0.0.1:8300 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer enterprise-tenant-01" \
  -d '{"prompt": "Analyze network telemetry metrics", "max_tokens": 100}'
```

2. **Exceeding Tenant Quota (HTTP 429)**:
```bash
curl -X POST http://127.0.0.1:8300 \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: rate-limited-tenant" \
  -d '{"prompt": "Summarize logs", "max_tokens": 50000}'
```

---

## 7. Operational Standards & Architecture Principles

- **Pure Stdio Isolation**: In MCP stdio implementations, stdout is exclusively reserved for JSON-RPC frames, with all diagnostic logs directed to stderr.
- **Comprehensive Automated Testing**: 77 automated tests covering schema validation, process transports, auth proxies, sliding window redaction, and timeout races.

---

## 8. Interactive Architecture Visualizer (GitHub Pages)

For evaluators and stakeholders who prefer an interactive visual walkthrough of the gateway algorithms, security barriers, and enterprise debugging decision trees, a client-side visualizer is hosted on GitHub Pages:

- **Live URL**: [https://menonabhineet.github.io/QuilrAI-assessment/](https://menonabhineet.github.io/QuilrAI-assessment/)
- **Source Directory**: `/docs` (served directly via GitHub Pages on the `main` branch)
- **Local Preview Command**:
  ```bash
  npm run serve:docs
  ```

### Interactive Modules & Algorithmic Simulations
- **Task 1 MCP Server**: Live Zod parameter validation and dual-channel terminal demonstrating strict stdio isolation (`stdout` exclusively for JSON-RPC, `stderr` for application logs).
- **Task 2 Security Gateway**: Bearer token RBAC testing (Admin vs Viewer), JSON-RPC `-32001 Unauthorized` tool execution interception, and 2MB DoS memory safeguard rejection.
- **Task 3 Streaming Guardrail**: Real-time 48-character sliding window buffer simulation catching split-token PII (email, SSN, credit cards) across SSE chunks with sub-40ms TTFT and terminal `[DONE]` sentinel flush safety.
- **Task 4 Resilient Router**: O(1) 60-second sliding window token rate limiting, HTTP 429 backoff calculations, and 3000ms deadline failover state machine.
- **Task 5 Zero-Trust Triage**: Clickable diagnostic triage decision tree with simulated packet traces (`tcpdump`, `curl -Iv`, `openssl s_client`) and production blueprints.
