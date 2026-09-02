import { MockUpstreamLlmServer } from "./mock-upstream.js";
import { StreamingGuardrailGateway } from "./gateway.js";

async function main(): Promise<void> {
  const upstreamPort = 8201;
  const gatewayPort = 8200;

  const upstream = new MockUpstreamLlmServer(upstreamPort);
  await upstream.start();
  console.log(`[Mock Upstream LLM] Streaming service running on http://127.0.0.1:${upstreamPort}`);

  const gateway = new StreamingGuardrailGateway({
    port: gatewayPort,
    upstreamUrl: `http://127.0.0.1:${upstreamPort}`,
  });
  await gateway.start();
  console.log(`[Streaming Guardrail Gateway] Listening on http://127.0.0.1:${gatewayPort}`);
  console.log(`Real-time PII redaction pipeline active with split-token boundary protection.`);
}

main().catch((err) => {
  console.error("Failed to start Streaming Guardrail Gateway services:", err);
  process.exit(1);
});
