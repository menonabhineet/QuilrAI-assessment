import { Transform, TransformCallback } from "stream";
import { PiiRedactionEngine } from "./engine.js";

/**
 * Node.js Transform Stream implementation of the PII Redaction Engine.
 * Enables zero-accumulation stream piping between upstream LLMs and downstream clients.
 */
export class PiiRedactionTransform extends Transform {
  public readonly engine: PiiRedactionEngine;
  private sseBuffer: string = "";

  constructor(maxLookback = 48) {
    super({ decodeStrings: true });
    this.engine = new PiiRedactionEngine(maxLookback);
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.sseBuffer += chunk.toString("utf8");

      let boundaryIndex;
      while ((boundaryIndex = this.sseBuffer.indexOf("\n\n")) !== -1) {
        const sseEvent = this.sseBuffer.slice(0, boundaryIndex);
        this.sseBuffer = this.sseBuffer.slice(boundaryIndex + 2);

        if (sseEvent.startsWith("data: ")) {
          const jsonStr = sseEvent.slice(6).trim();
          if (jsonStr === "[DONE]") {
            this.push(Buffer.from(`data: [DONE]\n\n`, "utf8"));
            continue;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed && typeof parsed.content === "string") {
              parsed.content = this.engine.processChunk(parsed.content);
              this.push(Buffer.from(`data: ${JSON.stringify(parsed)}\n\n`, "utf8"));
            } else {
              // Pass through unmodified if structure is different
              this.push(Buffer.from(`${sseEvent}\n\n`, "utf8"));
            }
          } catch {
            // If it's not valid JSON, pass it through as is
            this.push(Buffer.from(`${sseEvent}\n\n`, "utf8"));
          }
        } else {
          // Pass through non-data events
          this.push(Buffer.from(`${sseEvent}\n\n`, "utf8"));
        }
      }
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }

  _flush(callback: TransformCallback): void {
    try {
      const finalOutput = this.engine.flush();
      if (finalOutput.length > 0) {
        const payload = JSON.stringify({ content: finalOutput });
        this.push(Buffer.from(`data: ${payload}\n\n`, "utf8"));
      }
      if (this.sseBuffer.length > 0) {
        this.push(Buffer.from(this.sseBuffer, "utf8"));
      }
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }
}
