import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockUpstreamLlmServer } from "../src/mock-upstream.js";
import { StreamingGuardrailGateway } from "../src/gateway.js";

describe("Task 3: Streaming Guardrail Gateway End-to-End Integration", () => {
  let upstreamServer: MockUpstreamLlmServer;
  let gateway: StreamingGuardrailGateway;
  let gatewayUrl: string;

  beforeAll(async () => {
    upstreamServer = new MockUpstreamLlmServer(0);
    const upstreamPort = await upstreamServer.start();

    gateway = new StreamingGuardrailGateway({
      port: 0,
      upstreamUrl: `http://127.0.0.1:${upstreamPort}`,
      maxLookbackChars: 48,
    });
    const gatewayPort = await gateway.start();
    gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  });

  afterAll(async () => {
    await gateway?.stop();
    await upstreamServer?.stop();
  });

  it("streams chunked response progressively with low TTFT", async () => {
    const startTime = Date.now();
    let ttft = 0;
    const receivedChunks: string[] = [];

    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Analyze customer profile" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("transfer-encoding")).toBe("chunked");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let sseBuffer = "";
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;

      if (receivedChunks.length === 0) {
        ttft = Date.now() - startTime;
      }

      sseBuffer += decoder.decode(value, { stream: true });
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
                receivedChunks.push(parsed.content);
              }
            } catch (e) {
              // ignore
            }
          }
        }
      }
    }

    const totalTime = Date.now() - startTime;

    // Verify streaming progressive emission
    expect(receivedChunks.length).toBeGreaterThan(1);

    // TTFT must be significantly lower than the total duration of all chunks
    expect(ttft).toBeLessThan(totalTime);

    const fullResponse = receivedChunks.join("");

    // Verify all sensitive PII was redacted
    expect(fullResponse).toContain("Primary contact email address is [REDACTED] for all billing");
    expect(fullResponse).toContain("Taxpayer identification SSN is [REDACTED] recorded in audit log.");
    expect(fullResponse).toContain("Payment method credit card on file: [REDACTED] with expiration");

    // Verify no raw PII leaked into client stream
    expect(fullResponse).not.toContain("john.doe@enterprise-cloud.com");
    expect(fullResponse).not.toContain("987-65-4321");
    expect(fullResponse).not.toContain("4111-2222-3333-4444");

    // Verify non-sensitive text is preserved
    expect(fullResponse).toContain("Diagnostic analysis completed for customer profile:");
    expect(fullResponse).toContain("System status is operational.");
  });

  it("handles clean stream with zero PII without alteration", async () => {
    upstreamServer.setScenario({
      delayMs: 5,
      chunks: [
        "System cluster overview: ",
        "Nodes: 12 active, ",
        "CPU utilization: 24.5%, ",
        "Storage healthy.",
      ],
    });

    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Status check" }),
    });

    const rawText = await response.text();
    let fullText = "";
    for (const line of rawText.split("\n\n")) {
      if (line.startsWith("data: ")) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr && jsonStr !== "[DONE]") {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed && typeof parsed.content === "string") {
              fullText += parsed.content;
            }
          } catch (e) { }
        }
      }
    }
    expect(fullText).toBe("System cluster overview: Nodes: 12 active, CPU utilization: 24.5%, Storage healthy.");
    expect(fullText).not.toContain("[REDACTED]");
  });

  it("flushes tail buffer before emitting data: [DONE] sentinel", async () => {
    upstreamServer.setScenario({
      delayMs: 5,
      chunks: [
        "Confidential direct contact: alice.smith",
        "@company.org is verified.",
      ],
      includeDoneSentinel: true,
    });

    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Contact lookup" }),
    });

    const rawText = await response.text();
    const events = rawText
      .split("\n\n")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("data: "));

    expect(events.length).toBeGreaterThan(1);

    // The very last event MUST be the [DONE] sentinel
    const lastEvent = events[events.length - 1];
    expect(lastEvent).toBe("data: [DONE]");

    // The event before [DONE] must not be [DONE]
    const secondToLast = events[events.length - 2];
    expect(secondToLast).not.toBe("data: [DONE]");

    // Combine all content before [DONE]
    let reconstructed = "";
    for (let i = 0; i < events.length - 1; i++) {
      const json = JSON.parse(events[i].slice(6));
      reconstructed += json.content;
    }

    expect(reconstructed).toContain("Confidential direct contact: [REDACTED] is verified.");
    expect(reconstructed).not.toContain("alice.smith@company.org");
  });

  it("redacts PII when upstream streams in standard OpenAI delta schema", async () => {
    upstreamServer.setScenario({
      delayMs: 5,
      format: "openai",
      includeDoneSentinel: true,
      chunks: [
        "Customer email is ",
        "alex.jones",
        "@fintech.io and SSN is 123-",
        "45-",
        "6789.",
      ],
    });

    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "OpenAI stream lookup" }),
    });

    const rawText = await response.text();
    const events = rawText
      .split("\n\n")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("data: "));

    let reconstructed = "";
    for (const evt of events) {
      const payloadStr = evt.slice(6).trim();
      if (payloadStr === "[DONE]") continue;

      const parsed = JSON.parse(payloadStr);
      expect(parsed.choices).toBeDefined();
      expect(parsed.choices[0].delta).toBeDefined();
      if (parsed.choices[0].delta.content) {
        reconstructed += parsed.choices[0].delta.content;
      }
    }

    expect(reconstructed).toBe("Customer email is [REDACTED] and SSN is [REDACTED].");
    expect(reconstructed).not.toContain("alex.jones@fintech.io");
    expect(reconstructed).not.toContain("123-45-6789");
  });
});
