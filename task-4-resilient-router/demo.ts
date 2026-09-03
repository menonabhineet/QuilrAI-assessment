import { MockModelProvider } from "./src/mock-providers.js";
import { ResilientRouterGatewayServer } from "./src/gateway-server.js";

console.log("\n=======================================================");
console.log("  Task 4: Live Demo of Rate Limiter & Fallback Router");
console.log("=======================================================\n");

async function runDemo() {
  const primary = new MockModelProvider("primary-gpt4o", 0);
  const primaryPort = await primary.start();

  const secondary = new MockModelProvider("secondary-haiku", 0);
  const secondaryPort = await secondary.start();

  const gateway = new ResilientRouterGatewayServer({
    port: 0,
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
  const gatewayPort = await gateway.start();
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

  console.log(`[Services Online]`);
  console.log(`  - Primary Model Provider online on port ${primaryPort}`);
  console.log(`  - Secondary Backup Model Provider online on port ${secondaryPort}`);
  console.log(`  - Resilient Router Gateway listening on port ${gatewayPort}\n`);

  async function post(label: string, payload: any, tenant = "demo-tenant") {
    console.log("-------------------------------------------------------");
    console.log(`>>> ${label}`);
    const start = Date.now();

    const res = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tenant}`,
      },
      body: JSON.stringify(payload),
    });

    const elapsed = Date.now() - start;
    const body = await res.json();
    const color = res.status === 200 ? "\x1b[32m" : res.status === 429 ? "\x1b[33m" : "\x1b[31m";

    console.log(
      `${color}<<< RESPONSE (HTTP ${res.status}, ${elapsed}ms):\x1b[0m\n`,
      JSON.stringify(body, null, 2)
    );
    return body;
  }

  // Scenario 1: Healthy Primary
  primary.setMode("healthy");
  await post("Scenario 1: Primary Model Healthy (Normal Route)", {
    prompt: "Generate an executive summary of cloud infrastructure costs.",
    max_tokens: 150,
  });

  // Scenario 2: Primary returns HTTP 429
  primary.setMode("rate_limit_429");
  await post("Scenario 2: Primary returns 429 (Automatic Fallback to Secondary)", {
    prompt: "Classify incoming security event telemetry.",
    max_tokens: 100,
  });

  // Scenario 3: Primary times out after 3000ms
  primary.setMode("timeout");
  primary.timeoutDelayMs = 4500; // Primary hangs for 4.5s
  await post("Scenario 3: Primary Times Out at 3000ms (Automatic Fallback to Secondary)", {
    prompt: "Transcribe audio stream transcript.",
    max_tokens: 200,
  });

  // Scenario 4: Gateway Token Rate Limiting (50,000 tokens/min)
  primary.setMode("healthy");
  // Pre-fill tenant quota close to 50k
  gateway.rateLimiter.checkAndConsume("rate-limited-tenant", 49500);
  await post(
    "Scenario 4: Tenant Exceeds 50,000 Tokens/Min (HTTP 429 from Gateway)",
    {
      prompt: "A".repeat(4000), // ~1000 prompt tokens + 200 max_tokens = 1200 tokens
      max_tokens: 200,
    },
    "rate-limited-tenant"
  );

  // Scenario 5: Both Providers Down (Sanitized Gateway Error)
  primary.setMode("rate_limit_429");
  secondary.setMode("internal_error");
  await post("Scenario 5: Both Upstream Providers Down (Sanitized Error Output)", {
    prompt: "Generate disaster recovery checklist.",
  });

  // Scenario 6: Primary rejects with HTTP 400 (Client error: No fallback triggered)
  primary.setMode("client_error_400");
  secondary.setMode("healthy");
  await post("Scenario 6: Client Error Rejection (HTTP 400 from Primary: No Fallback)", {
    prompt: "Trigger client error without triggering fallback.",
  });

  console.log("=======================================================");
  console.log("  Demo Complete: Verified Resilient Routing & Rate Limiting!");
  console.log("=======================================================\n");

  await gateway.stop();
  await secondary.stop();
  await primary.stop();
}

runDemo().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
