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

  let stdoutLineBuffer = "";
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  (process.stdout as any).write = (chunk: Uint8Array | string, encoding?: any, cb?: any) => {
    let callback = cb;
    let enc = encoding;
    if (typeof encoding === "function") {
      callback = encoding;
      enc = undefined;
    }

    const str = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(enc || "utf8");
    stdoutLineBuffer += str;

    const lines = stdoutLineBuffer.split("\n");
    // Retain incomplete fragment for subsequent chunk
    stdoutLineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let isJsonRpc = false;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.jsonrpc === "2.0") {
          isJsonRpc = true;
        }
      } catch {
        isJsonRpc = false;
      }

      if (isJsonRpc) {
        originalStdoutWrite(line + "\n");
      } else {
        process.stderr.write(`[STDOUT-REDIRECTED] ${line}\n`);
      }
    }

    if (callback) callback();
    return true;
  };
}
