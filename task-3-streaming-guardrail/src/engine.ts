import { RedactionMetrics } from "./types.js";

/**
 * High-performance, O(1)-memory bounded streaming PII redaction engine.
 * Emits non-ambiguous content deltas immediately to maintain low TTFT,
 * while retaining a minimal sliding window buffer to catch sensitive data
 * split across arbitrary token boundaries.
 */
export class PiiRedactionEngine {
  private buffer = "";
  private readonly maxLookback: number;
  public metrics: RedactionMetrics = {
    chunksProcessed: 0,
    totalBytesIn: 0,
    totalBytesOut: 0,
    emailsRedacted: 0,
    ssnsRedacted: 0,
    creditCardsRedacted: 0,
  };

  // Target PII patterns
  public static readonly EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  public static readonly SSN_REGEX = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;
  public static readonly CC_REGEX = /\b(?:\d{4}[- ]){3}\d{1,4}\b|\b\d{13,16}\b/g;

  // Tail candidate pattern: detects potentially incomplete sensitive prefixes at chunk boundary
  public static readonly PARTIAL_TAIL_REGEX = /(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]*|[a-zA-Z0-9._%+-]+|\b\d{1,4}(?:[- ]\d{0,4}){0,3})$/;

  constructor(maxLookback = 48) {
    this.maxLookback = maxLookback;
  }

  reset(): void {
    this.buffer = "";
    this.metrics = {
      chunksProcessed: 0,
      totalBytesIn: 0,
      totalBytesOut: 0,
      emailsRedacted: 0,
      ssnsRedacted: 0,
      creditCardsRedacted: 0,
    };
  }

  private redactFullPatterns(text: string): string {
    let result = text;

    result = result.replace(PiiRedactionEngine.EMAIL_REGEX, () => {
      this.metrics.emailsRedacted++;
      return "[REDACTED]";
    });

    result = result.replace(PiiRedactionEngine.SSN_REGEX, () => {
      this.metrics.ssnsRedacted++;
      return "[REDACTED]";
    });

    result = result.replace(PiiRedactionEngine.CC_REGEX, () => {
      this.metrics.creditCardsRedacted++;
      return "[REDACTED]";
    });

    return result;
  }

  /**
   * Ingests an incoming streaming chunk delta, redacts complete sensitive patterns,
   * holds back only the ambiguous tail across chunk boundaries, and returns
   * safe-to-emit text immediately.
   */
  processChunk(chunk: string): string {
    this.metrics.chunksProcessed++;
    this.metrics.totalBytesIn += Buffer.byteLength(chunk, "utf8");

    let combined = this.buffer + chunk;

    // 1. Redact all complete PII occurrences in the active combined window
    combined = this.redactFullPatterns(combined);

    // 2. Identify if the trailing slice of text is an ambiguous PII prefix
    const match = combined.match(PiiRedactionEngine.PARTIAL_TAIL_REGEX);

    if (match && match.index !== undefined) {
      const tailLength = combined.length - match.index;

      // Only hold back if the tail is within our maximum lookback bound
      if (tailLength <= this.maxLookback) {
        const safePrefix = combined.slice(0, match.index);
        this.buffer = combined.slice(match.index);

        this.metrics.totalBytesOut += Buffer.byteLength(safePrefix, "utf8");
        return safePrefix;
      }
    }

    // No ambiguous tail found: emit the entire combined string
    this.buffer = "";
    this.metrics.totalBytesOut += Buffer.byteLength(combined, "utf8");
    return combined;
  }

  /**
   * Flushes any remaining bytes in the buffer at stream termination.
   * Conducts one final redaction pass.
   */
  flush(): string {
    const finalRedacted = this.redactFullPatterns(this.buffer);
    this.buffer = "";
    this.metrics.totalBytesOut += Buffer.byteLength(finalRedacted, "utf8");
    return finalRedacted;
  }

  getBufferSize(): number {
    return this.buffer.length;
  }
}
