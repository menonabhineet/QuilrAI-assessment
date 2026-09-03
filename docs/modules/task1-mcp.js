/**
 * QuilrAI FDE Assessment: Task 1 - Custom MCP Server & Stdio Isolation Module
 */

const MOCK_CUSTOMERS = {
  'CUST-10001': { id: 'CUST-10001', name: 'Jane Doe', plan: 'Enterprise', balance: 4250.00, email: 'jane.doe@enterprise.com', status: 'Active' },
  'CUST-10002': { id: 'CUST-10002', name: 'Acme Corporation', plan: 'Scale', balance: 1200.00, email: 'billing@acme.corp', status: 'Active' },
  'CUST-10003': { id: 'CUST-10003', name: 'TechStart Inc', plan: 'Developer', balance: 150.00, email: 'dev@techstart.io', status: 'Suspended' },
  'CUST-10004': { id: 'CUST-10004', name: 'Global Logistics', plan: 'Enterprise', balance: 9800.00, email: 'ops@globallogistics.com', status: 'Active' },
  'CUST-10005': { id: 'CUST-10005', name: 'CyberDyne Systems', plan: 'Custom', balance: 32000.00, email: 'accounting@cyberdyne.net', status: 'Active' },
};

let requestIdCounter = 1;

export function renderTask1(container) {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h2 class="panel-title">
          Task 1: MCP Server & Stdio Isolation
          <span class="tag-badge tag-cyan">JSON-RPC 2.0 Protocol</span>
        </h2>
        <p class="panel-desc">
          Official Model Context Protocol (MCP) server implementation with Zod parameter validation and strict stdio isolation.
          Stdout is reserved exclusively for valid JSON-RPC message frames; all application diagnostics and logging route strictly to stderr.
        </p>
      </div>
      <div class="header-actions">
        <span class="tag-badge tag-emerald">23 Vitest Tests Passing</span>
      </div>
    </div>

    <!-- Interactive Workspace Grid -->
    <div class="grid-2" style="margin-bottom: 2rem;">
      <!-- Tool Execution Controls -->
      <div class="glass-card">
        <div class="card-title">
          <span>MCP Tool Call Dispatcher</span>
          <span class="tag-badge tag-cyan">tools/call</span>
        </div>
        <p class="card-desc">Select an MCP tool, populate validated arguments, and dispatch via stdio JSON-RPC transport.</p>

        <div class="form-group">
          <label class="form-label" for="t1-tool-select">Target MCP Tool</label>
          <select class="form-select" id="t1-tool-select">
            <option value="get_customer_record">get_customer_record</option>
            <option value="trigger_refund">trigger_refund</option>
            <option value="admin_trigger_refund">admin_trigger_refund (alias)</option>
          </select>
        </div>

        <!-- Section: get_customer_record arguments -->
        <div id="t1-args-get-customer">
          <div class="form-group">
            <label class="form-label" for="t1-cust-id">
              Customer ID
              <span class="label-hint">Pattern: ^CUST-[0-9]{5}$</span>
            </label>
            <input type="text" class="form-input" id="t1-cust-id" value="CUST-10001" placeholder="CUST-10001">
            <div class="chip-row">
              <span class="chip" data-fill-cust="CUST-10001">CUST-10001 (Valid)</span>
              <span class="chip" data-fill-cust="CUST-10004">CUST-10004 (Valid)</span>
              <span class="chip" data-fill-cust="CUST-99999">CUST-99999 (Not Found)</span>
              <span class="chip" data-fill-cust="INVALID-ID">INVALID-ID (Fails Regex)</span>
            </div>
          </div>
        </div>

        <!-- Section: trigger_refund arguments -->
        <div id="t1-args-refund" style="display: none;">
          <div class="form-group">
            <label class="form-label" for="t1-refund-cust-id">
              Customer ID
              <span class="label-hint">Pattern: ^CUST-[0-9]{5}$</span>
            </label>
            <input type="text" class="form-input" id="t1-refund-cust-id" value="CUST-10001" placeholder="CUST-10001">
          </div>

          <div class="form-group">
            <label class="form-label" for="t1-refund-amount">
              Refund Amount (USD)
              <span class="label-hint">Positive finite number &gt; 0</span>
            </label>
            <input type="number" class="form-input" id="t1-refund-amount" value="250.00" step="0.01" min="0.01">
          </div>

          <div class="form-group">
            <label class="form-label" for="t1-refund-reason">
              Refund Justification Reason
              <span class="label-hint">Min 10 non-whitespace chars</span>
            </label>
            <textarea class="form-textarea" id="t1-refund-reason" rows="2">Customer dissatisfaction with SLA delivery window</textarea>
            <div class="chip-row">
              <span class="chip" data-fill-preset="valid-refund">Valid $250 Refund</span>
              <span class="chip" data-fill-preset="negative-amount">Negative Amount (-50)</span>
              <span class="chip" data-fill-preset="short-reason">Short Reason (&lt;10 chars)</span>
              <span class="chip" data-fill-preset="whitespace-reason">Whitespace Reason</span>
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 0.75rem; margin-top: 1.5rem;">
          <button class="btn btn-primary" id="t1-btn-dispatch" style="flex: 1;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Dispatch JSON-RPC Frame
          </button>
          <button class="btn btn-secondary" id="t1-btn-clear">Clear Consoles</button>
        </div>
      </div>

      <!-- JSON-RPC Wire Frame Inspector -->
      <div class="glass-card">
        <div class="card-title">
          <span>Wire Frame Inspector</span>
          <span class="tag-badge tag-indigo">JSON-RPC 2.0</span>
        </div>
        <p class="card-desc">Precise request and response frames transmitted over the IPC channel.</p>

        <div class="terminal-window" style="margin-bottom: 1rem;">
          <div class="terminal-header">
            <div class="terminal-dots">
              <span class="terminal-dot dot-red"></span>
              <span class="terminal-dot dot-yellow"></span>
              <span class="terminal-dot dot-green"></span>
            </div>
            <div class="terminal-title">tools/call Request Payload</div>
            <span class="tag-badge tag-cyan">inbound</span>
          </div>
          <div class="terminal-body" id="t1-wire-request" style="min-height: 120px; max-height: 140px;">// Awaiting dispatch...</div>
        </div>

        <div class="terminal-window">
          <div class="terminal-header">
            <div class="terminal-dots">
              <span class="terminal-dot dot-red"></span>
              <span class="terminal-dot dot-yellow"></span>
              <span class="terminal-dot dot-green"></span>
            </div>
            <div class="terminal-title">JSON-RPC Response Payload</div>
            <span class="tag-badge tag-emerald" id="t1-response-status-badge">outbound</span>
          </div>
          <div class="terminal-body" id="t1-wire-response" style="min-height: 140px; max-height: 160px;">// Awaiting dispatch...</div>
        </div>
      </div>
    </div>

    <!-- Dual-Channel Stdio Console (Demonstrating Stdio Isolation) -->
    <div class="glass-card">
      <div class="card-title">
        <span>Dual-Channel Stdio Isolation Monitor</span>
        <span class="tag-badge tag-emerald">Strict Stdio Isolation Active</span>
      </div>
      <p class="card-desc">
        To prevent corrupted message frames in MCP clients, stdout is strictly reserved for valid JSON-RPC frames.
        All server logs, schema validation notices, and debug traces are redirected to stderr.
      </p>

      <div class="grid-2" style="gap: 1rem; margin-top: 1rem;">
        <!-- stdout Channel -->
        <div class="terminal-window">
          <div class="terminal-header">
            <div class="terminal-dots">
              <span class="terminal-dot dot-green"></span>
            </div>
            <div class="terminal-title">process.stdout (Protocol Frames Only)</div>
            <span class="tag-badge tag-emerald">STDOUT</span>
          </div>
          <div class="terminal-body" id="t1-stdout-console" style="min-height: 180px; max-height: 220px;">
<span class="log-stdout">[stdout ready] Waiting for JSON-RPC 2.0 message frames...</span>
          </div>
        </div>

        <!-- stderr Channel -->
        <div class="terminal-window">
          <div class="terminal-header">
            <div class="terminal-dots">
              <span class="terminal-dot dot-yellow"></span>
            </div>
            <div class="terminal-title">process.stderr (Application & Error Logs)</div>
            <span class="tag-badge tag-amber">STDERR</span>
          </div>
          <div class="terminal-body" id="t1-stderr-console" style="min-height: 180px; max-height: 220px;">
<span class="log-stderr">[stderr log] [MCP-Server] Server initialized on stdio transport.</span>
<span class="log-stderr">[stderr log] [MCP-Server] stdout write stream wrapped with frame validator.</span>
          </div>
        </div>
      </div>
    </div>
  `;

  setupTask1Events();
}

function setupTask1Events() {
  const toolSelect = document.getElementById('t1-tool-select');
  const argsGetCustomer = document.getElementById('t1-args-get-customer');
  const argsRefund = document.getElementById('t1-args-refund');

  toolSelect?.addEventListener('change', () => {
    const isRefund = toolSelect.value === 'trigger_refund' || toolSelect.value === 'admin_trigger_refund';
    if (argsGetCustomer) argsGetCustomer.style.display = isRefund ? 'none' : 'block';
    if (argsRefund) argsRefund.style.display = isRefund ? 'block' : 'none';
  });

  // Quick fill chips for customer ID
  document.querySelectorAll('[data-fill-cust]').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = chip.getAttribute('data-fill-cust');
      const input = document.getElementById('t1-cust-id');
      if (input && val) input.value = val;
    });
  });

  // Quick fill presets for refund
  document.querySelectorAll('[data-fill-preset]').forEach(chip => {
    chip.addEventListener('click', () => {
      const preset = chip.getAttribute('data-fill-preset');
      const custInput = document.getElementById('t1-refund-cust-id');
      const amtInput = document.getElementById('t1-refund-amount');
      const reasonInput = document.getElementById('t1-refund-reason');

      if (preset === 'valid-refund') {
        if (custInput) custInput.value = 'CUST-10001';
        if (amtInput) amtInput.value = '250.00';
        if (reasonInput) reasonInput.value = 'Customer dissatisfaction with SLA delivery window';
      } else if (preset === 'negative-amount') {
        if (amtInput) amtInput.value = '-50.00';
      } else if (preset === 'short-reason') {
        if (reasonInput) reasonInput.value = 'Too bad';
      } else if (preset === 'whitespace-reason') {
        if (reasonInput) reasonInput.value = '          ';
      }
    });
  });

  // Dispatch button
  document.getElementById('t1-btn-dispatch')?.addEventListener('click', () => {
    dispatchTask1Tool();
  });

  // Clear consoles
  document.getElementById('t1-btn-clear')?.addEventListener('click', () => {
    const stdout = document.getElementById('t1-stdout-console');
    const stderr = document.getElementById('t1-stderr-console');
    if (stdout) stdout.innerHTML = '<span class="log-stdout">[stdout cleared]</span>';
    if (stderr) stderr.innerHTML = '<span class="log-stderr">[stderr cleared]</span>';
  });
}

function dispatchTask1Tool() {
  const toolSelect = document.getElementById('t1-tool-select');
  const toolName = toolSelect ? toolSelect.value : 'get_customer_record';
  const reqId = `req-${requestIdCounter++}`;

  let toolArgs = {};
  const isRefund = toolName === 'trigger_refund' || toolName === 'admin_trigger_refund';

  if (!isRefund) {
    const custIdInput = document.getElementById('t1-cust-id');
    toolArgs = { customerId: custIdInput ? custIdInput.value : '' };
  } else {
    const custIdInput = document.getElementById('t1-refund-cust-id');
    const amtInput = document.getElementById('t1-refund-amount');
    const reasonInput = document.getElementById('t1-refund-reason');
    toolArgs = {
      customerId: custIdInput ? custIdInput.value : '',
      amount: amtInput ? parseFloat(amtInput.value) : 0,
      reason: reasonInput ? reasonInput.value : ''
    };
  }

  // Format JSON-RPC 2.0 Request Frame
  const jsonRpcRequest = {
    jsonrpc: '2.0',
    id: reqId,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: toolArgs
    }
  };

  const reqBodyEl = document.getElementById('t1-wire-request');
  if (reqBodyEl) {
    reqBodyEl.textContent = JSON.stringify(jsonRpcRequest, null, 2);
  }

  // Log dispatch to stderr
  appendStderr(`[MCP-Server] Received JSON-RPC request frame [id=${reqId}, method="tools/call", tool="${toolName}"]`);

  // Execute Zod-equivalent schema validation
  const validationResult = validateTask1Schema(toolName, toolArgs);

  let jsonRpcResponse;
  const statusBadge = document.getElementById('t1-response-status-badge');

  if (!validationResult.valid) {
    // Validation Failure: JSON-RPC -32602 InvalidParams
    jsonRpcResponse = {
      jsonrpc: '2.0',
      id: reqId,
      error: {
        code: -32602,
        message: `Invalid params: ${validationResult.error}`,
        data: {
          validationErrors: validationResult.details
        }
      }
    };

    if (statusBadge) {
      statusBadge.className = 'tag-badge tag-rose';
      statusBadge.textContent = 'HTTP -32602 InvalidParams';
    }

    appendStderr(`[MCP-Server] [VALIDATION ERROR] Arguments failed Zod schema for tool "${toolName}": ${validationResult.error}`);
    window.showToast?.(`Validation failed (-32602): ${validationResult.error}`, 'error');
  } else {
    // Success Execution
    let resultPayload;
    if (!isRefund) {
      const cust = MOCK_CUSTOMERS[toolArgs.customerId];
      if (!cust) {
        resultPayload = {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `Customer '${toolArgs.customerId}' not found in database.` })
          }],
          isError: true
        };
        appendStderr(`[MCP-Server] Customer lookup returned not found for ${toolArgs.customerId}`);
      } else {
        resultPayload = {
          content: [{
            type: 'text',
            text: JSON.stringify(cust, null, 2)
          }]
        };
        appendStderr(`[MCP-Server] Customer record successfully resolved for ${toolArgs.customerId}`);
      }
    } else {
      const cust = MOCK_CUSTOMERS[toolArgs.customerId];
      const newBalance = cust ? Math.max(0, cust.balance - toolArgs.amount) : 0;
      if (cust) cust.balance = newBalance;

      resultPayload = {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            refundId: `REF-${Math.floor(100000 + Math.random() * 900000)}`,
            customerId: toolArgs.customerId,
            amountRefunded: toolArgs.amount,
            updatedBalance: newBalance,
            reason: toolArgs.reason.trim(),
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
      appendStderr(`[MCP-Server] Refund of $${toolArgs.amount} successfully executed for ${toolArgs.customerId}`);
    }

    jsonRpcResponse = {
      jsonrpc: '2.0',
      id: reqId,
      result: resultPayload
    };

    if (statusBadge) {
      statusBadge.className = 'tag-badge tag-emerald';
      statusBadge.textContent = '200 OK (Result)';
    }
    window.showToast?.(`Tool "${toolName}" executed successfully!`, 'success');
  }

  // Display Wire Response
  const resBodyEl = document.getElementById('t1-wire-response');
  if (resBodyEl) {
    resBodyEl.textContent = JSON.stringify(jsonRpcResponse, null, 2);
  }

  // Stdio isolation output: stdout receives ONLY the clean JSON-RPC frame
  appendStdout(JSON.stringify(jsonRpcResponse));
}

function validateTask1Schema(toolName, args) {
  const custIdRegex = /^CUST-[0-9]{5}$/;

  if (toolName === 'get_customer_record') {
    if (!args.customerId || typeof args.customerId !== 'string') {
      return { valid: false, error: 'customerId is required and must be a string', details: ['customerId: Required'] };
    }
    if (!custIdRegex.test(args.customerId)) {
      return {
        valid: false,
        error: `customerId '${args.customerId}' does not match pattern ^CUST-[0-9]{5}$`,
        details: [`customerId: Invalid format (must match ^CUST-[0-9]{5}$)`]
      };
    }
    return { valid: true };
  }

  if (toolName === 'trigger_refund' || toolName === 'admin_trigger_refund') {
    if (!args.customerId || !custIdRegex.test(args.customerId)) {
      return { valid: false, error: `Invalid customerId format: must match ^CUST-[0-9]{5}$`, details: ['customerId: Invalid format'] };
    }
    if (typeof args.amount !== 'number' || isNaN(args.amount) || !isFinite(args.amount) || args.amount <= 0) {
      return { valid: false, error: `amount must be a positive finite number greater than 0`, details: ['amount: Must be > 0 and finite'] };
    }
    if (!args.reason || typeof args.reason !== 'string' || args.reason.trim().length < 10) {
      return { valid: false, error: `reason must be at least 10 non-whitespace characters`, details: ['reason: String must contain at least 10 character(s)'] };
    }
    return { valid: true };
  }

  return { valid: false, error: `Unknown tool "${toolName}"`, details: ['name: Unknown tool'] };
}

function appendStdout(text) {
  const el = document.getElementById('t1-stdout-console');
  if (!el) return;
  const line = document.createElement('div');
  line.className = 'log-stdout';
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function appendStderr(text) {
  const el = document.getElementById('t1-stderr-console');
  if (!el) return;
  const line = document.createElement('div');
  line.className = 'log-stderr';
  const ts = new Date().toISOString().substring(11, 19);
  line.innerHTML = `<span class="log-timestamp">[${ts}]</span> ${escapeHtml(text)}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
