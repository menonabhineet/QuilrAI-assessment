/**
 * Logger strictly dedicated to stderr.
 * In MCP stdio transport, stdout is exclusively reserved for JSON-RPC frames.
 * Any log sent to stdout will corrupt the JSON-RPC wire format.
 */

export class StderrLogger {
  private prefix: string;

  constructor(prefix = "mcp-server") {
    this.prefix = prefix;
  }

  private write(level: string, message: string, meta?: unknown): void {
    const timestamp = new Date().toISOString();
    const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : "";
    process.stderr.write(`[${timestamp}] [${level.toUpperCase()}] [${this.prefix}] ${message}${metaStr}\n`);
  }

  info(message: string, meta?: unknown): void {
    this.write("info", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write("warn", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write("error", message, meta);
  }

  debug(message: string, meta?: unknown): void {
    this.write("debug", message, meta);
  }
}

export const logger = new StderrLogger();

/**
 * Monkey-patches console.log and other stdout methods to route to stderr.
 * Guarantees that third-party modules or accidental log statements
 * never pollute the JSON-RPC stdout stream.
 */
export function enforceStdioIsolation(): void {
  console.log = (...args: unknown[]) => {
    process.stderr.write(`[STDOUT-REDIRECTED] ${args.map(String).join(" ")}\n`);
  };
  console.info = (...args: unknown[]) => {
    process.stderr.write(`[INFO] ${args.map(String).join(" ")}\n`);
  };
  console.debug = (...args: unknown[]) => {
    process.stderr.write(`[DEBUG] ${args.map(String).join(" ")}\n`);
  };
  console.warn = (...args: unknown[]) => {
    process.stderr.write(`[WARN] ${args.map(String).join(" ")}\n`);
  };

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: Uint8Array | string, encoding?: any, cb?: any) => {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    // Allow MCP SDK JSON-RPC frames to pass through to stdout
    if (str.includes('"jsonrpc"')) {
      return originalStdoutWrite(chunk, encoding, cb);
    }
    // Redirect all other stdout writes to stderr
    process.stderr.write(`[STDOUT-REDIRECTED] ${str}`);
    if (cb) cb();
    return true;
  };
}
