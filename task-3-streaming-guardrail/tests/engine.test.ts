import { describe, it, expect, beforeEach } from "vitest";
import { PiiRedactionEngine } from "../src/engine.js";

describe("Task 3: PiiRedactionEngine Unit Tests", () => {
  let engine: PiiRedactionEngine;

  beforeEach(() => {
    engine = new PiiRedactionEngine(48);
  });

  describe("Single Chunk Full Pattern Redaction", () => {
    it("redacts standard email addresses", () => {
      const input = "Please reach out to support.team@enterprise-saas.com for assistance.";
      const output = engine.processChunk(input) + engine.flush();

      expect(output).toBe("Please reach out to [REDACTED] for assistance.");
      expect(engine.metrics.emailsRedacted).toBe(1);
    });

    it("redacts standard Social Security Numbers (XXX-XX-XXXX)", () => {
      const input = "The applicant SSN is 123-45-6789 as recorded.";
      const output = engine.processChunk(input) + engine.flush();

      expect(output).toBe("The applicant SSN is [REDACTED] as recorded.");
      expect(engine.metrics.ssnsRedacted).toBe(1);
    });

    it("redacts credit card numbers with hyphens, spaces, and raw digits", () => {
      const inputs = [
        "Card with hyphens: 4532-1234-5678-9012 in vault.",
        "Card with spaces: 4532 1234 5678 9012 in vault.",
        "Raw 16-digit card: 4532123456789012 in vault.",
      ];

      for (const str of inputs) {
        engine.reset();
        const output = engine.processChunk(str) + engine.flush();
        expect(output).toContain("[REDACTED]");
        expect(output).not.toMatch(/\b4532/);
      }
    });

    it("preserves non-sensitive text unchanged", () => {
      const cleanText = "The quarterly revenue increased by 15.4% across European markets.";
      const output = engine.processChunk(cleanText) + engine.flush();
      expect(output).toBe(cleanText);
      expect(engine.metrics.emailsRedacted).toBe(0);
      expect(engine.metrics.ssnsRedacted).toBe(0);
      expect(engine.metrics.creditCardsRedacted).toBe(0);
    });
  });

  describe("Split-Token Boundary Conditions", () => {
    it("redacts email split before @ symbol (john.doe in chunk 1, @gmail.com in chunk 2)", () => {
      const chunk1 = "Please reach out to john.doe";
      const chunk2 = "@gmail.com for assistance.";

      // Chunk 1: "Please reach out to " is emitted immediately; "john.doe" is held in buffer
      const emitted1 = engine.processChunk(chunk1);
      expect(emitted1).toBe("Please reach out to ");
      expect(engine.getBufferSize()).toBe("john.doe".length);

      // Chunk 2: combines "john.doe" + "@gmail.com for assistance." -> redacts to "[REDACTED] for "
      const emitted2 = engine.processChunk(chunk2);
      const flushed = engine.flush();

      expect(emitted1 + emitted2 + flushed).toBe("Please reach out to [REDACTED] for assistance.");
      expect(engine.metrics.emailsRedacted).toBe(1);
    });

    it("redacts email split across 2 chunks", () => {
      const chunks = ["Send an email to contact.help@", "example-corp.com when ready."];

      const emittedChunk0 = engine.processChunk(chunks[0]);
      expect(emittedChunk0).toBe("Send an email to ");
      expect(engine.getBufferSize()).toBeGreaterThan(0);

      const emittedChunk1 = engine.processChunk(chunks[1]);
      const finalFlushed = engine.flush();

      const combinedOutput = emittedChunk0 + emittedChunk1 + finalFlushed;
      expect(combinedOutput).toBe("Send an email to [REDACTED] when ready.");
      expect(engine.metrics.emailsRedacted).toBe(1);
    });

    it("redacts email split across 3 chunks", () => {
      const chunks = ["Direct inquiry to info", "@service-provider", ".org immediately."];

      let output = "";
      for (const chunk of chunks) {
        output += engine.processChunk(chunk);
      }
      output += engine.flush();

      expect(output).toBe("Direct inquiry to [REDACTED] immediately.");
      expect(engine.metrics.emailsRedacted).toBe(1);
    });

    it("redacts SSN split across 2 chunks", () => {
      const chunks = ["Beneficiary SSN: 876-54-", "3210 filed."];

      const emitted0 = engine.processChunk(chunks[0]);
      expect(emitted0).toBe("Beneficiary SSN: ");

      const emitted1 = engine.processChunk(chunks[1]);
      const flushed = engine.flush();

      expect(emitted0 + emitted1 + flushed).toBe("Beneficiary SSN: [REDACTED] filed.");
      expect(engine.metrics.ssnsRedacted).toBe(1);
    });

    it("redacts SSN split across 3 chunks", () => {
      const chunks = ["Customer SSN is 456", "-78-", "9012 recorded."];

      let output = "";
      for (const chunk of chunks) {
        output += engine.processChunk(chunk);
      }
      output += engine.flush();

      expect(output).toBe("Customer SSN is [REDACTED] recorded.");
      expect(engine.metrics.ssnsRedacted).toBe(1);
    });

    it("redacts Credit Card split across 4 chunks", () => {
      const chunks = ["Billing card: 5500-", "0000-", "1111-", "2222 expiration 05/29."];

      let output = "";
      for (const chunk of chunks) {
        output += engine.processChunk(chunk);
      }
      output += engine.flush();

      expect(output).toBe("Billing card: [REDACTED] expiration 05/29.");
      expect(engine.metrics.creditCardsRedacted).toBe(1);
    });
  });

  describe("Bounded Memory & Streaming Behavior", () => {
    it("guarantees internal buffer never exceeds maxLookback limit", () => {
      const tokens = [
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ",
        "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ",
        "Contact: admin@example.com ",
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco. ",
      ];

      for (const token of tokens) {
        engine.processChunk(token);
        expect(engine.getBufferSize()).toBeLessThanOrEqual(48);
      }
      engine.flush();
      expect(engine.getBufferSize()).toBe(0);
    });
  });
});
