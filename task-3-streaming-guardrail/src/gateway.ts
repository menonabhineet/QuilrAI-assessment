import http from "http";
import { GatewayStreamOptions } from "./types.js";
import { PiiRedactionTransform } from "./stream-transform.js";

export class StreamingGuardrailGateway {
  private server: http.Server | null = null;
  private port: number;
  private upstreamUrl: string;
  private maxLookbackChars: number;
  public totalRequestsHandled = 0;

  constructor(options: GatewayStreamOptions) {
    this.port = options.port;
    this.upstreamUrl = options.upstreamUrl;
    this.maxLookbackChars = options.maxLookbackChars ?? 48;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((clientReq, clientRes) => {
        if (clientReq.method !== "POST") {
          clientRes.writeHead(405, { "Content-Type": "application/json" });
          clientRes.end(JSON.stringify({ error: "POST method required" }));
          return;
        }

        this.totalRequestsHandled++;

        const url = new URL(this.upstreamUrl);
        const upstreamReq = http.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          },
          (upstreamRes) => {
            // Forward headers and disable proxy buffering
            clientRes.writeHead(upstreamRes.statusCode || 200, {
              "Content-Type": upstreamRes.headers["content-type"] || "text/plain; charset=utf-8",
              "Transfer-Encoding": "chunked",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "X-Accel-Buffering": "no", // Prevent reverse proxy buffer accumulation
            });

            // Instantiate real-time streaming PII redaction pipeline
            const redactor = new PiiRedactionTransform(this.maxLookbackChars);

            // Zero full-response memory accumulation: stream pipe
            upstreamRes.pipe(redactor).pipe(clientRes);
          }
        );

        upstreamReq.on("error", (err) => {
          if (!clientRes.headersSent) {
            clientRes.writeHead(502, { "Content-Type": "application/json" });
            clientRes.end(JSON.stringify({ error: `Upstream error: ${err.message}` }));
          }
        });

        // Forward request body if any
        clientReq.pipe(upstreamReq);

        // Terminate upstream LLM generation if client disconnects prematurely
        clientReq.on("aborted", () => {
          upstreamReq.destroy();
        });

        clientRes.on("close", () => {
          if (!clientRes.writableFinished) {
            upstreamReq.destroy();
          }
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
