# Task 3: LLM Gateway Streaming Guardrail (PII Redaction)

Real-time streaming PII redaction proxy gateway for LLM completion endpoints. Intercepts and sanitizes streaming token deltas in real time with an O(1) bounded memory footprint, preserving minimal Time To First Token (TTFT) and seamless split-token boundary protection.

---

## Architectural & Algorithmic Design

### The Streaming Trade-off Challenge
- **Full Document Buffering (Naive Approach)**: Accumulating the entire LLM response until the stream terminates destroys streaming UX, creates unbounded memory consumption proportional to context length, and drastically spikes TTFT.
- **Stateless Chunk Redaction (Naive Approach)**: Regex matching against isolated individual chunks fails when sensitive data is split across chunk boundaries (e.g. chunk 1 ends with `john.doe@` and chunk 2 starts with `example.com`).

### The Solution: O(1) Bounded Rolling Window State
The `PiiRedactionEngine` uses a small sliding window buffer (default 48 characters) that operates as follows:
1. **Combine Active Window**: Concatenates previous partial tail buffer with incoming chunk: `window = buffer + chunk`.
2. **Redact Complete Matches**: Scans and replaces all complete PII patterns (Emails, SSNs, Credit Cards) in `window` with `[REDACTED]`.
3. **Ambiguous Suffix Inspection**: Analyzes whether the trailing edge of `window` represents a potential partial PII prefix (e.g. trailing digits/hyphens, or email username/domain prefix).
4. **Immediate Safe Prefix Emission**:
   - Everything preceding the ambiguous tail is guaranteed safe and emitted immediately to the client.
   - Only the ambiguous suffix (at most 48 characters) is retained in `buffer` for the next chunk.
5. **Stream Termination Flush**: When the upstream closes the stream, `flush()` performs a final pass on the remaining buffer and flushes out the final tokens.

This architecture guarantees:
- **Zero Full-Response Memory Accumulation**: Memory consumption is strictly bounded at `O(1)` regardless of whether the LLM generates 100 tokens or 100,000 tokens.
- **Minimal TTFT**: First tokens stream to the client in milliseconds without waiting for the full response.
- **Robust Boundary Redaction**: Detects PII split across 2, 3, or more arbitrary token chunks.

### Token Boundary Handling (e.g. Pre-@ Email Splits)
Tokenizers frequently segment email addresses across token boundaries, often cutting before the `@` symbol:
- **Chunk 1**: `"Please forward the report to john.doe"` (ends with username, without `@`).
- **Chunk 2**: `"@gmail.com for security audit approval."`

A stateless regex running on Chunk 1 sees no `@` and would emit `"john.doe"` in plaintext. When Chunk 2 arrives, it sees only `"@gmail.com"`, failing to capture the full email.

**How our sliding window handles this**:
1. When Chunk 1 arrives, `PARTIAL_TAIL_REGEX` identifies `"john.doe"` as a potential email local-part candidate.
2. The preceding text (`"Please forward the report to "`) is verified as safe and emitted immediately to preserve low TTFT.
3. The 8 bytes of `"john.doe"` remain in the sliding buffer.
4. When Chunk 2 arrives, it combines into `"john.doe@gmail.com"`, triggers pattern redaction to `"[REDACTED]"`, and safely emits `"[REDACTED] for security audit approval."`.

---

## Target Sensitive Patterns

| PII Category | Pattern Description | Detection Regular Expression |
|---|---|---|
| **Email Addresses** | Standard user@domain.tld formats | `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}` |
| **Social Security Numbers** | 9-digit US SSN with standard hyphen/space separators | `\b\d{3}[- ]\d{2}[- ]\d{4}\b` |
| **Credit Card Numbers** | 13 to 16 digit card formats with hyphens, spaces, or raw digits | `\b(?:\d{4}[- ]){3}\d{1,4}\b\|\b\d{13,16}\b` |

---

## Directory Structure

```
task-3-streaming-guardrail/
├── src/
│   ├── types.ts            # Metric interfaces and gateway options
│   ├── engine.ts           # Core O(1) sliding window PII redaction engine
│   ├── stream-transform.ts # Node.js Transform stream wrapper
│   ├── mock-upstream.ts    # Upstream streaming server simulating split tokens
│   ├── gateway.ts          # HTTP streaming reverse proxy service
│   └── index.ts            # Standalone launcher for mock upstream and gateway
├── tests/
│   ├── engine.test.ts            # Unit tests for split boundaries and pattern detection
│   └── streaming-gateway.test.ts # End-to-end HTTP streaming tests verifying TTFT
├── demo.ts                 # Live interactive client showing chunk-by-chunk arrival
└── README.md
```

---

## Running the Server & Tests

### Interactive Live Demonstration
Run the live demonstration showing progressive chunk arrival, split token redaction, and TTFT metrics:
```bash
npm run demo:task3
```

### Running Automated Tests
Run all Task 3 unit and integration tests:
```bash
npm run test:task3
```

Run with verbose step-by-step reporting:
```bash
npx vitest run task-3-streaming-guardrail/tests --reporter=verbose
```

### Direct Standalone Execution
Start both the mock upstream LLM provider (port 8201) and the streaming guardrail gateway (port 8200):
```bash
npx tsx task-3-streaming-guardrail/src/index.ts
```

### Sample curl Streaming Request
In a separate terminal, stream a completion request through the gateway:
```bash
curl -N -X POST http://127.0.0.1:8200 \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Summarize customer profile with sensitive fields"}'
```
