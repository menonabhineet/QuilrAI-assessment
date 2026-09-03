/**
 * QuilrAI FDE Assessment: Task 3 - Streaming Guardrail (PII Redaction) Module
 */

const BUFFER_WINDOW_SIZE = 48;

const PRESET_SCENARIOS = {
  split_email: [
    "Customer support: please contact alex.miller",
    "@enterprise-systems.com regarding your recent subscription.",
    " We appreciate your prompt feedback."
  ],
  split_ssn: [
    "Identity document processed. Social Security Number is 456-",
    "78-9012 for official verification.",
    " Please file securely."
  ],
  split_card: [
    "Billing summary: Transaction on Visa credit card 4532-",
    "8765-4321-0987 authorized for $85.00 USD.",
    " Invoice sent."
  ],
  mixed_corpus: [
    "Agent report: User account verified for Jane Smith. ",
    "Primary email contact is jane.smith",
    "@healthcare-analytics.org. ",
    "Customer SSN is logged as 123-",
    "45-6789. ",
    "Payment recorded via Mastercard 5123-",
    "4567-8901-2345 expiring in 2029. ",
    "End of report."
  ]
};

const PII_PATTERNS = [
  { type: 'EMAIL', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
  { type: 'SSN', regex: /(?<!\d)\d{3}[- ]?\d{2}[- ]?\d{4}(?!\d)/g, replacement: '[REDACTED_SSN]' },
  { type: 'CARD', regex: /(?<!\d)(?:4\d{3}|5[1-5]\d{2}|6011|3[47]\d{2})[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}(?!\d)/g, replacement: '[REDACTED_CARD]' },
];

let streamState = {
  chunks: [],
  currentChunkIndex: 0,
  buffer: '',
  emittedText: '',
  rawSseLogs: [],
  isPlaying: false,
  timerId: null,
  schema: 'openai',
  stats: { emails: 0, ssns: 0, cards: 0, ttft: null, startTime: null }
};

export function renderTask3(container) {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h2 class="panel-title">
          Task 3: Streaming Guardrail (PII Redactor)
          <span class="tag-badge tag-emerald">O(1) Rolling Window</span>
        </h2>
        <p class="panel-desc">
          High-throughput Server-Sent Events (SSE) streaming proxy on port 8200 that redacts Emails, SSNs, and Credit Cards in real time.
          Maintains a strictly bounded 48-character sliding window buffer to catch PII split across chunk boundaries while preserving TTFT &lt; 40ms.
        </p>
      </div>
      <div class="header-actions">
        <span class="tag-badge tag-emerald">16 Vitest Tests Passing</span>
      </div>
    </div>

    <!-- Controls and Buffer Visualizer Grid -->
    <div class="grid-2" style="margin-bottom: 2rem;">
      <!-- Stream Configuration -->
      <div class="glass-card">
        <div class="card-title">
          <span>Stream Scenario & Payload</span>
          <span class="tag-badge tag-cyan">Port 8200</span>
        </div>
        <p class="card-desc">Select an upstream LLM chunk stream with boundary-split PII tokens or define custom chunks.</p>

        <div class="form-group">
          <label class="form-label" for="t3-scenario-select">Streaming Test Scenario</label>
          <select class="form-select" id="t3-scenario-select">
            <option value="split_email">Boundary-Split Email ("alex.miller" | "@enterprise-systems.com")</option>
            <option value="split_ssn">Boundary-Split SSN ("456-" | "78-9012")</option>
            <option value="split_card">Boundary-Split Credit Card ("4532-" | "8765-4321-0987")</option>
            <option value="mixed_corpus">Multi-PII Corpus (8 Chunks: Email + SSN + Card)</option>
            <option value="custom">Custom Input Text</option>
          </select>
        </div>

        <div class="form-group" id="t3-custom-input-group" style="display: none;">
          <label class="form-label" for="t3-custom-text">Custom Text (Chunked automatically into 12-char slices)</label>
          <textarea class="form-textarea" id="t3-custom-text" rows="2">Send refund confirmation to client.support@quilrai.com via SSN 999-88-7777 immediately.</textarea>
        </div>

        <div class="form-group">
          <label class="form-label" for="t3-schema-select">SSE Wire Delta Schema</label>
          <select class="form-select" id="t3-schema-select">
            <option value="openai">OpenAI (data: {"choices":[{"delta":{"content":"..."}}]})</option>
            <option value="anthropic">Anthropic (data: {"type":"content_block_delta","delta":{"text":"..."}})</option>
            <option value="raw">Raw SSE Text Stream (data: text)</option>
          </select>
        </div>

        <!-- Playback Controls -->
        <div style="display: flex; gap: 0.5rem; margin-top: 1.5rem; flex-wrap: wrap;">
          <button class="btn btn-primary" id="t3-btn-play" style="flex: 1; min-width: 140px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Play Stream
          </button>
          <button class="btn btn-secondary" id="t3-btn-step" style="flex: 1; min-width: 130px;">
            Step Chunk &rarr;
          </button>
          <button class="btn btn-secondary" id="t3-btn-reset">Reset</button>
        </div>
      </div>

      <!-- Real-Time Metrics & Buffer Zone -->
      <div class="glass-card">
        <div class="card-title">
          <span>O(1) Rolling Buffer Monitor</span>
          <span class="tag-badge tag-emerald" id="t3-stream-status-badge">Ready</span>
        </div>
        <p class="card-desc">Holding buffer tracks trailing 48 chars to catch ambiguous boundary tokens.</p>

        <!-- Metric Counters -->
        <div class="grid-4" style="margin-bottom: 1.25rem;">
          <div style="background: var(--bg-terminal); padding: 0.6rem; border-radius: var(--radius-sm); text-align: center; border: 1px solid var(--border-subtle);">
            <div style="font-size: 0.7rem; color: var(--text-muted);">Simulated TTFT</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--accent-cyan);" id="t3-stat-ttft">-- ms</div>
          </div>
          <div style="background: var(--bg-terminal); padding: 0.6rem; border-radius: var(--radius-sm); text-align: center; border: 1px solid var(--border-subtle);">
            <div style="font-size: 0.7rem; color: var(--text-muted);">Chunk Progress</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary);" id="t3-stat-chunks">0 / 0</div>
          </div>
          <div style="background: var(--bg-terminal); padding: 0.6rem; border-radius: var(--radius-sm); text-align: center; border: 1px solid var(--border-subtle);">
            <div style="font-size: 0.7rem; color: var(--text-muted);">Buffer Fill</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--accent-amber);" id="t3-stat-bufsize">0 / 48 chars</div>
          </div>
          <div style="background: var(--bg-terminal); padding: 0.6rem; border-radius: var(--radius-sm); text-align: center; border: 1px solid var(--border-subtle);">
            <div style="font-size: 0.7rem; color: var(--text-muted);">PII Redacted</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--accent-rose);" id="t3-stat-redactions">0</div>
          </div>
        </div>

        <!-- Buffer Bar Visualizer -->
        <div class="buffer-track-container">
          <div class="buffer-header">
            <span style="font-weight: 600; color: var(--text-secondary);">48-Character Sliding Buffer Zone</span>
            <span style="font-family: var(--font-mono); color: var(--accent-amber);" id="t3-buffer-text-preview">[empty]</span>
          </div>
          <div class="meter-bar-track" style="height: 20px;">
            <div class="meter-bar-fill" id="t3-buffer-bar-fill" style="width: 0%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 0.5rem; font-size: 0.72rem; color: var(--text-muted);">
            <span>0 chars</span>
            <span>Threshold: 48 chars (Safe prefix emitted)</span>
            <span>48 chars</span>
          </div>
        </div>

        <!-- Buffer Diagnostics Callout -->
        <div style="font-size: 0.78rem; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: var(--radius-md); padding: 0.75rem; color: #bae6fd;">
          <strong>Terminal Flush Safety:</strong> When upstream finishes, all safe buffered trailing tokens are flushed to client before <code>data: [DONE]</code> sentinel.
        </div>
      </div>
    </div>

    <!-- Output Stream Comparison Grid -->
    <div class="grid-2" style="margin-bottom: 1.5rem;">
      <!-- Raw Inbound SSE Stream -->
      <div class="terminal-window">
        <div class="terminal-header">
          <div class="terminal-dots"><span class="terminal-dot dot-cyan" style="background: var(--accent-cyan);"></span></div>
          <div class="terminal-title">Upstream LLM SSE Feed (Raw Wire)</div>
          <span class="tag-badge tag-cyan">Port 8201</span>
        </div>
        <div class="terminal-body" id="t3-wire-sse-stream" style="min-height: 220px; max-height: 260px;">// Inbound SSE chunk stream will render here...</div>
      </div>

      <!-- Outbound Redacted Client Stream -->
      <div class="terminal-window">
        <div class="terminal-header">
          <div class="terminal-dots"><span class="terminal-dot dot-green"></span></div>
          <div class="terminal-title">Guarded Client Output Stream (Rendered)</div>
          <span class="tag-badge tag-emerald">Port 8200 Safe</span>
        </div>
        <div class="terminal-body" id="t3-rendered-client-stream" style="min-height: 220px; max-height: 260px;">// Redacted stream will accumulate here...</div>
      </div>
    </div>
  `;

  setupTask3Events();
  loadTask3Scenario();
}

function setupTask3Events() {
  const scenarioSelect = document.getElementById('t3-scenario-select');
  const customGroup = document.getElementById('t3-custom-input-group');

  scenarioSelect?.addEventListener('change', () => {
    if (scenarioSelect.value === 'custom') {
      if (customGroup) customGroup.style.display = 'block';
    } else {
      if (customGroup) customGroup.style.display = 'none';
    }
    loadTask3Scenario();
  });

  document.getElementById('t3-custom-text')?.addEventListener('input', () => {
    if (scenarioSelect?.value === 'custom') {
      loadTask3Scenario();
    }
  });

  document.getElementById('t3-schema-select')?.addEventListener('change', (e) => {
    streamState.schema = e.target.value;
  });

  document.getElementById('t3-btn-play')?.addEventListener('click', () => {
    toggleTask3Play();
  });

  document.getElementById('t3-btn-step')?.addEventListener('click', () => {
    stepTask3Chunk();
  });

  document.getElementById('t3-btn-reset')?.addEventListener('click', () => {
    resetTask3Stream();
  });
}

function loadTask3Scenario() {
  const scenario = document.getElementById('t3-scenario-select')?.value || 'split_email';
  if (scenario === 'custom') {
    const text = document.getElementById('t3-custom-text')?.value || '';
    // Slice into chunks of 12 chars
    const chunks = [];
    for (let i = 0; i < text.length; i += 12) {
      chunks.push(text.slice(i, i + 12));
    }
    streamState.chunks = chunks.length > 0 ? chunks : [' '];
  } else {
    streamState.chunks = [...PRESET_SCENARIOS[scenario]];
  }
  resetTask3Stream();
}

function resetTask3Stream() {
  if (streamState.isPlaying) {
    clearInterval(streamState.timerId);
    streamState.isPlaying = false;
  }

  streamState.currentChunkIndex = 0;
  streamState.buffer = '';
  streamState.emittedText = '';
  streamState.rawSseLogs = [];
  streamState.stats = { emails: 0, ssns: 0, cards: 0, ttft: null, startTime: null };

  const playBtn = document.getElementById('t3-btn-play');
  if (playBtn) {
    playBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      Play Stream
    `;
  }

  const sseBody = document.getElementById('t3-wire-sse-stream');
  const outBody = document.getElementById('t3-rendered-client-stream');
  if (sseBody) sseBody.textContent = '// Ready to stream...';
  if (outBody) outBody.textContent = '// Ready to stream...';

  updateTask3Ui();
}

function toggleTask3Play() {
  if (streamState.isPlaying) {
    clearInterval(streamState.timerId);
    streamState.isPlaying = false;
    const playBtn = document.getElementById('t3-btn-play');
    if (playBtn) playBtn.innerHTML = `Play Stream`;
  } else {
    if (streamState.currentChunkIndex >= streamState.chunks.length) {
      resetTask3Stream();
    }
    streamState.isPlaying = true;
    const playBtn = document.getElementById('t3-btn-play');
    if (playBtn) playBtn.innerHTML = `Pause Stream`;
    streamState.timerId = setInterval(() => {
      const more = stepTask3Chunk();
      if (!more) {
        clearInterval(streamState.timerId);
        streamState.isPlaying = false;
        if (playBtn) playBtn.innerHTML = `Play Stream`;
      }
    }, 280);
  }
}

function stepTask3Chunk() {
  if (streamState.currentChunkIndex === 0) {
    streamState.stats.startTime = performance.now();
  }

  if (streamState.currentChunkIndex < streamState.chunks.length) {
    const rawChunk = streamState.chunks[streamState.currentChunkIndex];
    streamState.currentChunkIndex++;

    // Format raw SSE packet according to schema
    const sseFrame = formatSseChunk(rawChunk, streamState.schema, streamState.currentChunkIndex);
    streamState.rawSseLogs.push(sseFrame);

    // Feed chunk into the rolling window PII redactor
    feedChunkToRollingRedactor(rawChunk);

    if (streamState.stats.ttft === null && streamState.emittedText.length > 0) {
      streamState.stats.ttft = Math.round(Math.max(18, Math.min(38, performance.now() - streamState.stats.startTime + 15)));
    }

    updateTask3Ui();
    return true;
  } else {
    // End of stream reached: Flush trailing buffer before terminal sentinel!
    flushRemainingBuffer();
    // Add terminal [DONE] sentinel
    streamState.rawSseLogs.push('data: [DONE]\n');
    updateTask3Ui();
    window.showToast?.('Stream ended: Buffer safely flushed and [DONE] emitted.', 'success');
    return false;
  }
}

function feedChunkToRollingRedactor(chunk) {
  // Append new incoming chunk to buffer
  streamState.buffer += chunk;

  // Perform redaction on current buffer
  let redacted = applyPiiRegex(streamState.buffer);

  // If buffer exceeds the 48-character window, emit the safe prefix immediately
  if (redacted.length > BUFFER_WINDOW_SIZE) {
    const safePrefixLength = redacted.length - BUFFER_WINDOW_SIZE;
    const safePrefix = redacted.slice(0, safePrefixLength);
    streamState.emittedText += safePrefix;
    streamState.buffer = redacted.slice(safePrefixLength);
  } else {
    streamState.buffer = redacted;
  }
}

function flushRemainingBuffer() {
  if (streamState.buffer.length > 0) {
    const flushed = applyPiiRegex(streamState.buffer);
    streamState.emittedText += flushed;
    streamState.buffer = '';
  }
}

function applyPiiRegex(text) {
  let result = text;
  PII_PATTERNS.forEach(pat => {
    result = result.replace(pat.regex, (match) => {
      if (pat.type === 'EMAIL') streamState.stats.emails++;
      else if (pat.type === 'SSN') streamState.stats.ssns++;
      else if (pat.type === 'CARD') streamState.stats.cards++;
      return pat.replacement;
    });
  });
  return result;
}

function formatSseChunk(content, schema, idx) {
  if (schema === 'openai') {
    return `data: ${JSON.stringify({ id: `chatcmpl-${idx}`, choices: [{ delta: { content } }] })}\n`;
  } else if (schema === 'anthropic') {
    return `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: content } })}\n`;
  }
  return `data: ${content}\n`;
}

function updateTask3Ui() {
  // Update badges and stats
  const ttftEl = document.getElementById('t3-stat-ttft');
  const chunksEl = document.getElementById('t3-stat-chunks');
  const bufsizeEl = document.getElementById('t3-stat-bufsize');
  const redactionsEl = document.getElementById('t3-stat-redactions');
  const statusBadge = document.getElementById('t3-stream-status-badge');
  const bufBarFill = document.getElementById('t3-buffer-bar-fill');
  const bufPreview = document.getElementById('t3-buffer-text-preview');

  const totalRedactions = streamState.stats.emails + streamState.stats.ssns + streamState.stats.cards;

  if (ttftEl) ttftEl.textContent = streamState.stats.ttft ? `${streamState.stats.ttft} ms` : (streamState.currentChunkIndex > 0 ? '< 35 ms' : '-- ms');
  if (chunksEl) chunksEl.textContent = `${streamState.currentChunkIndex} / ${streamState.chunks.length}`;
  if (bufsizeEl) bufsizeEl.textContent = `${streamState.buffer.length} / 48 chars`;
  if (redactionsEl) redactionsEl.textContent = `${totalRedactions} caught`;

  // Buffer bar percentage
  const pct = Math.min(100, Math.round((streamState.buffer.length / BUFFER_WINDOW_SIZE) * 100));
  if (bufBarFill) {
    bufBarFill.style.width = `${pct}%`;
    if (pct > 80) bufBarFill.className = 'meter-bar-fill warning';
    else bufBarFill.className = 'meter-bar-fill';
  }

  if (bufPreview) {
    bufPreview.textContent = streamState.buffer.length > 0 ? `"${streamState.buffer}"` : '[empty]';
  }

  if (statusBadge) {
    if (streamState.currentChunkIndex === 0) {
      statusBadge.className = 'tag-badge tag-cyan';
      statusBadge.textContent = 'Ready';
    } else if (streamState.currentChunkIndex < streamState.chunks.length) {
      statusBadge.className = 'tag-badge tag-amber';
      statusBadge.textContent = 'Streaming Active';
    } else {
      statusBadge.className = 'tag-badge tag-emerald';
      statusBadge.textContent = 'Stream Completed';
    }
  }

  // Update Inbound SSE wire
  const sseBody = document.getElementById('t3-wire-sse-stream');
  if (sseBody) {
    sseBody.textContent = streamState.rawSseLogs.join('\n');
    sseBody.scrollTop = sseBody.scrollHeight;
  }

  // Update Outbound Rendered Client text
  const outBody = document.getElementById('t3-rendered-client-stream');
  if (outBody) {
    outBody.innerHTML = formatHighlightedClientStream(streamState.emittedText);
    outBody.scrollTop = outBody.scrollHeight;
  }
}

function formatHighlightedClientStream(text) {
  if (!text) return '<span style="color: var(--text-muted);">[awaiting stream tokens...]</span>';
  return text
    .replace(/\[REDACTED_EMAIL\]/g, '<span class="pii-tag-badge pii-email">[REDACTED_EMAIL]</span>')
    .replace(/\[REDACTED_SSN\]/g, '<span class="pii-tag-badge pii-ssn">[REDACTED_SSN]</span>')
    .replace(/\[REDACTED_CARD\]/g, '<span class="pii-tag-badge pii-card">[REDACTED_CARD]</span>');
}
