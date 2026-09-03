import http from "http";
import { TokenAwareRateLimiter } from "./token-rate-limiter.js";
import { ResilientModelRouter } from "./router.js";
import { CompletionRequest, RateLimiterOptions, RouterOptions } from "./types.js";

export interface GatewayServerConfig {
  port: number;
  rateLimiterOptions?: RateLimiterOptions;
  routerOptions: RouterOptions;
}

export class ResilientRouterGatewayServer {
  private server: http.Server | null = null;
  private port: number;
  public rateLimiter: TokenAwareRateLimiter;
  public router: ResilientModelRouter;

  constructor(config: GatewayServerConfig) {
    this.port = config.port;
    this.rateLimiter = new TokenAwareRateLimiter(config.rateLimiterOptions);
    this.router = new ResilientModelRouter(config.routerOptions);
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "POST method required" }));
          return;
        }

        // 1. Extract Tenant ID from Authorization or X-Tenant-ID header
        const authHeader = req.headers.authorization;
        const tenantHeader = req.headers["x-tenant-id"] as string | undefined;
        let tenantId = "default-tenant";

        if (tenantHeader) {
          tenantId = tenantHeader;
        } else if (authHeader && authHeader.startsWith("Bearer ")) {
          tenantId = authHeader.replace("Bearer ", "").trim();
        }

        // 2. Ingest request body with 2MB limit
        let bodyStr = "";
        let bodyLength = 0;
        const MAX_PAYLOAD_SIZE = 2 * 1024 * 1024; // 2MB
        let payloadTooLarge = false;

        req.on("data", (chunk) => {
          if (payloadTooLarge) return;
          bodyStr += chunk.toString("utf8");
          bodyLength += chunk.length;
          if (bodyLength > MAX_PAYLOAD_SIZE) {
            payloadTooLarge = true;
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: {
                  code: "PAYLOAD_TOO_LARGE",
                  message: "Payload exceeds 2MB maximum limit",
                },
              })
            );
            req.destroy();
          }
        });

        req.on("end", async () => {
          if (payloadTooLarge) return;

          let requestPayload: any;
          try {
            requestPayload = JSON.parse(bodyStr);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: {
                  code: "INVALID_JSON",
                  message: "Malformed JSON payload in request body",
                },
              })
            );
            return;
          }

          // Validate non-null object and valid prompt
          if (!requestPayload || typeof requestPayload !== "object" || Array.isArray(requestPayload)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: {
                  code: "INVALID_PAYLOAD",
                  message: "Request payload must be a non-null JSON object",
                },
              })
            );
            return;
          }

          if (typeof requestPayload.prompt !== "string" || requestPayload.prompt.length === 0) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: {
                  code: "INVALID_PROMPT",
                  message: "Field 'prompt' must be a non-empty string",
                },
              })
            );
            return;
          }

          // 3. Token-Aware Rate Limiting
          const estimatedTokens = this.rateLimiter.estimateTokens(
            requestPayload.prompt,
            requestPayload.max_tokens
          );

          const rateCheck = this.rateLimiter.checkAndConsume(tenantId, estimatedTokens);

          if (!rateCheck.allowed) {
            res.writeHead(429, {
              "Content-Type": "application/json",
              "Retry-After": rateCheck.resetSeconds.toString(),
              "X-RateLimit-Limit": rateCheck.limit.toString(),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": rateCheck.resetSeconds.toString(),
            });

            res.end(
              JSON.stringify({
                error: {
                  code: "RATE_LIMIT_EXCEEDED",
                  message: `Rate limit exceeded: Tenant '${tenantId}' has consumed ${rateCheck.currentUsage} tokens in the current window (limit: ${rateCheck.limit} tokens/min).`,
                  limit: rateCheck.limit,
                  current_usage: rateCheck.currentUsage,
                  requested_tokens: estimatedTokens,
                  retry_after_seconds: rateCheck.resetSeconds,
                },
              })
            );
            return;
          }

          // 4. Resilient Fallback Routing (3000ms primary timeout / 429 failover)
          const abortController = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) {
              abortController.abort();
            }
          });

          try {
            const completion = await this.router.routeCompletion(requestPayload, abortController.signal);

            // Reconcile consumed tokens against actual tokens used
            if (completion.tokens_used?.total_tokens) {
              this.rateLimiter.reconcileTokens(
                tenantId,
                estimatedTokens,
                completion.tokens_used.total_tokens
              );
            }

            res.writeHead(200, {
              "Content-Type": "application/json",
              "X-Model-Provider": completion.provider,
              "X-Fallback-Occurred": completion.fallback_occurred.toString(),
              "X-RateLimit-Limit": rateCheck.limit.toString(),
              "X-RateLimit-Remaining": rateCheck.remaining.toString(),
            });

            res.end(JSON.stringify(completion));
          } catch (err: any) {
            // Refund unconsumed tokens when request fails
            this.rateLimiter.reconcileTokens(tenantId, estimatedTokens, 0);

            const statusCode = err.status || 502;
            const payload = err.gatewayPayload || {
              error: {
                code: "INTERNAL_GATEWAY_FAILURE",
                message: "A sanitized gateway error occurred while processing model completion.",
              },
            };

            res.writeHead(statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
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
