/**
 * QuilrAI FDE Assessment: Task 2 - MCP Security Gateway Proxy Module
 */

const downstreamStats = {
  totalRequests: 0,
  toolsListRequests: 0,
  toolCallCounts: {},
};

let gatewayReqCounter = 1;

export function renderTask2(container) {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h2 class="panel-title">
          Task 2: MCP Security Gateway Proxy
          <span class="tag-badge tag-indigo">Reverse Proxy & RBAC</span>
        </h2>
        <p class="panel-desc">
          Enterprise reverse proxy sitting between untrusted client applications and internal downstream MCP servers on port 8100.
          Enforces Bearer token role-based access control (Admin vs Viewer), intercepts restricted tools with JSON-RPC error -32001,
          and guards against memory exhaustion with a 2MB DoS payload limit.
        </p>
      </div>
      <div class="header-actions">
        <span class="tag-badge tag-emerald">17 Vitest Tests Passing</span>
      </div>
    </div>

    <!-- Security Gateway Topology Grid -->
    <div class="grid-2" style="margin-bottom: 2rem;">
      <!-- Client Request Generator -->
      <div class="glass-card">
        <div class="card-title">
          <span>Inbound Proxy Request Generator</span>
          <span class="tag-badge tag-indigo">Port 8100</span>
        </div>
        <p class="card-desc">Configure authentication credentials and wire payloads to test gateway inspection rules.</p>

        <!-- Auth Token Configuration -->
        <div class="form-group">
          <label class="form-label" for="t2-auth-preset">Authentication Bearer Token</label>
          <select class="form-select" id="t2-auth-preset">
            <option value="admin">Admin Token (Bearer admin-token-secret-key)</option>
            <option value="viewer">Viewer Token (Bearer viewer-token-read-only)</option>
            <option value="invalid">Invalid Token (Bearer bad-signature-token)</option>
            <option value="missing">Missing Authorization Header (Anonymous)</option>
          </select>
          <div class="chip-row">
            <span class="chip" id="t2-chip-admin">Preset: Admin (Full Privileges)</span>
            <span class="chip" id="t2-chip-viewer">Preset: Viewer (Read-Only)</span>
            <span class="chip" id="t2-chip-unauth">Preset: Unauthenticated</span>
          </div>
        </div>

        <!-- Target Tool Selection -->
        <div class="form-group">
          <label class="form-label" for="t2-tool-select">Target MCP Tool / Method</label>
          <select class="form-select" id="t2-tool-select">
            <option value="system_health">system_health (Read-Only: Allowed for Viewer & Admin)</option>
            <option value="get_metrics">get_metrics (Read-Only: Allowed for Viewer & Admin)</option>
            <option value="tools/list">tools/list (Discovery: Allowed for Viewer & Admin)</option>
            <option value="get_customer_record">get_customer_record (Read-Only: Allowed for Viewer & Admin)</option>
            <option value="trigger_refund">trigger_refund (Administrative: Restricted to Admin)</option>
            <option value="admin_trigger_refund">admin_trigger_refund (Administrative: Restricted to Admin)</option>
          </select>
        </div>

        <!-- Wire Malformation & DoS Simulator -->
        <div class="form-group">
          <label class="form-label" for="t2-payload-type">Wire Protocol & Payload Safety</label>
          <select class="form-select" id="t2-payload-type">
            <option value="valid">Valid JSON-RPC 2.0 Object</option>
            <option value="null">Null Payload (triggers -32600 Invalid Request)</option>
            <option value="array">Array Batch Payload (triggers -32600)</option>
            <option value="number">Numeric Primitive Payload (triggers -32600)</option>
            <option value="oversized">Oversized &gt; 2MB DoS Attack (triggers HTTP 413)</option>
          </select>
        </div>

        <div style="display: flex; gap: 0.75rem; margin-top: 1.5rem;">
          <button class="btn btn-primary" id="t2-btn-send" style="flex: 1;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Send HTTP Proxy Request
          </button>
          <button class="btn btn-secondary" id="t2-btn-reset-stats">Reset Stats</button>
        </div>
      </div>

      <!-- Traffic Inspection & Sequence Flow -->
      <div class="glass-card">
        <div class="card-title">
          <span>Gateway Enforcement Tracer</span>
          <span class="tag-badge tag-cyan" id="t2-trace-badge">Awaiting Traffic</span>
        </div>
        <p class="card-desc">Visual execution path through gateway security barriers.</p>

        <!-- Dynamic Sequence Step Visualizer -->
        <div class="decision-tree-container" id="t2-trace-steps" style="margin-bottom: 1.25rem;">
          <div style="padding: 0.75rem 1rem; background: var(--bg-terminal); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted);">
            Ready to trace request flow...
          </div>
        </div>

        <!-- Downstream Server Statistics -->
        <div style="background: rgba(0, 0, 0, 0.3); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">Downstream MCP Server Metrics (Port 8101)</span>
            <span class="tag-badge tag-emerald" id="t2-downstream-status">Idle</span>
          </div>
          <div class="grid-3" style="gap: 0.5rem; text-align: center;">
            <div style="background: var(--bg-card); padding: 0.5rem; border-radius: var(--radius-sm);">
              <div style="font-size: 0.7rem; color: var(--text-muted);">Forwarded</div>
              <div style="font-size: 1.2rem; font-weight: 700; color: var(--accent-cyan);" id="t2-stat-forwarded">0</div>
            </div>
            <div style="background: var(--bg-card); padding: 0.5rem; border-radius: var(--radius-sm);">
              <div style="font-size: 0.7rem; color: var(--text-muted);">Blocked (RBAC)</div>
              <div style="font-size: 1.2rem; font-weight: 700; color: var(--accent-rose);" id="t2-stat-blocked">0</div>
            </div>
            <div style="background: var(--bg-card); padding: 0.5rem; border-radius: var(--radius-sm);">
              <div style="font-size: 0.7rem; color: var(--text-muted);">tools/list</div>
              <div style="font-size: 1.2rem; font-weight: 700; color: var(--accent-emerald);" id="t2-stat-list">0</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Wire Traffic Log -->
    <div class="glass-card">
      <div class="card-title">
        <span>HTTP Wire Exchange Inspector</span>
        <span class="tag-badge tag-indigo">Raw Payloads</span>
      </div>
      <div class="grid-2" style="gap: 1rem; margin-top: 0.75rem;">
        <div class="terminal-window">
          <div class="terminal-header">
            <div class="terminal-dots"><span class="terminal-dot dot-yellow"></span></div>
            <div class="terminal-title">Inbound Client HTTP Request</div>
            <span class="tag-badge tag-cyan">Port 8100</span>
          </div>
          <div class="terminal-body" id="t2-http-request" style="min-height: 160px; max-height: 200px;">// No active request...</div>
        </div>

        <div class="terminal-window">
          <div class="terminal-header">
            <div class="terminal-dots"><span class="terminal-dot dot-green"></span></div>
            <div class="terminal-title">Gateway HTTP Response</div>
            <span class="tag-badge tag-emerald" id="t2-res-code-badge">HTTP Status</span>
          </div>
          <div class="terminal-body" id="t2-http-response" style="min-height: 160px; max-height: 200px;">// No active response...</div>
        </div>
      </div>
    </div>
  `;

  setupTask2Events();
}

let blockedCount = 0;

function setupTask2Events() {
  const presetSelect = document.getElementById('t2-auth-preset');
  document.getElementById('t2-chip-admin')?.addEventListener('click', () => {
    if (presetSelect) presetSelect.value = 'admin';
  });
  document.getElementById('t2-chip-viewer')?.addEventListener('click', () => {
    if (presetSelect) presetSelect.value = 'viewer';
  });
  document.getElementById('t2-chip-unauth')?.addEventListener('click', () => {
    if (presetSelect) presetSelect.value = 'invalid';
  });

  document.getElementById('t2-btn-send')?.addEventListener('click', () => {
    sendTask2Request();
  });

  document.getElementById('t2-btn-reset-stats')?.addEventListener('click', () => {
    downstreamStats.totalRequests = 0;
    downstreamStats.toolsListRequests = 0;
    downstreamStats.toolCallCounts = {};
    blockedCount = 0;
    updateDownstreamUi();
    window.showToast?.('Downstream metrics reset.', 'info');
  });
}

function sendTask2Request() {
  const authPreset = document.getElementById('t2-auth-preset')?.value || 'admin';
  const toolName = document.getElementById('t2-tool-select')?.value || 'system_health';
  const payloadType = document.getElementById('t2-payload-type')?.value || 'valid';
  const reqId = `proxy-req-${gatewayReqCounter++}`;

  const traceContainer = document.getElementById('t2-trace-steps');
  const traceBadge = document.getElementById('t2-trace-badge');
  const reqConsole = document.getElementById('t2-http-request');
  const resConsole = document.getElementById('t2-http-response');
  const resBadge = document.getElementById('t2-res-code-badge');

  // Format Authorization Header
  let authHeader = '';
  if (authPreset === 'admin') authHeader = 'Bearer admin-token-secret-key';
  else if (authPreset === 'viewer') authHeader = 'Bearer viewer-token-read-only';
  else if (authPreset === 'invalid') authHeader = 'Bearer bad-signature-token';

  // Format Request Body
  let rawBody;
  let bodyBytes = 0;

  if (payloadType === 'valid') {
    const isList = toolName === 'tools/list';
    const jsonRpcObj = isList ? {
      jsonrpc: '2.0',
      id: reqId,
      method: 'tools/list',
      params: {}
    } : {
      jsonrpc: '2.0',
      id: reqId,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolName === 'trigger_refund' || toolName === 'admin_trigger_refund' ? {
          customerId: 'CUST-10001',
          amount: 150.00,
          reason: 'Service cancellation agreement'
        } : (toolName === 'get_customer_record' ? { customerId: 'CUST-10001' } : {})
      }
    };
    rawBody = JSON.stringify(jsonRpcObj, null, 2);
    bodyBytes = new TextEncoder().encode(rawBody).length;
  } else if (payloadType === 'null') {
    rawBody = 'null';
    bodyBytes = 4;
  } else if (payloadType === 'array') {
    rawBody = JSON.stringify([{ jsonrpc: '2.0', id: reqId, method: 'tools/list' }], null, 2);
    bodyBytes = 54;
  } else if (payloadType === 'number') {
    rawBody = '42';
    bodyBytes = 2;
  } else if (payloadType === 'oversized') {
    rawBody = '{"payload": "' + 'A'.repeat(200) + '... [2,097,152 bytes omitted]"}';
    bodyBytes = 2097152 + 1024; // > 2MB
  }

  // Display Inbound HTTP Request
  if (reqConsole) {
    reqConsole.textContent = `POST /mcp HTTP/1.1\nHost: localhost:8100\nContent-Type: application/json\nContent-Length: ${bodyBytes}\n${authHeader ? `Authorization: ${authHeader}\n` : ''}\n${rawBody}`;
  }

  // Gateway Step 1: Payload Size Check (2MB DoS Limit)
  if (payloadType === 'oversized') {
    if (traceBadge) {
      traceBadge.className = 'tag-badge tag-rose';
      traceBadge.textContent = '413 Payload Too Large';
    }
    if (resBadge) {
      resBadge.className = 'tag-badge tag-rose';
      resBadge.textContent = 'HTTP 413';
    }
    if (traceContainer) {
      traceContainer.innerHTML = `
        <div style="padding: 0.75rem 1rem; background: rgba(244, 63, 94, 0.12); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: var(--radius-md); font-size: 0.82rem;">
          <strong style="color: var(--accent-rose);">&times; DoS Protection Intercepted:</strong>
          Payload exceeded 2MB limit (Received: ${(bodyBytes / (1024 * 1024)).toFixed(2)} MB).
          Socket destroyed immediately to protect server heap.
        </div>
      `;
    }
    if (resConsole) {
      resConsole.textContent = `HTTP/1.1 413 Payload Too Large\nContent-Type: application/json\n\n{\n  "error": "Payload exceeds 2MB limit"\n}`;
    }
    window.showToast?.('Gateway blocked oversized payload (>2MB DoS attempt)', 'error');
    return;
  }

  // Gateway Step 2: Authentication Check
  let clientRole = null;
  if (authPreset === 'admin') clientRole = 'admin';
  else if (authPreset === 'viewer') clientRole = 'viewer';

  if (!clientRole) {
    if (traceBadge) {
      traceBadge.className = 'tag-badge tag-rose';
      traceBadge.textContent = '401 Unauthorized';
    }
    if (resBadge) {
      resBadge.className = 'tag-badge tag-rose';
      resBadge.textContent = 'HTTP 401';
    }
    if (traceContainer) {
      traceContainer.innerHTML = `
        <div style="padding: 0.75rem 1rem; background: rgba(244, 63, 94, 0.12); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: var(--radius-md); font-size: 0.82rem;">
          <strong style="color: var(--accent-rose);">&times; Authentication Failed:</strong>
          Missing or invalid Bearer token. Zero traffic routed downstream.
        </div>
      `;
    }
    if (resConsole) {
      resConsole.textContent = `HTTP/1.1 401 Unauthorized\nContent-Type: application/json\n\n{\n  "error": "Unauthorized: Missing or invalid Bearer token"\n}`;
    }
    window.showToast?.('Authentication failed: Missing or invalid token', 'error');
    return;
  }

  // Gateway Step 3: Wire Protocol Validation (Object Check)
  if (payloadType !== 'valid') {
    if (traceBadge) {
      traceBadge.className = 'tag-badge tag-amber';
      traceBadge.textContent = '-32600 Invalid Request';
    }
    if (resBadge) {
      resBadge.className = 'tag-badge tag-amber';
      resBadge.textContent = 'HTTP 400 (JSON-RPC Error)';
    }
    if (traceContainer) {
      traceContainer.innerHTML = `
        <div style="padding: 0.75rem 1rem; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-md); font-size: 0.82rem;">
          <strong style="color: var(--accent-amber);">&#9888; Wire Interception:</strong>
          Payload is not a valid JSON-RPC 2.0 object. Rejection frame dispatched with code -32600.
        </div>
      `;
    }
    const errRes = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request: payload must be a JSON object' }
    };
    if (resConsole) {
      resConsole.textContent = `HTTP/1.1 400 Bad Request\nContent-Type: application/json\n\n${JSON.stringify(errRes, null, 2)}`;
    }
    window.showToast?.('Wire parser rejected malformed payload (-32600)', 'error');
    return;
  }

  // Gateway Step 4: Role-Based Access Control (RBAC) Tool Filtering
  const isRestricted = toolName === 'trigger_refund' || toolName === 'admin_trigger_refund';

  if (clientRole === 'viewer' && isRestricted) {
    blockedCount++;
    updateDownstreamUi();

    if (traceBadge) {
      traceBadge.className = 'tag-badge tag-rose';
      traceBadge.textContent = '-32001 Unauthorized';
    }
    if (resBadge) {
      resBadge.className = 'tag-badge tag-rose';
      resBadge.textContent = '200 OK (-32001 Error Frame)';
    }
    if (traceContainer) {
      traceContainer.innerHTML = `
        <div style="padding: 0.75rem 1rem; background: rgba(244, 63, 94, 0.12); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: var(--radius-md); font-size: 0.82rem;">
          <div style="font-weight: 700; color: var(--accent-rose); margin-bottom: 0.25rem;">
            &times; RBAC Violation Intercepted at Gateway
          </div>
          <div>Role <code>viewer</code> is prohibited from executing administrative tool <code>${toolName}</code>.</div>
          <div style="color: var(--accent-cyan); margin-top: 0.35rem; font-family: var(--font-mono); font-size: 0.78rem;">
            &rarr; Zero downstream traffic generated. Downstream server untouched.
          </div>
        </div>
      `;
    }
    const rbacErrRes = {
      jsonrpc: '2.0',
      id: reqId,
      error: {
        code: -32001,
        message: `Unauthorized: Role '${clientRole}' cannot execute administrative tool '${toolName}'`
      }
    };
    if (resConsole) {
      resConsole.textContent = `HTTP/1.1 200 OK\nContent-Type: application/json\n\n${JSON.stringify(rbacErrRes, null, 2)}`;
    }
    window.showToast?.(`RBAC Blocked: Role 'viewer' cannot execute '${toolName}' (-32001)`, 'error');
    return;
  }

  // Gateway Step 5: Permitted Traffic Routed to Downstream MCP (Port 8101)
  downstreamStats.totalRequests++;
  if (toolName === 'tools/list') {
    downstreamStats.toolsListRequests++;
  } else {
    downstreamStats.toolCallCounts[toolName] = (downstreamStats.toolCallCounts[toolName] || 0) + 1;
  }
  updateDownstreamUi();

  if (traceBadge) {
    traceBadge.className = 'tag-badge tag-emerald';
    traceBadge.textContent = 'Proxied to :8101';
  }
  if (resBadge) {
    resBadge.className = 'tag-badge tag-emerald';
    resBadge.textContent = 'HTTP 200 OK';
  }

  if (traceContainer) {
    traceContainer.innerHTML = `
      <div style="padding: 0.75rem 1rem; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-md); font-size: 0.82rem;">
        <div style="font-weight: 700; color: var(--accent-emerald); margin-bottom: 0.25rem;">
          &#10003; Proxy Authorization Granted (Role: ${clientRole})
        </div>
        <div>Traffic safely forwarded to Downstream MCP server on <code>localhost:8101</code>.</div>
        <div style="color: var(--accent-cyan); margin-top: 0.35rem; font-family: var(--font-mono); font-size: 0.78rem;">
          &rarr; Response piped back to client without in-memory buffering.
        </div>
      </div>
    `;
  }

  let mockResult;
  if (toolName === 'tools/list') {
    mockResult = {
      tools: [
        { name: 'get_customer_record', description: 'Retrieve verified customer record' },
        { name: 'system_health', description: 'Query system health diagnostics' },
        { name: 'get_metrics', description: 'Telemetry and request counters' },
        { name: 'trigger_refund', description: 'Initiate balance refund (Admin only)' },
        { name: 'admin_trigger_refund', description: 'Administrative refund alias' }
      ]
    };
  } else if (toolName === 'system_health') {
    mockResult = { status: 'healthy', memoryRss: '42.1MB', uptimeSeconds: 1420 };
  } else if (toolName === 'get_metrics') {
    mockResult = { totalRequests: downstreamStats.totalRequests, activeConnections: 1 };
  } else if (toolName === 'get_customer_record') {
    mockResult = { customerId: 'CUST-10001', name: 'Jane Doe', plan: 'Enterprise', balance: 4250.00 };
  } else {
    mockResult = { status: 'success', tool: toolName, processedBy: 'Downstream-MCP:8101' };
  }

  const downstreamRes = {
    jsonrpc: '2.0',
    id: reqId,
    result: {
      content: [{ type: 'text', text: JSON.stringify(mockResult, null, 2) }]
    }
  };

  if (resConsole) {
    resConsole.textContent = `HTTP/1.1 200 OK\nContent-Type: application/json\nTransfer-Encoding: chunked\n\n${JSON.stringify(downstreamRes, null, 2)}`;
  }
  window.showToast?.(`Request successfully forwarded and executed via downstream MCP!`, 'success');
}

function updateDownstreamUi() {
  const fwd = document.getElementById('t2-stat-forwarded');
  const blk = document.getElementById('t2-stat-blocked');
  const lst = document.getElementById('t2-stat-list');
  const status = document.getElementById('t2-downstream-status');

  if (fwd) fwd.textContent = downstreamStats.totalRequests;
  if (blk) blk.textContent = blockedCount;
  if (lst) lst.textContent = downstreamStats.toolsListRequests;
  if (status) status.textContent = downstreamStats.totalRequests > 0 ? 'Active' : 'Idle';
}
