import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { enforceStdioIsolation, logger } from "./logger.js";
import { createCustomerMcpServer } from "./server.js";

async function main(): Promise<void> {
  // Pure STDIO isolation: divert any console.log to stderr
  enforceStdioIsolation();

  logger.info("Initializing Customer Management MCP Server with STDIO transport...");

  const server = createCustomerMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  logger.info("Customer Management MCP Server is connected and ready for JSON-RPC over stdio.");
}

main().catch((error) => {
  logger.error("Fatal error during MCP server initialization", {
    error: (error as Error).message,
    stack: (error as Error).stack,
  });
  process.exit(1);
});
