import { MockModelProvider } from "./mock-providers.js";
import { ResilientRouterGatewayServer } from "./gateway-server.js";

async function main(): Promise<void> {
  const primaryPort = 8301;
  const secondaryPort = 8302;
  const gatewayPort = 8300;

  const primary = new MockModelProvider("primary-provider", primaryPort);
  await primary.start();
  console.log(`[Primary Provider] Online at http://127.0.0.1:${primaryPort}`);

  const secondary = new MockModelProvider("secondary-provider", secondaryPort);
  await secondary.start();
  console.log(`[Secondary Provider] Online at http://127.0.0.1:${secondaryPort}`);

  const gateway = new ResilientRouterGatewayServer({
    port: gatewayPort,
    rateLimiterOptions: {
      limitTokensPerWindow: 50000,
      windowMs: 60000,
    },
    routerOptions: {
      primaryUrl: `http://127.0.0.1:${primaryPort}`,
      secondaryUrl: `http://127.0.0.1:${secondaryPort}`,
      timeoutMs: 3000,
    },
  });

  await gateway.start();
  console.log(`[Resilient Router Gateway] Listening on http://127.0.0.1:${gatewayPort}`);
  console.log(`Token rate limiting: 50,000 tokens/min | Fallback timeout: 3000ms`);
}

main().catch((err) => {
  console.error("Failed to start router gateway services:", err);
  process.exit(1);
});
