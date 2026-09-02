import { MockDownstreamMcpServer } from "./downstream-mcp.js";
import { McpSecurityGatewayProxy } from "./proxy.js";

async function main(): Promise<void> {
  const downstreamPort = 8101;
  const proxyPort = 8100;

  const downstream = new MockDownstreamMcpServer(downstreamPort);
  await downstream.start();
  console.log(`[Downstream MCP] Running on http://127.0.0.1:${downstreamPort}`);

  const proxy = new McpSecurityGatewayProxy({
    port: proxyPort,
    downstreamUrl: `http://127.0.0.1:${downstreamPort}`,
  });
  await proxy.start();
  console.log(`[MCP Gateway Proxy] Listening on http://127.0.0.1:${proxyPort}`);
  console.log(`Ready for authenticated requests (admin vs viewer tokens).`);
}

main().catch((err) => {
  console.error("Failed to start MCP Gateway services:", err);
  process.exit(1);
});
