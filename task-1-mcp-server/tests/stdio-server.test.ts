import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

describe("Task 1: MCP Server STDIO Isolation and Transport Integration", () => {
  let serverProcess: ChildProcessWithoutNullStreams;
  let stdoutBuffer = "";
  const stdoutLines: string[] = [];
  const stderrLogs: string[] = [];
  const pendingRequests = new Map<
    number | string,
    { resolve: (res: JsonRpcResponse) => void; reject: (err: Error) => void }
  >();

  beforeAll(async () => {
    const entryPath = path.resolve(__dirname, "../src/index.ts");
    const tsxCli = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");

    // Launch server process via Node directly with tsx loader
    serverProcess = spawn(
      process.execPath,
      [tsxCli, entryPath],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "test" },
      }
    );

    // Capture stdout lines and resolve JSON-RPC requests
    serverProcess.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdoutBuffer += text;

      const lines = stdoutBuffer.split("\n");
      // Keep unfinished fragment in buffer
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        stdoutLines.push(trimmed);

        try {
          const parsed = JSON.parse(trimmed) as JsonRpcResponse;
          if (parsed.id !== undefined && pendingRequests.has(parsed.id)) {
            const resolver = pendingRequests.get(parsed.id);
            pendingRequests.delete(parsed.id);
            resolver?.resolve(parsed);
          }
        } catch {
          // If a line cannot be parsed as JSON, stdout isolation has failed!
          // We intentionally let stdoutLines capture it so the assertion catches it.
        }
      }
    });

    // Capture stderr logs
    serverProcess.stderr.on("data", (chunk: Buffer) => {
      stderrLogs.push(chunk.toString("utf8"));
    });

    // Send initialize handshake
    const initResponse = await sendRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "test-runner",
          version: "1.0.0",
        },
      },
    });

    expect(initResponse.result).toBeDefined();

    // Send notifications/initialized
    serverProcess.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }) + "\n"
    );
  }, 15000);

  afterAll(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
  });

  function sendRequest(payload: {
    jsonrpc: string;
    id: number | string;
    method: string;
    params?: unknown;
  }): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(payload.id);
        reject(new Error(`Timed out waiting for response to request id: ${payload.id}`));
      }, 5000);

      pendingRequests.set(payload.id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      serverProcess.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  it("advertises tools via tools/list", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/list",
      params: {},
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { tools: Array<{ name: string }> };
    expect(result.tools).toBeDefined();

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("get_customer_record");
    expect(toolNames).toContain("admin_trigger_refund");
  });

  it("successfully retrieves customer record with valid customer_id", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "get_customer_record",
        arguments: {
          customer_id: "CUST-10001",
        },
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");

    const customer = JSON.parse(result.content[0].text);
    expect(customer.customer_id).toBe("CUST-10001");
    expect(customer.name).toBe("Alice Montgomery");
    expect(customer.tier).toBe("enterprise");
  });

  it("rejects get_customer_record with invalid customer_id format via -32602", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "get_customer_record",
        arguments: {
          customer_id: "BAD_ID_999",
        },
      },
    });

    expect(response.result).toBeUndefined();
    expect(response.error).toBeDefined();
    // JSON-RPC standard code -32602 (Invalid params)
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain("^CUST-[0-9]{5}$");
  });

  it("successfully triggers refund with valid parameters", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "admin_trigger_refund",
        arguments: {
          customer_id: "CUST-10002",
          amount: 50.0,
          reason: "Customer dissatisfaction with delayed delivery service",
        },
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toBeDefined();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed.refund.customer_id).toBe("CUST-10002");
    expect(parsed.refund.amount).toBe(50.0);
    expect(parsed.refund.refund_id).toMatch(/^REF-\d+$/);
    expect(parsed.updated_balance).toBe(800.25);
  });

  it("rejects admin_trigger_refund with negative amount via -32602", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "admin_trigger_refund",
        arguments: {
          customer_id: "CUST-10002",
          amount: -100.0,
          reason: "Attempting negative adjustment via refund tool",
        },
      },
    });

    expect(response.result).toBeUndefined();
    expect(response.error).toBeDefined();
    // JSON-RPC code -32602 (Invalid params)
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain("positive float");
  });

  it("rejects admin_trigger_refund with short reason via -32602", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "admin_trigger_refund",
        arguments: {
          customer_id: "CUST-10002",
          amount: 25.0,
          reason: "Damaged", // 7 characters, less than 10
        },
      },
    });

    expect(response.result).toBeUndefined();
    expect(response.error).toBeDefined();
    // JSON-RPC code -32602 (Invalid params)
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain("minimum length of 10 characters");
  });

  it("rejects admin_trigger_refund on suspended account via -32603", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: "admin_trigger_refund",
        arguments: {
          customer_id: "CUST-10003", // Suspended customer
          amount: 10.0,
          reason: "Attempting refund on a suspended customer account",
        },
      },
    });

    expect(response.result).toBeUndefined();
    expect(response.error).toBeDefined();
    // JSON-RPC code -32603 (Internal error)
    expect(response.error?.code).toBe(-32603);
    expect(response.error?.message).toContain("suspended");
  });

  it("strictly enforces STDIO isolation: 100% of stdout is valid JSON-RPC", () => {
    expect(stdoutLines.length).toBeGreaterThan(0);

    for (const line of stdoutLines) {
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(line);
      }).not.toThrow();

      // Every line must have "jsonrpc": "2.0"
      expect((parsed as { jsonrpc: string }).jsonrpc).toBe("2.0");
    }

    // Diagnostics and logs must have routed to stderr
    const fullStderr = stderrLogs.join("");
    expect(fullStderr).toContain("INFO");
    expect(fullStderr).toContain("mcp-server");
  });
});
