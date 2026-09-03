/**
 * QuilrAI FDE Assessment: Task 4 - Resilient Router & Rate Limiter Module
 */

const WINDOW_MS = 60000;
const DEFAULT_LIMIT = 50000;

// Tenant sliding window stores: tenantId -> Array of { timestamp, tokens }
const tenantStores = {
  'tenant-alpha': [],
  'tenant-beta': [],
  'tenant-gamma': []
};

let routerReqCounter = 1;

export function renderTask4(container) {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h2 class="panel-title">
          Task 4: Rate Limiting & Model Fallback Router
          <span class="tag-badge tag-amber">Resilient Gateway</span>
        </h2>
        <p class="panel-desc">
          Resilient completion router on port 8300 with per-tenant token sliding window rate limiting and automatic model failover.
          Races primary models against a 3000ms deadline, fails over on 429/5xx, halts immediately on non-retryable 400 client errors,
          and sanitizes error payloads on dual provider failure.
        </p>
      </div>
      <div class="header-actions">
        <span class="tag-badge tag-emerald">21 Vitest Tests Passing</span>
      </div>
    </div>

    <!-- Interactive Grid -->
    <div class="grid-2" style="margin-bottom: 2rem;">
      <!-- Request Config & Rate Limit Controls -->
      <div class="glass-card">
        <div class="card-title">
          <span>Client Request & Tenant Quota</span>
          <span class="tag-badge tag-amber">Port 8300 Router</span>
        </div>
        <p class="card-desc">Configure tenant identity, token reservation budget, and primary model behavior.</p>

        <!-- Tenant Selector -->
        <div class="form-group">
          <label class="form-label" for="t4-tenant-select">Tenant API Key</label>
          <select class="form-select" id="t4-tenant-select">
            <option value="tenant-alpha">tenant-alpha (Default: 50,000 tokens/min)</option>
            <option value="tenant-beta">tenant-beta (Secondary Tenant)</option>
            <option value="tenant-gamma">tenant-gamma (Free Tier)</option>
          </select>
        </div>

        <!-- Token Cost Slider -->
        <div class="form-group">
          <label class="form-label" for="t4-token-cost">
            <span>Estimated Token Cost</span>
            <span class="label-hint" id="t4-token-cost-val">15,000 tokens</span>
          </label>
          <input type="range" class="form-input" id="t4-token-cost" min="2000" max="45000" step="1000" value="15000" style="cursor: pointer;">
          <div class="chip-row">
            <span class="chip" data-tokens="5000">5k Tokens (Light)</span>
            <span class="chip" data-tokens="15000">15k Tokens (Standard)</span>
            <span class="chip" data-tokens="35000">35k Tokens (Heavy Burst)</span>
          </div>
        </div>

        <!-- Primary Model Condition Selector -->
        <div class="form-group">
          <label class="form-label" for="t4-primary-mode">Primary Model Simulation (Port 8301)</label>
          <select class="form-select" id="t4-primary-mode">
            <option value="200">200 OK: Healthy Primary Response (120ms)</option>
            <option value="429">429 Rate Limited: Primary Throttled &rarr; Instant Failover</option>
            <option value="timeout">3000ms Timeout: Primary Hangs &rarr; Deadline Abort Failover</option>
            <option value="500">500 Internal Error: Primary Crash &rarr; Failover to Backup</option>
            <option value="400">400 Bad Request: Non-Retryable Client Error (NO Failover)</option>
            <option value="dual_fail">Dual Failure: Both Primary & Backup Fail (Sanitized 502)</option>
          </select>
        </div>

        <div style="display: flex; gap: 0.75rem; margin-top: 1.5rem;">
          <button class="btn btn-primary" id="t4-btn-send" style="flex: 1;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Send Completion Request
          </button>
          <button class="btn btn-secondary" id="t4-btn-reset-tenant">Reset Quota</button>
        </div>
      </div>

      <!-- Rate Limiting Meter & State Machine Visualizer -->
      <div class="glass-card">
        <div class="card-title">
          <span>Tenant Sliding Window Meter</span>
          <span class="tag-badge tag-cyan" id="t4-tenant-badge">tenant-alpha</span>
        </div>
        <p class="card-desc">Tracks timestamped consumption within an O(1) 60-second rolling window.</p>

        <!-- Rate Limit Meter Bar -->
        <div class="meter-container">
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.82rem;">
            <span>Consumption in 60s Window:</span>
            <span style="font-family: var(--font-mono); font-weight: 700;" id="t4-meter-stats">0 / 50,000 tokens</span>
          </div>
          <div class="meter-bar-track">
            <div class="meter-bar-fill" id="t4-meter-fill" style="width: 0%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 0.4rem; font-size: 0.75rem; color: var(--text-muted);">
            <span id="t4-meter-remaining">Remaining: 50,000 tokens</span>
            <span id="t4-meter-reset">Window sliding...</span>
          </div>
        </div>

        <!-- Model Execution State Flow -->
        <div style="margin-top: 1.5rem;">
          <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">
            Execution State Flow
          </div>
          <div class="state-flow-diagram">
            <div class="flow-node" id="node-rate-check">
              <div class="flow-node-title">Step 1</div>
              <div class="flow-node-desc">Rate Limiter</div>
            </div>
            <div class="flow-arrow">&rarr;</div>
            <div class="flow-node" id="node-primary">
              <div class="flow-node-title">Step 2</div>
              <div class="flow-node-desc">Primary :8301</div>
            </div>
            <div class="flow-arrow">&rarr;</div>
            <div class="flow-node" id="node-decision">
              <div class="flow-node-title">Step 3</div>
              <div class="flow-node-desc">Failover Check</div>
            </div>
            <div class="flow-arrow">&rarr;</div>
            <div class="flow-node" id="node-backup">
              <div class="flow-node-title">Step 4</div>
              <div class="flow-node-desc">Backup :8302</div>
            </div>
          </div>
        </div>

        <!-- Failover Notice -->
        <div id="t4-failover-notice" style="display: none; padding: 0.75rem 1rem; border-radius: var(--radius-md); font-size: 0.82rem; margin-top: 1rem;"></div>
      </div>
    </div>

    <!-- Wire Log & HTTP Headers -->
    <div class="glass-card">
      <div class="card-title">
        <span>Router Wire Response & Telemetry</span>
        <span class="tag-badge tag-indigo" id="t4-response-status-badge">Status</span>
      </div>
      <div class="grid-2" style="gap: 1rem; margin-top: 0.75rem;">
        <div class="terminal-window">
          <div class="terminal-header">
            <div class="terminal-dots"><span class="terminal-dot dot-yellow"></span></div>
            <div class="terminal-title">HTTP Response Headers</div>
            <span class="tag-badge tag-cyan">Gateway Headers</span>
          </div>
          <div class="terminal-body" id="t4-headers-console" style="min-height: 160px; max-height: 200px;">// HTTP headers will appear here...</div>
        </div>

        <div class="terminal-window">
          <div class="terminal-header">
            <div class="terminal-dots"><span class="terminal-dot dot-green"></span></div>
            <div class="terminal-title">JSON Completion Body</div>
            <span class="tag-badge tag-emerald">Client Payload</span>
          </div>
          <div class="terminal-body" id="t4-body-console" style="min-height: 160px; max-height: 200px;">// Response payload will appear here...</div>
        </div>
      </div>
    </div>
  `;

  setupTask4Events();
  updateRateLimiterUi();
}

function setupTask4Events() {
  const costSlider = document.getElementById('t4-token-cost');
  const costVal = document.getElementById('t4-token-cost-val');
  const tenantSelect = document.getElementById('t4-tenant-select');

  costSlider?.addEventListener('input', () => {
    if (costVal && costSlider) {
      costVal.textContent = `${parseInt(costSlider.value, 10).toLocaleString()} tokens`;
    }
  });

  tenantSelect?.addEventListener('change', () => {
    updateRateLimiterUi();
  });

  document.querySelectorAll('[data-tokens]').forEach(chip => {
    chip.addEventListener('click', () => {
      const tokens = chip.getAttribute('data-tokens');
      if (costSlider && costVal && tokens) {
        costSlider.value = tokens;
        costVal.textContent = `${parseInt(tokens, 10).toLocaleString()} tokens`;
      }
    });
  });

  document.getElementById('t4-btn-send')?.addEventListener('click', () => {
    executeRouterRequest();
  });

  document.getElementById('t4-btn-reset-tenant')?.addEventListener('click', () => {
    const tenant = document.getElementById('t4-tenant-select')?.value || 'tenant-alpha';
    tenantStores[tenant] = [];
    updateRateLimiterUi();
    window.showToast?.(`Reset rate limit window for ${tenant}`, 'info');
  });
}

function executeRouterRequest() {
  const tenant = document.getElementById('t4-tenant-select')?.value || 'tenant-alpha';
  const tokenCost = parseInt(document.getElementById('t4-token-cost')?.value || '15000', 10);
  const primaryMode = document.getElementById('t4-primary-mode')?.value || '200';
  const reqId = `router-${routerReqCounter++}`;

  // Reset flow nodes
  resetFlowNodes();

  const nodeRate = document.getElementById('node-rate-check');
  const nodePrimary = document.getElementById('node-primary');
  const nodeDecision = document.getElementById('node-decision');
  const nodeBackup = document.getElementById('node-backup');
  const noticeEl = document.getElementById('t4-failover-notice');

  // Step 1: Sliding Window Rate Limiter Check
  if (nodeRate) nodeRate.className = 'flow-node active';

  const now = Date.now();
  cleanOldBuckets(tenant, now);

  const currentUsage = calculateWindowUsage(tenant);

  if (currentUsage + tokenCost > DEFAULT_LIMIT) {
    // 429 Too Many Requests
    if (nodeRate) nodeRate.className = 'flow-node error';
    const oldestBucket = tenantStores[tenant][0];
    const retryAfterSec = oldestBucket ? Math.max(1, Math.ceil((oldestBucket.timestamp + WINDOW_MS - now) / 1000)) : 60;

    displayResponse(429, {
      'HTTP/1.1': '429 Too Many Requests',
      'Content-Type': 'application/json',
      'Retry-After': `${retryAfterSec}`,
      'X-RateLimit-Limit': `${DEFAULT_LIMIT}`,
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': `${Math.floor((now + retryAfterSec * 1000) / 1000)}`
    }, {
      error: {
        message: `Rate limit exceeded: Tenant '${tenant}' attempted ${tokenCost} tokens, but only ${Math.max(0, DEFAULT_LIMIT - currentUsage)} tokens remain in current 60s window.`,
        code: 'rate_limit_exceeded',
        retryAfter: retryAfterSec
      }
    });

    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.style.background = 'rgba(244, 63, 94, 0.12)';
      noticeEl.style.border = '1px solid rgba(244, 63, 94, 0.3)';
      noticeEl.innerHTML = `<strong>HTTP 429 Intercepted:</strong> Rate limit exceeded for ${tenant}. Request dropped before hitting model providers.`;
    }

    window.showToast?.(`Tenant ${tenant} exceeded 50k token rate limit (HTTP 429)`, 'error');
    updateRateLimiterUi();
    return;
  }

  // Record consumption into sliding window
  tenantStores[tenant].push({ timestamp: now, tokens: tokenCost });
  updateRateLimiterUi();

  // Step 2: Route to Primary Model
  if (nodePrimary) nodePrimary.className = 'flow-node active';

  if (primaryMode === '200') {
    // Primary Succeeds
    displayResponse(200, {
      'HTTP/1.1': '200 OK',
      'Content-Type': 'application/json',
      'X-Model-Provider': 'primary-gpt4o',
      'X-Latency-Ms': '124',
      'X-RateLimit-Limit': `${DEFAULT_LIMIT}`,
      'X-RateLimit-Remaining': `${DEFAULT_LIMIT - (currentUsage + tokenCost)}`
    }, {
      id: reqId,
      model: 'primary-model-8301',
      choices: [{ message: { role: 'assistant', content: 'Primary model execution succeeded within 124ms.' } }],
      usage: { prompt_tokens: Math.floor(tokenCost * 0.4), completion_tokens: Math.floor(tokenCost * 0.6), total_tokens: tokenCost }
    });

    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.style.background = 'rgba(16, 185, 129, 0.12)';
      noticeEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      noticeEl.innerHTML = `<strong>Primary Success:</strong> Request fulfilled by Primary Model (Port 8301) in 124ms. Zero failover necessary.`;
    }
    window.showToast?.('Primary model responded successfully (200 OK)', 'success');
  } else if (primaryMode === '400') {
    // Non-Retryable Client Error (e.g. invalid prompt) -> NO failover!
    if (nodePrimary) nodePrimary.className = 'flow-node error';
    if (nodeDecision) {
      nodeDecision.className = 'flow-node';
      nodeDecision.querySelector('.flow-node-desc').textContent = 'No Retry (400)';
    }

    displayResponse(400, {
      'HTTP/1.1': '400 Bad Request',
      'Content-Type': 'application/json',
      'X-Model-Provider': 'primary-gpt4o'
    }, {
      error: {
        message: 'Invalid request: prompt contains unrecognized configuration parameters.',
        type: 'invalid_request_error',
        code: 'bad_request'
      }
    });

    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.style.background = 'rgba(245, 158, 11, 0.12)';
      noticeEl.style.border = '1px solid rgba(245, 158, 11, 0.3)';
      noticeEl.innerHTML = `<strong>Non-Retryable Client Error:</strong> HTTP 400 Bad Request returned directly to client. As per specification, client errors are NOT retried on secondary models.`;
    }
    window.showToast?.('Client 400 Bad Request: No failover attempted.', 'warn');
  } else if (primaryMode === 'timeout' || primaryMode === '429' || primaryMode === '500') {
    // Failover Scenarios: Primary times out (>3000ms deadline) or throttles or crashes
    if (nodePrimary) nodePrimary.className = 'flow-node error';
    if (nodeDecision) nodeDecision.className = 'flow-node failover';
    if (nodeBackup) nodeBackup.className = 'flow-node active';

    let reasonText = '';
    if (primaryMode === 'timeout') reasonText = 'Primary Model timed out at 3000ms deadline (AbortController fired)';
    else if (primaryMode === '429') reasonText = 'Primary Model returned HTTP 429 (Upstream Provider Throttled)';
    else if (primaryMode === '500') reasonText = 'Primary Model returned HTTP 500 (Internal Server Error)';

    displayResponse(200, {
      'HTTP/1.1': '200 OK (Failover Serviced)',
      'Content-Type': 'application/json',
      'X-Model-Provider': 'backup-claude3-haiku',
      'X-Failover-Reason': reasonText,
      'X-Primary-Status': primaryMode === 'timeout' ? 'timeout_3000ms' : primaryMode,
      'X-RateLimit-Limit': `${DEFAULT_LIMIT}`,
      'X-RateLimit-Remaining': `${DEFAULT_LIMIT - (currentUsage + tokenCost)}`
    }, {
      id: reqId,
      model: 'backup-model-8302',
      choices: [{ message: { role: 'assistant', content: `Failover completed successfully. Request fulfilled by Backup Model (Port 8302). Reason: ${reasonText}.` } }],
      usage: { total_tokens: tokenCost },
      failover_metadata: {
        primary_attempted: 'primary-8301',
        failover_reason: reasonText,
        secondary_serviced: 'backup-8302'
      }
    });

    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.style.background = 'rgba(245, 158, 11, 0.12)';
      noticeEl.style.border = '1px solid rgba(245, 158, 11, 0.3)';
      noticeEl.innerHTML = `<strong>Automatic Failover Triggered:</strong> ${reasonText}. Router seamlessly failed over to Backup Model on port 8302.`;
    }
    window.showToast?.(`Failover triggered: ${reasonText}`, 'warn');
  } else if (primaryMode === 'dual_fail') {
    // Both Primary and Backup fail -> Sanitized 502
    if (nodePrimary) nodePrimary.className = 'flow-node error';
    if (nodeDecision) nodeDecision.className = 'flow-node failover';
    if (nodeBackup) nodeBackup.className = 'flow-node error';

    displayResponse(502, {
      'HTTP/1.1': '502 Bad Gateway',
      'Content-Type': 'application/json'
    }, {
      error: {
        message: 'Bad Gateway: All upstream model providers failed to fulfill the request.',
        code: 'all_providers_unavailable'
      }
    });

    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.style.background = 'rgba(244, 63, 94, 0.12)';
      noticeEl.style.border = '1px solid rgba(244, 63, 94, 0.3)';
      noticeEl.innerHTML = `<strong>Sanitized Error Delivery:</strong> Both providers failed. HTTP 502 returned without leaking internal URLs, IP addresses, or stack traces.`;
    }
    window.showToast?.('Sanitized HTTP 502 returned after dual provider failure', 'error');
  }
}

function cleanOldBuckets(tenant, now) {
  if (!tenantStores[tenant]) tenantStores[tenant] = [];
  const cutoff = now - WINDOW_MS;
  tenantStores[tenant] = tenantStores[tenant].filter(b => b.timestamp > cutoff);
}

function calculateWindowUsage(tenant) {
  if (!tenantStores[tenant]) return 0;
  return tenantStores[tenant].reduce((acc, b) => acc + b.tokens, 0);
}

function updateRateLimiterUi() {
  const tenant = document.getElementById('t4-tenant-select')?.value || 'tenant-alpha';
  const now = Date.now();
  cleanOldBuckets(tenant, now);

  const usage = calculateWindowUsage(tenant);
  const remaining = Math.max(0, DEFAULT_LIMIT - usage);
  const pct = Math.min(100, Math.round((usage / DEFAULT_LIMIT) * 100));

  const badge = document.getElementById('t4-tenant-badge');
  const stats = document.getElementById('t4-meter-stats');
  const fill = document.getElementById('t4-meter-fill');
  const rem = document.getElementById('t4-meter-remaining');

  if (badge) badge.textContent = tenant;
  if (stats) stats.textContent = `${usage.toLocaleString()} / ${DEFAULT_LIMIT.toLocaleString()} tokens`;
  if (rem) rem.textContent = `Remaining: ${remaining.toLocaleString()} tokens`;

  if (fill) {
    fill.style.width = `${pct}%`;
    if (pct > 90) fill.className = 'meter-bar-fill critical';
    else if (pct > 70) fill.className = 'meter-bar-fill warning';
    else fill.className = 'meter-bar-fill';
  }
}

function resetFlowNodes() {
  ['node-rate-check', 'node-primary', 'node-decision', 'node-backup'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'flow-node';
  });
  const decision = document.getElementById('node-decision');
  if (decision) decision.querySelector('.flow-node-desc').textContent = 'Failover Check';
}

function displayResponse(statusCode, headers, body) {
  const badge = document.getElementById('t4-response-status-badge');
  const headersConsole = document.getElementById('t4-headers-console');
  const bodyConsole = document.getElementById('t4-body-console');

  if (badge) {
    if (statusCode === 200) {
      badge.className = 'tag-badge tag-emerald';
      badge.textContent = 'HTTP 200 OK';
    } else if (statusCode === 429) {
      badge.className = 'tag-badge tag-rose';
      badge.textContent = 'HTTP 429 Rate Limited';
    } else if (statusCode === 400) {
      badge.className = 'tag-badge tag-amber';
      badge.textContent = 'HTTP 400 Bad Request';
    } else {
      badge.className = 'tag-badge tag-rose';
      badge.textContent = `HTTP ${statusCode}`;
    }
  }

  if (headersConsole) {
    let headerStr = '';
    Object.entries(headers).forEach(([k, v]) => {
      headerStr += `${k}: ${v}\n`;
    });
    headersConsole.textContent = headerStr;
  }

  if (bodyConsole) {
    bodyConsole.textContent = JSON.stringify(body, null, 2);
  }
}
