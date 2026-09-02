# QuilrAI FDE Assessment: MCP & LLM Gateways

Production-grade implementations for the Forward Deployed Engineer (FDE) and AI Integration Engineer technical assessment.

This repository covers Model Context Protocol (MCP) servers, security proxy gateways, real-time streaming guardrails, resilient rate-limited routers, and enterprise zero-trust troubleshooting.

---

## Repository Architecture

```
quilrai-assessment/
├── task-1-mcp-server/          # Task 1: MCP Server with strict validation and stdio isolation
├── task-2-mcp-gateway/         # Task 2: MCP Security Gateway Proxy (Tool Filtering & Auth)
├── task-3-streaming-guardrail/ # Task 3: LLM Gateway Streaming Guardrail (PII Redaction)
├── task-4-resilient-router/    # Task 4: Rate-Limiting & Model Fallback Router
├── task-5-network-debugging/   # Task 5: Enterprise Zero-Trust Debugging Playbook
├── package.json                # Workspace configuration and dependencies
└── tsconfig.json               # Root TypeScript configuration
```

---

## Assessment Tasks Summary

### Task 1: Custom MCP Server with Strict Validation & Transport
- Built using the official `@modelcontextprotocol/sdk`.
- Strict stdio isolation: stdout is 100% reserved for JSON-RPC messages; all system/diagnostic logs write exclusively to stderr.
- Tools: `get_customer_record` and `trigger_refund`.
- Input validation enforced via Zod with standard JSON-RPC error codes (-32602 for invalid params, -32603 for internal errors).

### Task 2: MCP Security Gateway Proxy (Tool Filtering & Auth)
- Reverse proxy sitting between AI clients and downstream MCP servers.
- Role-based authorization via Bearer tokens (admin vs viewer).
- Fine-grained tool call interception: blocks viewer access to `admin_*` tools with JSON-RPC error code -32001 while passing allowed calls and `tools/list` transparently.

### Task 3: LLM Gateway Streaming Guardrail (PII Redaction)
- Real-time stream interception for text generation deltas without accumulating full responses in memory.
- Rolling window buffer state management to handle split-token boundaries for Emails, SSNs, and Credit Cards.
- Preserves low Time To First Token (TTFT) and low stream latency.

### Task 4: Rate-Limiting & Model Fallback Router
- Sliding window token rate limiter (50,000 tokens/minute per tenant API key).
- Automatic failover to secondary provider when primary returns HTTP 429 or times out after 3000ms.
- Standardized, sanitized error payloads that prevent leaking upstream stack traces or internal implementation details.

### Task 5: System Design & Debugging Playbook (Enterprise Zero-Trust)
- In-depth technical playbook addressing intermittent connection drops and hanging requests behind enterprise egress proxies.
- Live diagnostic toolkit (tcpdump, curl, tshark, strace, openssl s_client, ss).
- Systematic root cause isolation decision tree (mTLS renegotiation, proxy SSE idle timeouts, socket resets).
- Architectural remediation strategies (heartbeats, keepalives, HTTP/2, WebSockets, idempotency tokens).

---

## Setup & Quick Start

### Prerequisites
- Node.js 20+ (Node.js v24 recommended)
- npm 10+

### Installation
```bash
npm install
```

### Running Tests
Run all test suites across the monorepo:
```bash
npm test
```

Run specific task tests:
```bash
npm run test:task1
npm run test:task2
npm run test:task3
npm run test:task4
```

### Interactive Demonstrations
Run live, colorized end-to-end demonstrations with full request/response wire inspections:
```bash
npm run demo:task1
npm run demo:task2
```
