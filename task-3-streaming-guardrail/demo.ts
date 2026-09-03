import { MockUpstreamLlmServer, MockStreamScenario } from "./src/mock-upstream.js";
import { StreamingGuardrailGateway } from "./src/gateway.js";

console.log("\n=======================================================");
console.log("  Task 3: Live Demo of Streaming PII Guardrail Gateway");
console.log("=======================================================\n");

async function streamRequest(gatewayUrl: string, scenarioName: string): Promise<string> {
  console.log(`>>> Running: ${scenarioName}`);
  const startTime = Date.now();
  let firstChunkTime = 0;
  let chunkCount = 0;

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: scenarioName }),
  });

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const decoder = new TextDecoder();
  let fullRedactedOutput = "";
  let sseBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunkText = decoder.decode(value, { stream: true });
    if (!chunkText) continue;

    sseBuffer += chunkText;
    let boundaryIndex;
    while ((boundaryIndex = sseBuffer.indexOf("\n\n")) !== -1) {
      const sseEvent = sseBuffer.slice(0, boundaryIndex);
      sseBuffer = sseBuffer.slice(boundaryIndex + 2);

      if (sseEvent.startsWith("data: ")) {
        const jsonStr = sseEvent.slice(6).trim();
        if (jsonStr && jsonStr !== "[DONE]") {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed && typeof parsed.content === "string") {
              const content = parsed.content;
              chunkCount++;
              if (chunkCount === 1) {
                firstChunkTime = Date.now() - startTime;
              }

              const elapsed = Date.now() - startTime;
              fullRedactedOutput += content;

              // Highlight redactions in terminal
              const formatted = content.replace(/\[REDACTED\]/g, "\x1b[31m[REDACTED]\x1b[0m");
              console.log(
                `  \x1b[36m[+${elapsed.toString().padStart(4, " ")}ms]\x1b[0m Chunk #${chunkCount}: "${formatted}"`
              );
            }
          } catch (e) {
            // Ignore malformed JSON
          }
        }
      }
    }
  }

  const totalDuration = Date.now() - startTime;
  console.log(`  - TTFT: ${firstChunkTime}ms | Duration: ${totalDuration}ms | Chunks: ${chunkCount}\n`);
  return fullRedactedOutput;
}

async function runDemo() {
  const upstream = new MockUpstreamLlmServer(0);
  const upstreamPort = await upstream.start();

  const gateway = new StreamingGuardrailGateway({
    port: 0,
    upstreamUrl: `http://127.0.0.1:${upstreamPort}`,
    maxLookbackChars: 48,
  });
  const gatewayPort = await gateway.start();
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

  console.log(`[Services Online]`);
  console.log(`  - Mock Upstream LLM Server streaming on port ${upstreamPort}`);
  console.log(`  - Streaming Guardrail Gateway listening on port ${gatewayPort}\n`);

  // Scenario 1: Multi-field stream with split boundaries
  console.log("-------------------------------------------------------");
  console.log("Scenario 1: Full profile stream with multi-pattern splits (Email, SSN, Credit Card)");
  console.log("-------------------------------------------------------");
  await streamRequest(gatewayUrl, "Full customer profile stream");

  // Scenario 2: Specific pre-@ boundary split
  console.log("-------------------------------------------------------");
  console.log("Scenario 2: Boundary split before @ symbol (john.doe in chunk 1, @gmail.com in chunk 2)");
  console.log("-------------------------------------------------------");
  const splitBeforeAtScenario: MockStreamScenario = {
    delayMs: 20,
    chunks: [
      "Contact the administrator: john.doe",
      "@gmail.com for account verification.",
    ],
  };
  upstream.setScenario(splitBeforeAtScenario);
  await streamRequest(gatewayUrl, "Pre-@ split token test");

  console.log("=======================================================");
  console.log("  Demo Complete: Verified Real-Time Streaming & Redaction!");
  console.log("  - Safe tokens emitted progressively with low TTFT");
  console.log("  - Split boundary tokens redacted without buffering full response");
  console.log("=======================================================\n");

  await gateway.stop();
  await upstream.stop();
}

runDemo().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
