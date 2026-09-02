import { AuthenticatedUser } from "./types.js";

/**
 * In-memory directory of valid Bearer tokens and associated user principals.
 */
const TOKEN_REGISTRY: Record<string, AuthenticatedUser> = {
  "admin-token-secret-key": {
    id: "usr-admin-01",
    name: "Enterprise Admin",
    role: "admin",
  },
  "viewer-token-read-only": {
    id: "usr-viewer-01",
    name: "Analytics Viewer",
    role: "viewer",
  },
};

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * Extracts and verifies the Bearer token from the incoming HTTP Authorization header.
 * Decodes the corresponding user principal and role.
 */
export function authenticateRequest(authHeader: string | undefined): AuthenticatedUser {
  if (!authHeader) {
    throw new AuthenticationError("Missing Authorization header");
  }

  const parts = authHeader.trim().split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    throw new AuthenticationError("Invalid Authorization header format. Expected 'Bearer <token>'");
  }

  const token = parts[1];
  const user = TOKEN_REGISTRY[token];

  if (!user) {
    throw new AuthenticationError("Invalid or expired Bearer token");
  }

  return user;
}
