import http from "http";
import { authenticateRequest, AuthenticationError } from "./auth.js";
import {
  JsonRpcRequest,
  JsonRpcResponse,
  JSON_RPC_ERRORS,
  AuthenticatedUser,
} from "./types.js";

export interface ProxyOptions {
  port: number;
  downstreamUrl: string;
}

export class McpSecurityGatewayProxy {
  private server: http.Server | null = null;
  private port: number;
  private downstreamUrl: string;
  public interceptedCount = 0;
  public forwardedCount = 0;

  constructor(options: ProxyOptions) {
    this.port = options.port;
    this.downstreamUrl = options.downstreamUrl;
  }

  resetMetrics(): void {
    this.interceptedCount = 0;
    this.forwardedCount = 0;
  }

  private async forwardToDownstream(body: string): Promise<{ status: number; data: string }> {
    this.forwardedCount++;

    return new Promise((resolve, reject) => {
      const url = new URL(this.downstreamUrl);
      const reqOptions: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      };

      const req = http.request(reqOptions, (res) => {
        let resBody = "";
        res.on("data", (chunk) => {
          resBody += chunk.toString("utf8");
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 200, data: resBody });
        });
      });

      req.on("error", (err) => {
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Enforce POST method
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method Not Allowed, POST required" }));
          return;
        }

        // 1. Authenticate Bearer token & extract user role
        let user: AuthenticatedUser;
        try {
          const authHeader = req.headers.authorization;
          user = authenticateRequest(authHeader);
        } catch (authErr) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32000,
                message: (authErr as Error).message,
              },
            })
          );
          return;
        }

        // 2. Read request body
        let rawBody = "";
        req.on("data", (chunk) => {
          rawBody += chunk.toString("utf8");
        });

        req.on("end", async () => {
          // 3. Parse JSON-RPC wire format
          let jsonRpc: JsonRpcRequest;
          try {
            jsonRpc = JSON.parse(rawBody);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: null,
                error: {
                  code: JSON_RPC_ERRORS.PARSE_ERROR,
                  message: "Parse error: Invalid JSON was received by gateway proxy",
                },
              })
            );
            return;
          }

          const { method, params, id } = jsonRpc;

          // 4. Policy inspection: tools/list vs tools/call
          if (method === "tools/list") {
            // Transparently forward tools/list to downstream
            try {
              const downstreamRes = await this.forwardToDownstream(rawBody);
              res.writeHead(downstreamRes.status, { "Content-Type": "application/json" });
              res.end(downstreamRes.data);
            } catch (err) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  error: {
                    code: JSON_RPC_ERRORS.INTERNAL_ERROR,
                    message: `Downstream service unreachable: ${(err as Error).message}`,
                  },
                })
              );
            }
            return;
          }

          if (method === "tools/call") {
            const toolName = params?.name as string | undefined;

            // Fine-grained authorization: check if tool begins with admin_
            if (toolName && toolName.startsWith("admin_")) {
              if (user.role !== "admin") {
                this.interceptedCount++;
                // Intercept unauthorized tool call before reaching downstream
                const unauthorizedResponse: JsonRpcResponse = {
                  jsonrpc: "2.0",
                  id: id ?? null,
                  error: {
                    code: JSON_RPC_ERRORS.UNAUTHORIZED_TOOL_CALL,
                    message: `Unauthorized Tool Call: Tool '${toolName}' requires 'admin' role, but authenticated user has role '${user.role}'`,
                  },
                };
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify(unauthorizedResponse));
                return;
              }
            }

            // User authorized or tool is non-admin: forward to downstream
            try {
              const downstreamRes = await this.forwardToDownstream(rawBody);
              res.writeHead(downstreamRes.status, { "Content-Type": "application/json" });
              res.end(downstreamRes.data);
            } catch (err) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  error: {
                    code: JSON_RPC_ERRORS.INTERNAL_ERROR,
                    message: `Downstream service unreachable: ${(err as Error).message}`,
                  },
                })
              );
            }
            return;
          }

          // Any other JSON-RPC method: forward transparently
          try {
            const downstreamRes = await this.forwardToDownstream(rawBody);
            res.writeHead(downstreamRes.status, { "Content-Type": "application/json" });
            res.end(downstreamRes.data);
          } catch (err) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSON_RPC_ERRORS.INTERNAL_ERROR,
                  message: `Downstream service unreachable: ${(err as Error).message}`,
                },
              })
            );
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
