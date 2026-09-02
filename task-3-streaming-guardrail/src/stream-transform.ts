import { Transform, TransformCallback } from "stream";
import { PiiRedactionEngine } from "./engine.js";

/**
 * Node.js Transform Stream implementation of the PII Redaction Engine.
 * Enables zero-accumulation stream piping between upstream LLMs and downstream clients.
 */
export class PiiRedactionTransform extends Transform {
  public readonly engine: PiiRedactionEngine;

  constructor(maxLookback = 48) {
    super({ decodeStrings: true });
    this.engine = new PiiRedactionEngine(maxLookback);
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      const textChunk = chunk.toString("utf8");
      const safeOutput = this.engine.processChunk(textChunk);

      if (safeOutput.length > 0) {
        this.push(Buffer.from(safeOutput, "utf8"));
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
        this.push(Buffer.from(finalOutput, "utf8"));
      }
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }
}
