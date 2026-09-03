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

  private forwardToDownstream(body: string, clientReqPath: string, clientRes: http.ServerResponse): void {
    this.forwardedCount++;

    const url = new URL(this.downstreamUrl);
    // Preserve client's original req.url path if available and not just root
    const targetPath = clientReqPath && clientReqPath !== "/" ? clientReqPath : url.pathname;

    const reqOptions: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: targetPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = http.request(reqOptions, (res) => {
      clientRes.writeHead(res.statusCode || 200, res.headers);
      res.pipe(clientRes);
    });

    req.on("error", (err) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "Content-Type": "application/json" });
        clientRes.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: JSON_RPC_ERRORS.INTERNAL_ERROR,
              message: `Downstream service unreachable: ${err.message}`,
            },
          })
        );
      }
    });

    req.write(body);
    req.end();
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
          req.resume(); // drain incoming socket to prevent keep-alive socket hang
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

        // 2. Read request body with 2MB limit to prevent OOM DoS
        let rawBody = "";
        let bodyLength = 0;
        const MAX_PAYLOAD_SIZE = 2 * 1024 * 1024; // 2MB
        let payloadTooLarge = false;

        req.on("data", (chunk) => {
          if (payloadTooLarge) return;
          rawBody += chunk.toString("utf8");
          bodyLength += chunk.length;
          if (bodyLength > MAX_PAYLOAD_SIZE) {
            payloadTooLarge = true;
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Payload Too Large: Maximum 2MB allowed" }));
            req.destroy(); // immediately destroy TCP socket
          }
        });

        req.on("end", async () => {
          if (payloadTooLarge) return;

          // 3. Parse JSON-RPC wire format
          let jsonRpc: any;
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

          // Validate that the payload is a valid JSON-RPC 2.0 object
          if (!jsonRpc || typeof jsonRpc !== "object" || Array.isArray(jsonRpc)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: null,
                error: {
                  code: JSON_RPC_ERRORS.INVALID_REQUEST,
                  message: "Invalid Request: Expected a JSON-RPC 2.0 request object",
                },
              })
            );
            return;
          }

          if (jsonRpc.jsonrpc !== "2.0" || typeof jsonRpc.method !== "string" || !jsonRpc.method) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: jsonRpc.id ?? null,
                error: {
                  code: JSON_RPC_ERRORS.INVALID_REQUEST,
                  message: "Invalid Request: Payload must include 'jsonrpc': '2.0' and a valid 'method' string",
                },
              })
            );
            return;
          }

          const { method, params, id } = jsonRpc;

          // 4. Policy inspection: tools/list vs tools/call
          if (method === "tools/list") {
            // Transparently forward tools/list to downstream
            this.forwardToDownstream(rawBody, req.url || "/", res);
            return;
          }

          if (method === "tools/call") {
            // Guard against type confusion if params or params.name is not a string
            const toolName = typeof params?.name === "string" ? params.name : undefined;

            if (params && params.name !== undefined && typeof params.name !== "string") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: id ?? null,
                  error: {
                    code: JSON_RPC_ERRORS.INVALID_PARAMS,
                    message: "Invalid params: 'params.name' must be a string",
                  },
                })
              );
              return;
            }

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
            this.forwardToDownstream(rawBody, req.url || "/", res);
            return;
          }

          // Any other JSON-RPC method: forward transparently
          this.forwardToDownstream(rawBody, req.url || "/", res);
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
