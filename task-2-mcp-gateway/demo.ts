import { MockDownstreamMcpServer } from "./src/downstream-mcp.js";
import { McpSecurityGatewayProxy } from "./src/proxy.js";

console.log("\n=======================================================");
console.log("  Task 2: Live Demo of MCP Security Gateway Proxy");
console.log("=======================================================\n");

async function runDemo() {
  const downstream = new MockDownstreamMcpServer(0);
  const downstreamPort = await downstream.start();

  const proxy = new McpSecurityGatewayProxy({
    port: 0,
    downstreamUrl: `http://127.0.0.1:${downstreamPort}`,
  });
  const proxyPort = await proxy.start();
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  console.log(`[Services Online]`);
  console.log(`  - Mock Downstream MCP Server running on port ${downstreamPort}`);
  console.log(`  - MCP Security Gateway Proxy running on port ${proxyPort}`);

  const ADMIN_TOKEN = "admin-token-secret-key";
  const VIEWER_TOKEN = "viewer-token-read-only";

  async function post(description: string, token: string | undefined, payload: any) {
    console.log(`\n-------------------------------------------------------`);
    console.log(`>>> SCENARIO: ${description}`);
    console.log(`    Token: ${token ?? "NONE"}`);
    console.log(`    Request Body:\n`, JSON.stringify(payload, null, 2));

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(proxyUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    const color = res.status === 200 ? "\x1b[32m" : res.status === 403 ? "\x1b[33m" : "\x1b[31m";
    console.log(`${color}<<< PROXY RESPONSE (HTTP ${res.status}):\x1b[0m\n`, JSON.stringify(body, null, 2));
    return { status: res.status, body };
  }

  // 1. tools/list with viewer token
  await post("Viewer calls tools/list (Transparently Forwarded)", VIEWER_TOKEN, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });

  // 2. Public tool call with viewer token
  await post("Viewer calls public tool 'system_health' (Allowed & Forwarded)", VIEWER_TOKEN, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "system_health", arguments: {} },
  });

  // 3. Admin tool call with viewer token
  await post("Viewer calls admin tool 'admin_reset_key' (BLOCKED by Gateway -32001)", VIEWER_TOKEN, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "admin_reset_key", arguments: { key_name: "prod_oauth_key" } },
  });

  // 4. Admin tool call with admin token
  await post("Admin calls admin tool 'admin_reset_key' (Authorized & Forwarded)", ADMIN_TOKEN, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "admin_reset_key", arguments: { key_name: "prod_oauth_key" } },
  });

  // 5. Unauthenticated call
  await post("Unauthenticated request with missing Bearer token (Blocked HTTP 401)", undefined, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/list",
  });

  console.log("\n=======================================================");
  console.log("  Demo Summary & Verification Metrics:");
  console.log(`  - Gateway Total Forwarded Requests: ${proxy.forwardedCount}`);
  console.log(`  - Gateway Intercepted Unauthorized Calls: ${proxy.interceptedCount}`);
  console.log(`  - Downstream Server Total Calls Received: ${downstream.stats.totalRequests}`);
  console.log("=======================================================\n");

  await proxy.stop();
  await downstream.stop();
}

runDemo().catch((err) => {
  console.error("Demo error:", err);
  process.exit(1);
});
