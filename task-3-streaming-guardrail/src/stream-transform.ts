import { Transform, TransformCallback } from "stream";
import { PiiRedactionEngine } from "./engine.js";

/**
 * Node.js Transform Stream implementation of the PII Redaction Engine.
 * Enables zero-accumulation stream piping between upstream LLMs and downstream clients.
 */
export class PiiRedactionTransform extends Transform {
  public readonly engine: PiiRedactionEngine;
  private sseBuffer: string = "";
  private lastSchema: "content" | "openai" | "anthropic" | "unknown" = "unknown";
  private doneEmitted: boolean = false;

  constructor(maxLookback = 48) {
    super({ decodeStrings: true });
    this.engine = new PiiRedactionEngine(maxLookback);
  }

  private formatFlushDelta(text: string): string {
    if (this.lastSchema === "openai") {
      return JSON.stringify({
        choices: [{ delta: { content: text }, index: 0, finish_reason: null }],
      });
    }
    if (this.lastSchema === "anthropic") {
      return JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text },
      });
    }
    return JSON.stringify({ content: text });
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

          // Terminal sentinel handling: flush unredacted trailing buffer BEFORE emitting [DONE]
          if (jsonStr === "[DONE]") {
            const finalOutput = this.engine.flush();
            if (finalOutput.length > 0) {
              const payload = this.formatFlushDelta(finalOutput);
              this.push(Buffer.from(`data: ${payload}\n\n`, "utf8"));
            }
            this.doneEmitted = true;
            this.push(Buffer.from(`data: [DONE]\n\n`, "utf8"));
            continue;
          }

          try {
            const parsed = JSON.parse(jsonStr);

            // 1. Proprietary / simple schema: { content: string }
            if (parsed && typeof parsed.content === "string") {
              this.lastSchema = "content";
              parsed.content = this.engine.processChunk(parsed.content);
              this.push(Buffer.from(`data: ${JSON.stringify(parsed)}\n\n`, "utf8"));
              continue;
            }

            // 2. Standard OpenAI streaming schema: choices[0].delta.content
            if (
              parsed &&
              Array.isArray(parsed.choices) &&
              parsed.choices.length > 0 &&
              parsed.choices[0]?.delta &&
              typeof parsed.choices[0].delta.content === "string"
            ) {
              this.lastSchema = "openai";
              parsed.choices[0].delta.content = this.engine.processChunk(
                parsed.choices[0].delta.content
              );
              this.push(Buffer.from(`data: ${JSON.stringify(parsed)}\n\n`, "utf8"));
              continue;
            }

            // 3. Anthropic streaming delta schema: delta.text
            if (parsed && parsed.delta && typeof parsed.delta.text === "string") {
              this.lastSchema = "anthropic";
              parsed.delta.text = this.engine.processChunk(parsed.delta.text);
              this.push(Buffer.from(`data: ${JSON.stringify(parsed)}\n\n`, "utf8"));
              continue;
            }

            // Pass through any unrecognized JSON structures unmodified
            this.push(Buffer.from(`${sseEvent}\n\n`, "utf8"));
          } catch {
            // Non-JSON SSE data: pass through as-is
            this.push(Buffer.from(`${sseEvent}\n\n`, "utf8"));
          }
        } else {
          // Pass through non-data SSE events (e.g. comments, event types)
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
      // If [DONE] sentinel was not received, flush any remaining buffer now
      if (!this.doneEmitted) {
        const finalOutput = this.engine.flush();
        if (finalOutput.length > 0) {
          const payload = this.formatFlushDelta(finalOutput);
          this.push(Buffer.from(`data: ${payload}\n\n`, "utf8"));
        }
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
