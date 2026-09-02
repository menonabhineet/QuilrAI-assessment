# Task 1: Custom MCP Server with Strict Validation & Transport

Production-grade Model Context Protocol (MCP) server implementation using the official SDK (`@modelcontextprotocol/sdk`) over standard input/output (`stdio`) transport.

---

## Architectural Highlights

### 1. Pure STDIO Isolation
- **The Problem**: The MCP specification uses `stdio` as a binary/text wire format for JSON-RPC 2.0 frames. If internal libraries or debug logs print arbitrary text to `stdout`, the client JSON-RPC parser breaks.
- **The Solution**: 
  - `stdout` is 100% reserved for valid JSON-RPC frames managed by `StdioServerTransport`.
  - An internal stderr logger (`src/logger.ts`) routes all diagnostic, debug, and informational messages exclusively to `process.stderr`.
  - An active monkey patch (`enforceStdioIsolation`) intercepts `console.log`, `console.info`, and `console.debug`, safely redirecting any accidental output to `stderr`.

### 2. Strict Input Schema Validation
- Formulated using **Zod** (`src/types.ts`).
- Schema validation errors are intercepted before execution and mapped directly to standard JSON-RPC error codes.

### 3. Protocol Error Mapping
- **Code -32602 (Invalid params)**: Raised when input schemas fail validation (e.g., malformed `customer_id`, non-positive refund amount, reason under 10 characters) or when an entity is not found.
- **Code -32603 (Internal error)**: Raised for business rule violations during execution (e.g., account suspended, balance exceeded) or unexpected runtime exceptions.
- **Code -32601 (Method not found)**: Raised when an unrecognized tool name is requested.

---

## Tool Specifications

### Tool 1: `get_customer_record`
- **Description**: Retrieve verified customer information by ID.
- **Input Parameters**:
  - `customer_id` (string, required): Must strictly match regex `^CUST-[0-9]{5}$` (e.g., `CUST-10001`).
- **Response**: Full customer profile JSON including name, email, subscription tier, account balance, status, and creation date.

### Tool 2: `trigger_refund`
- **Description**: Issue a monetary refund to an active customer account.
- **Input Parameters**:
  - `customer_id` (string, required): Must match `^CUST-[0-9]{5}$`.
  - `amount` (number, required): Positive float strictly greater than 0.
  - `reason` (string, required): Auditable justification with a minimum length of 10 characters.
- **Response**: Transaction receipt with unique `refund_id` (e.g. `REF-1001`), timestamp, amount, reason, and updated account balance.

---

## Directory Structure

```
task-1-mcp-server/
├── src/
│   ├── types.ts      # Zod schemas, TypeScript types, and error formatters
│   ├── logger.ts     # Stderr logger and stdio isolation enforcement
│   ├── db.ts         # In-memory mock database for customers and refunds
│   ├── server.ts     # MCP Server instance with tool handlers and error mapping
│   └── index.ts      # Stdio transport entry point
├── tests/
│   ├── validation.test.ts    # Unit tests for Zod validation schemas
│   └── stdio-server.test.ts  # End-to-end integration tests over stdio transport
├── demo.ts           # Interactive live client showing real-time stdio communication
└── README.md
```

---

## Running the Server & Tests

### Interactive Live Demonstration
Launch an end-to-end interactive session that spawns the server, performs the handshake, executes tools, tests error cases, and shows stdio isolation live:
```bash
npm run demo:task1
```

### Direct Execution
Run via `tsx`:
```bash
npx tsx task-1-mcp-server/src/index.ts
```

### Running Automated Tests
Run all Task 1 tests (both schema unit tests and stdio integration tests):
```bash
npm run test:task1
```

Run with verbose step-by-step reporting:
```bash
npx vitest run task-1-mcp-server/tests --reporter=verbose
```
