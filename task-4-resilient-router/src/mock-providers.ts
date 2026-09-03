import http from "http";
import { CompletionRequest } from "./types.js";

export type ProviderMode = "healthy" | "rate_limit_429" | "timeout" | "internal_error" | "client_error_400";

export class MockModelProvider {
  private server: http.Server | null = null;
  private port: number;
  public readonly providerName: string;
  public mode: ProviderMode = "healthy";
  public timeoutDelayMs = 4000; // Greater than 3000ms router threshold
  public requestCount = 0;

  constructor(providerName: string, port = 0) {
    this.providerName = providerName;
    this.port = port;
  }

  setMode(mode: ProviderMode): void {
    this.mode = mode;
  }

  resetStats(): void {
    this.requestCount = 0;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed, POST required" }));
          return;
        }

        this.requestCount++;

        let rawBody = "";
        req.on("data", (chunk) => {
          rawBody += chunk.toString("utf8");
        });

        req.on("end", () => {
          let parsed: CompletionRequest = { prompt: "" };
          try {
            parsed = JSON.parse(rawBody);
          } catch {
            // ignore
          }

          if (this.mode === "client_error_400") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Invalid parameter rejected by provider",
              })
            );
            return;
          }

          if (this.mode === "rate_limit_429") {
            res.writeHead(429, {
              "Content-Type": "application/json",
              "Retry-After": "30",
            });
            res.end(
              JSON.stringify({
                error: {
                  code: "UPSTREAM_RATE_LIMIT",
                  message: `Provider ${this.providerName} quota exceeded (HTTP 429).`,
                },
              })
            );
            return;
          }

          if (this.mode === "internal_error") {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: {
                  code: "INTERNAL_SERVER_ERROR",
                  message: `Provider ${this.providerName} encountered an unhandled internal exception.`,
                  raw_stack: "Error: internal connection pool reset at ProviderCore.ts:192",
                },
              })
            );
            return;
          }

          if (this.mode === "timeout") {
            // Intentionally hold response beyond router's 3000ms deadline
            setTimeout(() => {
              if (!res.writableEnded) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                  JSON.stringify({
                    id: `comp-${this.providerName}-${Date.now()}`,
                    content: `Late completion from ${this.providerName}`,
                  })
                );
              }
            }, this.timeoutDelayMs);
            return;
          }

          // Default mode: healthy
          const promptTokens = Math.max(1, Math.ceil(parsed.prompt.length / 4));
          const completionTokens = 42;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              id: `comp-${this.providerName}-${Date.now()}`,
              model: `${this.providerName}-v2.5`,
              content: `Completed response from ${this.providerName}: Analysis verified.`,
              tokens_used: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
              },
            })
          );
        });
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
