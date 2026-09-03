# QuilrAI FDE Assessment: MCP & LLM Gateways Monorepo

Production-grade implementations for the Forward Deployed Engineer (FDE) and AI Integration Engineer technical assessment.

This repository provides robust, runnable solutions for all five assessment tasks across Model Context Protocol (MCP) servers, security proxy gateways, real-time streaming guardrails, resilient rate-limited routers, and enterprise zero-trust network troubleshooting. Every task operates locally on the free tier with zero external API dependencies and comes equipped with automated Vitest suites and interactive demonstrations.

---

## 1. Repository Architecture Overview

```
quilrai-assessment/
├── task-1-mcp-server/             # Task 1: MCP Server with strict validation and stdio isolation
│   ├── src/                       # Official @modelcontextprotocol/sdk implementation
│   ├── tests/                     # 18 unit and stdio child process integration tests
│   └── demo.ts                    # Live interactive JSON-RPC stdio client
├── task-2-mcp-gateway/            # Task 2: MCP Security Gateway Proxy (Tool Filtering & Auth)
│   ├── src/                       # HTTP reverse proxy with Bearer token RBAC
│   ├── tests/                     # 12 authentication and tool filtering integration tests
│   └── demo.ts                    # Live proxy demo (Admin vs Viewer tool execution)
├── task-3-streaming-guardrail/    # Task 3: LLM Gateway Streaming Guardrail (PII Redaction)
│   ├── src/                       # O(1) rolling-window PII redaction engine
│   ├── tests/                     # 13 streaming and boundary redaction tests
│   └── demo.ts                    # Real-time token stream demonstration (TTFT < 40ms)
├── task-4-resilient-router/       # Task 4: Rate-Limiting & Model Fallback Router
│   ├── src/                       # Sliding window token rate limiter and 3000ms fallback router
│   ├── tests/                     # 14 rate-limiting, timeout failover, and sanitization tests
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
| **Task 1** | MCP Server | Stdio isolation, Zod schemas, JSON-RPC -32602/-32603 | Stdio (JSON-RPC) | 18 passing |
| **Task 2** | MCP Security Gateway | Bearer token auth, role-based tool filtering, 2MB DoS payload limit | HTTP (8200 proxy -> 8201 mcp) | 12 passing |
| **Task 3** | Streaming Guardrail | O(1) rolling window, SSE protocol-aware redaction, boundary handling | HTTP SSE (8080 proxy -> 8081 llm) | 13 passing |
| **Task 4** | Resilient Model Router | O(1) sliding window counter, 3s timeout failover, disconnect hooks | HTTP (8300 router -> 8301/8302) | 14 passing |
| **Task 5** | Zero-Trust Playbook | Packet triage, root cause decision tree, transport redesign | Enterprise Architecture Doc | N/A |
| **Total** | **Full Monorepo** | **Production-grade, zero external API dependencies** | **5 Active Services** | **57 passing** |

---

## 2. Assessment Tasks Deep Dive

### Task 1: Custom MCP Server with Strict Validation & Transport
- **Path**: `task-1-mcp-server/`
- **Specification**: Implements `get_customer_record` and `trigger_refund` using `@modelcontextprotocol/sdk`.
- **Strict Stdio Isolation**: `stdout` is reserved exclusively for JSON-RPC message frames. All application logging, startup messages, and error diagnostics route strictly to `stderr` with active monkey-patching of `console.log` and `process.stdout.write`.
- **Zod Schema Validation**: Enforces `^CUST-[0-9]{5}$` customer ID format, positive refund amounts, and minimum 10-character reason strings. Validation errors are mapped to JSON-RPC error `-32602` (InvalidParams), and unexpected exceptions map to `-32603` (InternalError).
- **Automated Tests**: 18 tests verifying schema validation and end-to-end child process stdio interaction.

### Task 2: MCP Security Gateway Proxy (Tool Filtering & Auth)
- **Path**: `task-2-mcp-gateway/`
- **Specification**: Enterprise reverse proxy sitting between untrusted client applications and internal downstream MCP servers.
- **Role-Based Access Control**:
  - `Admin` role (`Bearer admin-secret-token`): Permitted to execute all tools including sensitive administrative functions.
  - `Viewer` role (`Bearer viewer-secret-token`): Permitted read-only access (`get_customer_record`, `tools/list`), but prohibited from executing administrative tools (`admin_*`, `trigger_refund`).
- **Wire Interception & Memory Limits**: Unprivileged callers attempting to call restricted tools receive JSON-RPC error code `-32001` (Unauthorized) with zero downstream traffic generated. Additionally enforces a 2MB DoS payload limit and streams downstream responses via `pipe()` to prevent memory exhaustion.
- **Automated Tests**: 12 tests validating token authentication, admin tool authorization, and viewer tool rejection.

### Task 3: LLM Gateway Streaming Guardrail (PII Redaction)
- **Path**: `task-3-streaming-guardrail/`
- **Specification**: High-throughput streaming proxy that redacts Emails, SSNs, and Credit Card numbers in real time.
- **O(1) Bounded Rolling Window & SSE Parsing**:
  - Operates strictly on Server-Sent Events (SSE) JSON deltas, rather than corrupting raw TCP chunks.
  - Does NOT buffer full LLM responses in memory.
  - Maintains a small 48-character sliding window buffer for ambiguous trailing tokens.
  - Delivers safe prefixes immediately to the client to preserve low Time To First Token (TTFT < 40ms).
- **Token Boundary Handling**: Catches sensitive patterns split across multiple chunks, such as email addresses split before the `@` symbol (e.g. `"john.doe"` in Chunk 1 and `"@gmail.com"` in Chunk 2).
- **Automated Tests**: 13 tests verifying regex redaction, boundary splits, chunk streaming, and zero memory leaks.

### Task 4: Rate-Limiting & Model Fallback Router
- **Path**: `task-4-resilient-router/`
- **Specification**: Resilient model completion gateway with per-tenant rate limiting and automatic model failover.
- **O(1) Token-Aware Sliding Window Rate Limiting**:
  - Tracks timestamped consumption per tenant API key (default: 50,000 tokens/minute) using an O(1) sliding window counter.
  - Dynamically calculates `Retry-After` reset seconds based on quota availability.
  - Returns HTTP 429 Too Many Requests with standard headers (`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`).
- **Resilient Fallback & Lifecycle Hooks**:
  - Primary model request races against a strict 3000ms deadline using `AbortController`.
  - Attaches `req.on("close")` listener to trigger `AbortController` and immediately cancel upstream LLM generation if the client disconnects.
  - Automatically fails over to secondary backup model if primary returns HTTP 429 or times out at 3000ms.
  - Sanitizes error payloads (HTTP 502) if both providers fail, preventing exposure of internal URLs or stack traces.
- **Automated Tests**: 14 tests verifying rate limits, 3000ms timeout fallback, primary 429 failover, connection refused handling, and error sanitization.

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
git clone https://github.com/abhineet/QuilrAI-assessment.git
cd QuilrAI-assessment
npm install
```

---

## 4. Running Automated Tests

Run the complete test suite across all tasks (57 automated tests):
```bash
npm test
```

### Running Individual Task Test Suites

```bash
# Task 1: MCP Server Zod validation and stdio child process tests (18 tests)
npm run test:task1

# Task 2: MCP Security Gateway Proxy authentication and RBAC tests (12 tests)
npm run test:task2

# Task 3: Streaming Guardrail rolling buffer and PII redaction tests (13 tests)
npm run test:task3

# Task 4: Rate Limiter and Resilient Fallback Router tests (14 tests)
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

# Task 4: Resilient Router with 429 failover, 3000ms timeout, and rate limiting
npm run demo:task4
```

---

## 6. Manual Verification & Sample curl Commands

### Task 2: MCP Security Gateway
Start services:
```bash
npx tsx task-2-mcp-gateway/src/index.ts
```

1. **Viewer calling permitted tool (Success - HTTP 200)**:
```bash
curl -X POST http://127.0.0.1:8200 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer viewer-secret-token" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_customer_record", "arguments": {"customer_id": "CUST-10001"}}}'
```

2. **Viewer attempting administrative tool (Blocked - JSON-RPC -32001)**:
```bash
curl -X POST http://127.0.0.1:8200 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer viewer-secret-token" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "trigger_refund", "arguments": {"customer_id": "CUST-10001", "amount": 50, "reason": "Customer cancellation"}}}'
```

3. **Admin calling administrative tool (Success - HTTP 200)**:
```bash
curl -X POST http://127.0.0.1:8200 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin-secret-token" \
  -d '{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "trigger_refund", "arguments": {"customer_id": "CUST-10001", "amount": 50, "reason": "Customer cancellation"}}}'
```

---

### Task 3: Streaming Guardrail Gateway
Start services:
```bash
npx tsx task-3-streaming-guardrail/src/index.ts
```

Stream completions with live PII redaction:
```bash
curl -N -X POST http://127.0.0.1:8080 \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Generate customer incident summary"}'
```

---

### Task 4: Rate-Limiting & Model Fallback Router
Start services:
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
- **Comprehensive Automated Testing**: 57 automated tests covering schema validation, process transports, auth proxies, sliding window redaction, and timeout races.
