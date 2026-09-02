import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MockDownstreamMcpServer } from "../src/downstream-mcp.js";
import { McpSecurityGatewayProxy } from "../src/proxy.js";
import { JSON_RPC_ERRORS } from "../src/types.js";

describe("Task 2: MCP Security Gateway Proxy (Tool Filtering & Auth)", () => {
  let downstreamServer: MockDownstreamMcpServer;
  let gatewayProxy: McpSecurityGatewayProxy;
  let proxyUrl: string;

  const ADMIN_TOKEN = "admin-token-secret-key";
  const VIEWER_TOKEN = "viewer-token-read-only";
  const INVALID_TOKEN = "invalid-token-12345";

  beforeAll(async () => {
    // Start downstream mock MCP server on ephemeral port (port 0)
    downstreamServer = new MockDownstreamMcpServer(0);
    const downstreamPort = await downstreamServer.start();

    // Start gateway proxy pointing to the downstream server
    gatewayProxy = new McpSecurityGatewayProxy({
      port: 0,
      downstreamUrl: `http://127.0.0.1:${downstreamPort}`,
    });
    const proxyPort = await gatewayProxy.start();
    proxyUrl = `http://127.0.0.1:${proxyPort}`;
  });

  afterAll(async () => {
    await gatewayProxy?.stop();
    await downstreamServer?.stop();
  });

  beforeEach(() => {
    downstreamServer.resetStats();
    gatewayProxy.resetMetrics();
  });

  async function postJson(
    payload: unknown,
    token?: string,
    rawHeaders?: Record<string, string>
  ): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...rawHeaders,
    };

    if (token !== undefined) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(proxyUrl, {
      method: "POST",
      headers,
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    });

    const bodyText = await response.text();
    let bodyJson: any;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = bodyText;
    }

    return { status: response.status, body: bodyJson };
  }

  describe("Authentication & Header Verification", () => {
    it("rejects request when Authorization header is missing (HTTP 401)", async () => {
      const { status, body } = await postJson({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

      expect(status).toBe(401);
      expect(body.error).toBeDefined();
      expect(body.error.message).toContain("Missing Authorization header");
      expect(downstreamServer.stats.totalRequests).toBe(0);
    });

    it("rejects request with malformed authorization scheme (HTTP 401)", async () => {
      const { status, body } = await postJson(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        },
        undefined,
        { Authorization: "Basic dXNlcjpwYXNz" }
      );

      expect(status).toBe(401);
      expect(body.error.message).toContain("Expected 'Bearer <token>'");
      expect(downstreamServer.stats.totalRequests).toBe(0);
    });

    it("rejects request with invalid or unrecognized Bearer token (HTTP 401)", async () => {
      const { status, body } = await postJson(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/list",
        },
        INVALID_TOKEN
      );

      expect(status).toBe(401);
      expect(body.error.message).toContain("Invalid or expired Bearer token");
      expect(downstreamServer.stats.totalRequests).toBe(0);
    });

    it("rejects malformed JSON payload with JSON-RPC Parse Error -32700 (HTTP 400)", async () => {
      const { status, body } = await postJson("INVALID_RAW_JSON_STRING{{{", VIEWER_TOKEN);

      expect(status).toBe(400);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(JSON_RPC_ERRORS.PARSE_ERROR);
      expect(downstreamServer.stats.totalRequests).toBe(0);
    });
  });

  describe("tools/list Forwarding", () => {
    it("transparently forwards tools/list for viewer token", async () => {
      const { status, body } = await postJson(
        {
          jsonrpc: "2.0",
          id: "req-list-1",
          method: "tools/list",
          params: {},
        },
        VIEWER_TOKEN
      );

      expect(status).toBe(200);
      expect(body.id).toBe("req-list-1");
      expect(body.result).toBeDefined();
      expect(body.result.tools).toHaveLength(4);

      const toolNames = body.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("system_health");
      expect(toolNames).toContain("admin_reset_key");

      // Verify downstream was reached exactly once
      expect(downstreamServer.stats.totalRequests).toBe(1);
      expect(downstreamServer.stats.toolsListRequests).toBe(1);
    });

    it("transparently forwards tools/list for admin token", async () => {
      const { status, body } = await postJson(
        {
          jsonrpc: "2.0",
          id: "req-list-2",
          method: "tools/list",
          params: {},
        },
        ADMIN_TOKEN
      );

      expect(status).toBe(200);
      expect(body.id).toBe("req-list-2");
      expect(body.result.tools).toBeDefined();
      expect(downstreamServer.stats.totalRequests).toBe(1);
    });
  });

  describe("Non-Admin Tool Execution (Public Tools)", () => {
    it("allows viewer token to call system_health and returns downstream output", async () => {
      const { status, body } = await postJson(
        {
          jsonrpc: "2.0",
          id: 101,
          method: "tools/call",
          params: {
            name: "system_health",
            arguments: {},
          },
        },
        VIEWER_TOKEN
      );

      expect(status).toBe(200);
      expect(body.error).toBeUndefined();
      expect(body.result.content[0].type).toBe("text");

      const payload = JSON.parse(body.result.content[0].text);
      expect(payload.status).toBe("healthy");
      expect(downstreamServer.stats.toolCallCounts["system_health"]).toBe(1);
    });

    it("allows viewer token to call get_metrics and returns downstream output", async () => {
      const { status, body } = await postJson(
        {
          jsonrpc: "2.0",
          id: 102,
          method: "tools/call",
          params: {
            name: "get_metrics",
            arguments: {},
          },
        },
        VIEWER_TOKEN
      );

      expect(status).toBe(200);
      expect(body.error).toBeUndefined();

      const payload = JSON.parse(body.result.content[0].text);
      expect(payload.cpu_usage_percent).toBeDefined();
      expect(downstreamServer.stats.toolCallCounts["get_metrics"]).toBe(1);
    });
  });

  describe("Admin Tool Execution & Security Policy Filtering", () => {
    it("intercepts admin_reset_key when invoked with viewer token (-32001)", async () => {
      const { status, body } = await postJson(
        {
          jsonrpc: "2.0",
          id: "sec-test-01",
          method: "tools/call",
          params: {
            name: "admin_reset_key",
            arguments: { key_name: "production_master_key" },
          },
        },
        VIEWER_TOKEN
      );

      // Must be intercepted with HTTP 403 / JSON-RPC -32001
      expect(status).toBe(403);
      expect(body.result).toBeUndefined();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(JSON_RPC_ERRORS.UNAUTHORIZED_TOOL_CALL); // -32001
      expect(body.error.message).toContain("requires 'admin' role");
      expect(body.id).toBe("sec-test-01");

      // CRUCIAL: Downstream server must NEVER have been called!
      expect(downstreamServer.stats.totalRequests).toBe(0);
      expect(downstreamServer.stats.toolCallCounts["admin_reset_key"]).toBeUndefined();
      expect(gatewayProxy.interceptedCount).toBe(1);
    });

    it("intercepts admin_purge_cache when invoked with viewer token (-32001)", async () => {
      const { status, body } = await postJson(
        {
          jsonrpc: "2.0",
          id: "sec-test-02",
          method: "tools/call",
          params: {
            name: "admin_purge_cache",
            arguments: { namespace: "user_sessions" },
          },
        },
        VIEWER_TOKEN
      );

      expect(status).toBe(403);
      expect(body.error.code).toBe(JSON_RPC_ERRORS.UNAUTHORIZED_TOOL_CALL);
      expect(body.id).toBe("sec-test-02");

      // Verify zero downstream requests reached
      expect(downstreamServer.stats.totalRequests).toBe(0);
      expect(gatewayProxy.interceptedCount).toBe(1);
    });

    it("allows admin_reset_key when invoked with admin token (forwarded to downstream)", async () => {
      const { status, body } = await postJson(
        {
          jsonrpc: "2.0",
          id: "admin-exec-01",
          method: "tools/call",
          params: {
            name: "admin_reset_key",
            arguments: { key_name: "primary_oauth_secret" },
          },
        },
        ADMIN_TOKEN
      );

      expect(status).toBe(200);
      expect(body.error).toBeUndefined();
      expect(body.result).toBeDefined();

      const payload = JSON.parse(body.result.content[0].text);
      expect(payload.action).toBe("admin_reset_key");
      expect(payload.status).toBe("regenerated");
      expect(payload.new_key_id).toBeDefined();

      // Downstream server WAS called
      expect(downstreamServer.stats.totalRequests).toBe(1);
      expect(downstreamServer.stats.toolCallCounts["admin_reset_key"]).toBe(1);
      expect(gatewayProxy.forwardedCount).toBe(1);
      expect(gatewayProxy.interceptedCount).toBe(0);
    });

    it("allows admin_purge_cache when invoked with admin token (forwarded to downstream)", async () => {
      const { status, body } = await postJson(
        {
          jsonrpc: "2.0",
          id: "admin-exec-02",
          method: "tools/call",
          params: {
            name: "admin_purge_cache",
            arguments: { namespace: "llm_completion_cache" },
          },
        },
        ADMIN_TOKEN
      );

      expect(status).toBe(200);
      expect(body.error).toBeUndefined();

      const payload = JSON.parse(body.result.content[0].text);
      expect(payload.action).toBe("admin_purge_cache");
      expect(payload.status).toBe("purged");
      expect(payload.items_evicted).toBe(1542);

      expect(downstreamServer.stats.totalRequests).toBe(1);
      expect(downstreamServer.stats.toolCallCounts["admin_purge_cache"]).toBe(1);
    });
  });
});
