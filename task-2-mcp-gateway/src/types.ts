export type UserRole = "admin" | "viewer";

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: UserRole;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

/**
 * Standard JSON-RPC Error Codes
 */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom Gateway Authorization error code as specified in prompt
  UNAUTHORIZED_TOOL_CALL: -32001,
} as const;
