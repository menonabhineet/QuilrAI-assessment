# Task 2: MCP Security Gateway Proxy (Tool Filtering & Auth)

Lightweight HTTP/JSON-RPC reverse proxy gateway sitting between AI agent clients and downstream MCP servers, enforcing Bearer token authentication and fine-grained, role-based tool execution control.

---

## Architectural Overview

```
[AI Agent Client] 
       │  (HTTP POST / JSON-RPC + Bearer Token)
       ▼
[MCP Security Gateway Proxy]
  ├── 1. Authentication Layer (Extracts Bearer token -> Decodes role: admin vs viewer)
  ├── 2. Wire-level JSON-RPC parser (Validates JSON syntax and protocol structure)
  └── 3. Policy Enforcement Engine
        ├── tools/list: Transparent forward to downstream server
        ├── tools/call (admin_*):
        │     ├── If role == admin: Forward to downstream
        │     └── If role != admin: Intercept -> Return JSON-RPC -32001 (Unauthorized)
        └── tools/call (other): Forward to downstream
       │
       ▼  (Only authorized requests reach downstream)
[Downstream MCP Server]
  ├── Public tools: system_health, get_metrics
  └── Admin tools: admin_reset_key, admin_purge_cache
```

---

## Enterprise Hardening Features

- **Payload Size Limits**: The proxy enforces a strict 2MB limit on incoming JSON-RPC payloads, rejecting overly large requests early in the TCP stream with HTTP 413 (Payload Too Large) to prevent Out-Of-Memory (OOM) Denial of Service attacks.
- **Dynamic Routing Preservation**: The proxy faithfully preserves the client's original HTTP request path, ensuring compatibility with downstream MCP servers that utilize path-based routing.
- **Stream-Through Responses**: Downstream responses are piped directly to the client socket, preventing large JSON-RPC responses from accumulating in the gateway's memory.

---

## Authorization Policy Specification

| Request Method | Target Tool | Caller Role | Gateway Action | Response Code |
|---|---|---|---|---|
| `tools/list` | All | `viewer` or `admin` | Transparent forward | `200 OK` (downstream result) |
| `tools/call` | `system_health` (public) | `viewer` or `admin` | Forward to downstream | `200 OK` (tool output) |
| `tools/call` | `get_metrics` (public) | `viewer` or `admin` | Forward to downstream | `200 OK` (tool output) |
| `tools/call` | `admin_reset_key` | `viewer` | **Intercept before downstream** | `403 Forbidden` / JSON-RPC `-32001` |
| `tools/call` | `admin_purge_cache` | `viewer` | **Intercept before downstream** | `403 Forbidden` / JSON-RPC `-32001` |
| `tools/call` | `admin_reset_key` | `admin` | Forward to downstream | `200 OK` (regenerated key) |
| `tools/call` | `admin_purge_cache` | `admin` | Forward to downstream | `200 OK` (purged metrics) |
| Any | Any | Missing / Invalid Token | **Intercept before downstream** | `401 Unauthorized` |

---

## Directory Structure

```
task-2-mcp-gateway/
├── src/
│   ├── types.ts          # JSON-RPC wire format types and error codes
│   ├── auth.ts           # Bearer token verification and role extraction
│   ├── downstream-mcp.ts # Mock downstream MCP server with public/admin tools
│   ├── proxy.ts          # Core reverse proxy server and policy interceptor
│   └── index.ts          # Standalone launcher for proxy and downstream server
├── tests/
│   └── gateway-proxy.test.ts # Comprehensive test suite covering all auth paths
├── demo.ts               # Live interactive client demonstrating real-time filtering
└── README.md
```

---

## Running the Server & Tests

### Interactive Live Demonstration
Launch an end-to-end interactive session running both the downstream server and the security gateway proxy, sending viewer and admin calls live:
```bash
npm run demo:task2
```

### Running Automated Tests
Run the full Vitest suite for Task 2:
```bash
npm run test:task2
```

Run with verbose step-by-step reporting:
```bash
npx vitest run task-2-mcp-gateway/tests --reporter=verbose
```

### Direct Standalone Execution
Start both the downstream MCP server (port 8101) and the security proxy (port 8100):
```bash
npx tsx task-2-mcp-gateway/src/index.ts
```

### Sample curl Commands

#### 1. Querying tools/list as Viewer
```bash
curl -X POST http://127.0.0.1:8100 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer viewer-token-read-only" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'
```

#### 2. Calling an admin tool as Viewer (Blocked by Gateway with -32001)
```bash
curl -X POST http://127.0.0.1:8100 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer viewer-token-read-only" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "admin_reset_key", "arguments": {"key_name": "prod_key"}}}'
```

#### 3. Calling an admin tool as Admin (Allowed and Forwarded)
```bash
curl -X POST http://127.0.0.1:8100 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin-token-secret-key" \
  -d '{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "admin_reset_key", "arguments": {"key_name": "prod_key"}}}'
```
