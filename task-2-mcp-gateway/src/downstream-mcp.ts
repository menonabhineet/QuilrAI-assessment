import http from "http";
import { JsonRpcRequest, JsonRpcResponse, JSON_RPC_ERRORS } from "./types.js";

export interface DownstreamStats {
  totalRequests: number;
  toolsListRequests: number;
  toolCallCounts: Record<string, number>;
}

export class MockDownstreamMcpServer {
  private server: http.Server | null = null;
  private port: number;
  public stats: DownstreamStats = {
    totalRequests: 0,
    toolsListRequests: 0,
    toolCallCounts: {},
  };

  constructor(port = 8101) {
    this.port = port;
  }

  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      toolsListRequests: 0,
      toolCallCounts: {},
    };
  }

  handleJsonRpc(request: JsonRpcRequest): JsonRpcResponse {
    this.stats.totalRequests++;

    const { method, params, id } = request;

    if (method === "tools/list") {
      this.stats.toolsListRequests++;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "system_health",
              description: "Public tool: Check overall downstream server health and uptime.",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "get_metrics",
              description: "Public tool: Retrieve system and runtime performance metrics.",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "admin_reset_key",
              description: "Admin tool: Invalidate and regenerate a secret cryptographic key.",
              inputSchema: {
                type: "object",
                properties: { key_name: { type: "string" } },
                required: ["key_name"],
              },
            },
            {
              name: "admin_purge_cache",
              description: "Admin tool: Evict all cached records from the specified namespace.",
              inputSchema: {
                type: "object",
                properties: { namespace: { type: "string" } },
                required: ["namespace"],
              },
            },
          ],
        },
      };
    }

    if (method === "tools/call") {
      const toolName = params?.name as string;
      const toolArgs = params?.arguments ?? {};

      this.stats.toolCallCounts[toolName] = (this.stats.toolCallCounts[toolName] || 0) + 1;

      switch (toolName) {
        case "system_health":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "healthy",
                    uptime_seconds: 48120,
                    version: "2.4.1",
                    node_version: process.version,
                  }),
                },
              ],
            },
          };

        case "get_metrics":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    cpu_usage_percent: 12.4,
                    memory_rss_mb: 48.2,
                    active_connections: 3,
                    requests_per_sec: 142.5,
                  }),
                },
              ],
            },
          };

        case "admin_reset_key":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    action: "admin_reset_key",
                    key_name: toolArgs.key_name || "default_api_key",
                    status: "regenerated",
                    new_key_id: "sec-key-9941a8",
                    timestamp: new Date().toISOString(),
                  }),
                },
              ],
            },
          };

        case "admin_purge_cache":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    action: "admin_purge_cache",
                    namespace: toolArgs.namespace || "global",
                    items_evicted: 1542,
                    freed_bytes: 4194304,
                    status: "purged",
                    timestamp: new Date().toISOString(),
                  }),
                },
              ],
            },
          };

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
              message: `Downstream tool '${toolName}' not found.`,
            },
          };
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        message: `Downstream method '${method}' not supported.`,
      },
    };
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed, POST required" }));
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString("utf8");
        });

        req.on("end", () => {
          try {
            const parsed = JSON.parse(body) as JsonRpcRequest;
            const response = this.handleJsonRpc(parsed);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
          } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: null,
                error: {
                  code: JSON_RPC_ERRORS.PARSE_ERROR,
                  message: "Invalid JSON payload received by downstream server",
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
