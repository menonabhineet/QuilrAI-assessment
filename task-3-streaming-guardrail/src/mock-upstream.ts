import http from "http";

export interface MockStreamScenario {
  chunks: string[];
  delayMs?: number;
  format?: "content" | "openai";
  includeDoneSentinel?: boolean;
}

export const DEFAULT_STREAM_SCENARIO: MockStreamScenario = {
  delayMs: 15,
  chunks: [
    "Diagnostic analysis completed for customer profile: ",
    "Primary contact email address is john.doe",
    "@enterprise-cloud.com for all billing questions. ",
    "Taxpayer identification SSN is 987-",
    "65-",
    "4321 recorded in audit log. ",
    "Payment method credit card on file: 4111-2222-",
    "3333-",
    "4444 with expiration 12/28. ",
    "System status is operational.",
  ],
};

export class MockUpstreamLlmServer {
  private server: http.Server | null = null;
  private port: number;
  private currentScenario: MockStreamScenario;

  constructor(port = 8201, scenario: MockStreamScenario = DEFAULT_STREAM_SCENARIO) {
    this.port = port;
    this.currentScenario = scenario;
  }

  setScenario(scenario: MockStreamScenario): void {
    this.currentScenario = scenario;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "POST required" }));
          return;
        }

        // Stream chunked response with SSE
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const chunks = [...this.currentScenario.chunks];
        const delay = this.currentScenario.delayMs ?? 10;
        const format = this.currentScenario.format ?? "content";

        const sendNext = () => {
          if (chunks.length === 0) {
            if (this.currentScenario.includeDoneSentinel) {
              res.write("data: [DONE]\n\n");
            }
            res.end();
            return;
          }

          const chunk = chunks.shift()!;
          const payload =
            format === "openai"
              ? JSON.stringify({ choices: [{ delta: { content: chunk } }] })
              : JSON.stringify({ content: chunk });
          res.write(`data: ${payload}\n\n`);

          if (delay > 0) {
            setTimeout(sendNext, delay);
          } else {
            sendNext();
          }
        };

        sendNext();
      });

      this.server.listen(this.port, () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : this.port;
        this.port = actualPort;
        resolve(actualPort);
      });

      this.server.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.port;
  }
}
