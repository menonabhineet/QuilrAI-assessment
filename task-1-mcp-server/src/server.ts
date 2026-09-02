import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  GetCustomerRecordSchema,
  TriggerRefundSchema,
  formatZodError,
} from "./types.js";
import { db } from "./db.js";
import { logger } from "./logger.js";

/**
 * Creates and configures the production MCP Server instance.
 * Exposes get_customer_record and trigger_refund with strict validation
 * and standard JSON-RPC error mapping.
 */
export function createCustomerMcpServer(): Server {
  const server = new Server(
    {
      name: "customer-management-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Advertise available tools with JSON Schema definitions
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.info("Listing tools advertised by server");
    return {
      tools: [
        {
          name: "get_customer_record",
          description: "Retrieve a verified customer record by their strictly formatted ID (CUST-XXXXX).",
          inputSchema: {
            type: "object",
            properties: {
              customer_id: {
                type: "string",
                description: "Customer identifier strictly formatted as CUST-XXXXX (e.g. CUST-10001)",
                pattern: "^CUST-[0-9]{5}$",
              },
            },
            required: ["customer_id"],
          },
        },
        {
          name: "trigger_refund",
          description: "Issue a monetary refund to an active customer account with audited reason.",
          inputSchema: {
            type: "object",
            properties: {
              customer_id: {
                type: "string",
                description: "Customer identifier strictly formatted as CUST-XXXXX (e.g. CUST-10001)",
                pattern: "^CUST-[0-9]{5}$",
              },
              amount: {
                type: "number",
                description: "Monetary amount to refund (positive float strictly greater than 0)",
                minimum: 0.01,
              },
              reason: {
                type: "string",
                description: "Auditable justification for refund (minimum 10 characters)",
                minLength: 10,
              },
            },
            required: ["customer_id", "amount", "reason"],
          },
        },
      ],
    };
  });

  // Handle incoming tool execution calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info("Tool call requested", { tool: name });

    if (name === "get_customer_record") {
      // 1. Strict input validation via Zod
      const parseResult = GetCustomerRecordSchema.safeParse(args);
      if (!parseResult.success) {
        const errorDetails = formatZodError(parseResult.error);
        logger.warn("Input validation rejected for get_customer_record", {
          error: errorDetails,
        });
        // JSON-RPC -32602: Invalid params
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid parameters for get_customer_record: ${errorDetails}`
        );
      }

      // 2. Execution logic
      try {
        const { customer_id } = parseResult.data;
        const customer = db.getCustomer(customer_id);

        if (!customer) {
          logger.warn("Customer ID not found in database", { customer_id });
          // Business error: entity not found
          throw new McpError(
            ErrorCode.InvalidParams,
            `Customer not found for identifier: ${customer_id}`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(customer, null, 2),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) {
          throw err;
        }
        // JSON-RPC -32603: Internal error
        logger.error("Internal execution error in get_customer_record", {
          error: String(err),
        });
        throw new McpError(
          ErrorCode.InternalError,
          `Internal server error while retrieving customer: ${(err as Error).message}`
        );
      }
    }

    if (name === "trigger_refund") {
      // 1. Strict input validation via Zod
      const parseResult = TriggerRefundSchema.safeParse(args);
      if (!parseResult.success) {
        const errorDetails = formatZodError(parseResult.error);
        logger.warn("Input validation rejected for trigger_refund", {
          error: errorDetails,
        });
        // JSON-RPC -32602: Invalid params
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid parameters for trigger_refund: ${errorDetails}`
        );
      }

      // 2. Execution logic
      try {
        const { customer_id, amount, reason } = parseResult.data;
        const result = db.processRefund(customer_id, amount, reason);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "success",
                  message: "Refund successfully executed",
                  refund: result.refund,
                  updated_balance: result.newBalance,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) {
          throw err;
        }
        // Business logic or internal execution failure
        const errorMessage = (err as Error).message;
        logger.error("Execution error during refund processing", {
          error: errorMessage,
        });

        // If customer not found, treat as invalid parameter
        if (errorMessage.includes("not found")) {
          throw new McpError(ErrorCode.InvalidParams, errorMessage);
        }

        // JSON-RPC -32603: Internal error for balance/status/runtime failures
        throw new McpError(ErrorCode.InternalError, `Refund processing failed: ${errorMessage}`);
      }
    }

    // JSON-RPC -32601: Method not found
    logger.warn("Unknown tool name requested", { tool: name });
    throw new McpError(
      ErrorCode.MethodNotFound,
      `Requested tool '${name}' is not supported by this server.`
    );
  });

  return server;
}
