/**
 * QuilrAI FDE Assessment: Task 5 - Enterprise Zero-Trust Debugging Playbook Module
 */

const TRIAGE_SCENARIOS = {
  timeout_60s: {
    title: "Connection Drops Intermittently at 60s / 120s During Agent Tool Execution",
    category: "TCP Keepalive & Idle Timeout",
    symptom: "Agent makes a multi-turn tool call (e.g. database query or file processing taking >60s). The client receives ECONNRESET or socket hangup precisely at the 60.00s mark.",
    rootCause: "Corporate egress proxies (e.g. Zscaler, Palo Alto Networks, Envoy) enforce aggressive idle connection timeouts (default: 60s) on active TCP streams when no application bytes are transmitted during lengthy tool execution.",
    diagnosticCommand: "tcpdump -nnvv -s0 -i any 'tcp port 8100 and (tcp[tcpflags] & (tcp-rst|tcp-fin) != 0)' -w triage_drop.pcap",
    diagnosticCurl: "curl -Iv --http1.1 --no-buffer -H 'Accept: text/event-stream' http://gateway.enterprise.internal:8100/mcp",
    simulatedOutput: `> POST /mcp HTTP/1.1
> Host: gateway.enterprise.internal:8100
> Accept: text/event-stream
< HTTP/1.1 200 OK
< Transfer-Encoding: chunked
< Content-Type: text/event-stream
[T+00.00s] data: {"status": "tool_executing", "tool": "query_analytics"}
... [No packet traffic for 60.00s] ...
* TCP connection severed: Received TCP RST from intermediate hop (10.200.4.1 [Zscaler Cloud Connector])
* Closing connection 0
curl: (56) Recv failure: Connection reset by peer`,
    remediation: [
      "Enable TCP Keepalives at OS socket layer with TCP_KEEPIDLE=15s and TCP_KEEPINTVL=5s.",
      "Emit periodic SSE heartbeat comment frames (': keepalive-ping\\n\\n') every 15 seconds during tool execution.",
      "Configure intermediate proxy 'idle_timeout: 300s' for designated AI Gateway ingress routes."
    ],
    configSnippet: `// Node.js HTTP Server Keep-Alive Configuration
const server = http.createServer((req, res) => {
  // Disable NGINX / Proxy chunk buffering
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Content-Type', 'text/event-stream');

  // Emit 15-second heartbeat ping to prevent proxy idle drop
  const heartbeat = setInterval(() => {
    res.write(': keepalive-ping\\n\\n');
  }, 15000);

  req.on('close', () => clearInterval(heartbeat));
});

// Configure TCP Keepalive probes
server.on('connection', (socket) => {
  socket.setKeepAlive(true, 15000); // Probe every 15s
});`
  },

  tls_inspection: {
    title: "TLS Handshake Hangs or Fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    category: "SSL Decryption & Certificate Pinning",
    symptom: "Agent microservice fails to initiate TLS handshake to upstream MCP or LLM endpoints when running on corporate enterprise network.",
    rootCause: "Enterprise Deep Packet Inspection (DPI) proxies perform MITM SSL decryption by dynamically generating certificates signed by an internal corporate Root CA. Node.js applications use Mozilla's default CA bundle and reject the corporate certificate.",
    diagnosticCommand: "openssl s_client -connect gateway.enterprise.internal:8443 -showcerts -servername gateway.enterprise.internal",
    diagnosticCurl: "curl -Iv https://gateway.enterprise.internal:8443/health --cacert /etc/ssl/certs/corp-root-ca.crt",
    simulatedOutput: `* Connecting to gateway.enterprise.internal:8443...
* Connected to proxy.enterprise.corp (10.0.1.50) port 8443
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384
* Server certificate:
*  subject: C=US; O=Enterprise Inc; CN=gateway.enterprise.internal
*  issuer: C=US; O=Zscaler Inc; OU=Zscaler Cloud Security; CN=Zscaler Intermediate CA
* SSL certificate verify result: unable to get local issuer certificate (20)
* Closing connection
curl: (60) SSL certificate problem: self signed certificate in certificate chain`,
    remediation: [
      "Export corporate intermediate Root CA and load into Node.js via NODE_EXTRA_CA_CERTS=/etc/ssl/certs/corp-root-ca.pem.",
      "Register an SSL Inspection Bypass Rule in corporate security console (Zscaler / Palo Alto) for designated LLM FQDNs.",
      "Enforce mutual TLS (mTLS) with client certificate authentication to establish a zero-trust tunnel."
    ],
    configSnippet: `# Dockerfile / Deployment Environment
ENV NODE_EXTRA_CA_CERTS="/etc/ssl/certs/enterprise-root-ca.pem"

# Run diagnostic verification
openssl verify -CAfile /etc/ssl/certs/enterprise-root-ca.pem /tmp/server-cert.pem`
  },

  sse_buffering: {
    title: "Server-Sent Events (SSE) Deltas Buffered into 4KB Bursts Instead of Real-Time",
    category: "HTTP Chunked Proxy Buffering",
    symptom: "Tokens do not stream smoothly to client applications. Instead, the UI hangs for several seconds and suddenly displays a 4KB chunk of tokens all at once, ruining TTFT.",
    rootCause: "Reverse proxies (such as NGINX, HAProxy, or AWS ALB) default to buffering responses to optimize TCP throughput, holding SSE JSON chunks until the buffer reaches 4096 or 8192 bytes.",
    diagnosticCommand: "curl -i -N -H 'Accept: text/event-stream' http://gateway.enterprise.internal:8200/stream",
    diagnosticCurl: "curl -i -N --no-buffer http://localhost:8200/stream",
    simulatedOutput: `HTTP/1.1 200 OK
Server: nginx/1.24.0
Date: Wed, 02 Sep 2026 22:45:00 GMT
Content-Type: text/event-stream
Transfer-Encoding: chunked
Connection: keep-alive

[Delayed by 4.2 seconds while NGINX fills 4KB socket buffer]
data: {"choices":[{"delta":{"content":"Chunk 1..."}}]}
data: {"choices":[{"delta":{"content":"Chunk 2..."}}]}
... [4096 bytes dumped simultaneously] ...`,
    remediation: [
      "Emit HTTP response header 'X-Accel-Buffering: no' directly from the streaming gateway.",
      "Include 'Cache-Control: no-cache, no-transform' to prohibit intermediate transparent caching proxies from compressing or buffering.",
      "In NGINX configuration, add 'proxy_buffering off;' and 'proxy_read_timeout 3600s;' inside the stream location block."
    ],
    configSnippet: `# NGINX Streaming Location Configuration
location /mcp/stream {
    proxy_pass http://mcp_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    
    # Disable buffering for real-time SSE deltas
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding on;
    
    # Extended read timeout for multi-turn agent runs
    proxy_read_timeout 600s;
}`
  },

  proxy_auth_407: {
    title: "Immediate HTTP 407 Proxy Authentication Required / Stripped Authorization Headers",
    category: "Egress Proxy Authentication",
    symptom: "Agent requests are intercepted with HTTP 407 before reaching internal or external MCP endpoints. Custom Bearer tokens are stripped.",
    rootCause: "Explicit forward proxies require 'Proxy-Authorization' headers with corporate NTLM or Kerberos credentials, while conflating application 'Authorization' Bearer tokens.",
    diagnosticCommand: "curl -Iv -x http://corporate-proxy.internal:8080 -U 'corp_user:pass' https://api.quilrai.com/health",
    diagnosticCurl: "curl -Iv -H 'Authorization: Bearer test-token' http://gateway:8100/mcp",
    simulatedOutput: `* Establish HTTP proxy tunnel to api.quilrai.com:443
> CONNECT api.quilrai.com:443 HTTP/1.1
> Host: api.quilrai.com:443
> User-Agent: curl/8.4.0
< HTTP/1.1 407 Proxy Authentication Required
< Proxy-Authenticate: Negotiate
< Proxy-Authenticate: NTLM
< Content-Length: 0
* The requested URL returned error: 407 Proxy Authentication Required`,
    remediation: [
      "Differentiate 'Proxy-Authorization' (proxy credentials) from 'Authorization' (MCP gateway Bearer token).",
      "Deploy corporate proxy sidecar (e.g. cntlm or px) on localhost to handle enterprise NTLM/Kerberos negotiation transparently.",
      "Ensure outbound egress firewall allows direct CONNECT tunnels on port 443 without header stripping."
    ],
    configSnippet: `# Environment Configuration for Enterprise Proxy Chaining
export HTTP_PROXY="http://corp_user:token@corporate-proxy.internal:8080"
export HTTPS_PROXY="http://corp_user:token@corporate-proxy.internal:8080"
export NO_PROXY="localhost,127.0.0.1,*.enterprise.internal"`
  }
};

export function renderTask5(container) {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h2 class="panel-title">
          Task 5: Enterprise Zero-Trust Debugging
          <span class="tag-badge tag-rose">Diagnostic Runbook</span>
        </h2>
        <p class="panel-desc">
          Interactive diagnostic triage wizard and root cause analysis engine based on the production Enterprise Debugging Playbook.
          Addresses connection drops, TLS DPI inspection, SSE chunk buffering, and proxy authentication across zero-trust networks.
        </p>
      </div>
      <div class="header-actions">
        <span class="tag-badge tag-cyan">Enterprise Architecture</span>
      </div>
    </div>

    <!-- Triage Decision Tree Navigator -->
    <div class="glass-card" style="margin-bottom: 2rem;">
      <div class="card-title">
        <span>Observed Failure Symptom Selector</span>
        <span class="tag-badge tag-rose">Step 1: Symptom Triage</span>
      </div>
      <p class="card-desc">Select an observed network or proxy failure to view root cause analysis, diagnostic commands, and enterprise remediation.</p>

      <div class="tree-options" id="t5-options-list">
        <button class="tree-option-btn selected" data-scenario="timeout_60s">
          <div>
            <div style="font-weight: 700; color: var(--accent-rose);">Symptom 1: Connection Drops at 60s / 120s During Agent Tool Execution</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">ECONNRESET or socket hangup during long-running tool queries</div>
          </div>
          <span class="tag-badge tag-amber">TCP Keepalive</span>
        </button>

        <button class="tree-option-btn" data-scenario="tls_inspection">
          <div>
            <div style="font-weight: 700; color: var(--accent-rose);">Symptom 2: TLS Handshake Hangs or Fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">Enterprise SSL deep packet inspection intercepting custom certificates</div>
          </div>
          <span class="tag-badge tag-indigo">TLS DPI</span>
        </button>

        <button class="tree-option-btn" data-scenario="sse_buffering">
          <div>
            <div style="font-weight: 700; color: var(--accent-rose);">Symptom 3: Server-Sent Events (SSE) Deltas Delivered in 4KB Bursts Instead of Real-Time</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">Reverse proxy buffering stream deltas, destroying sub-40ms TTFT</div>
          </div>
          <span class="tag-badge tag-emerald">Proxy Buffering</span>
        </button>

        <button class="tree-option-btn" data-scenario="proxy_auth_407">
          <div>
            <div style="font-weight: 700; color: var(--accent-rose);">Symptom 4: Immediate HTTP 407 Proxy Authentication Required / Header Stripping</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">Egress proxy intercepts client requests or strips custom Bearer auth headers</div>
          </div>
          <span class="tag-badge tag-cyan">Proxy Auth</span>
        </button>
      </div>
    </div>

    <!-- Active Scenario Diagnostics & Remediation Details -->
    <div class="grid-2" style="margin-bottom: 2rem;">
      <!-- Root Cause Analysis -->
      <div class="glass-card">
        <div class="card-title">
          <span id="t5-active-title">Root Cause Analysis</span>
          <span class="tag-badge tag-indigo" id="t5-active-category">Category</span>
        </div>
        <div style="margin-bottom: 1rem;">
          <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.25rem;">Observed Behavior:</div>
          <div style="font-size: 0.85rem; color: var(--text-primary);" id="t5-active-symptom">--</div>
        </div>
        <div>
          <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.25rem;">Architectural Root Cause:</div>
          <div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.6;" id="t5-active-cause">--</div>
        </div>

        <div class="remediation-box">
          <div style="font-weight: 700; color: var(--accent-emerald); font-size: 0.85rem; margin-bottom: 0.5rem;">
            &#10003; Recommended Remediation Steps:
          </div>
          <ul id="t5-remediation-list" style="padding-left: 1.25rem; font-size: 0.82rem; color: #e2e8f0; line-height: 1.6;"></ul>
        </div>
      </div>

      <!-- Diagnostic CLI & Simulated Packet Capture -->
      <div class="glass-card">
        <div class="card-title">
          <span>Diagnostic Command Generator</span>
          <button class="btn btn-primary btn-sm" id="t5-btn-simulate-trace">
            Simulate Packet Trace
          </button>
        </div>
        <p class="card-desc">Execute these low-level network triage commands on production bastion hosts.</p>

        <!-- Command Snippet 1 -->
        <div style="background: var(--bg-terminal); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.75rem; margin-bottom: 0.75rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
            <span style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono);">Packet Capture (tcpdump)</span>
            <button class="btn btn-secondary btn-sm copy-btn" id="t5-copy-tcpdump" style="padding: 0.15rem 0.5rem; font-size: 0.7rem;">Copy</button>
          </div>
          <code style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent-cyan);" id="t5-cmd-tcpdump">tcpdump ...</code>
        </div>

        <!-- Command Snippet 2 -->
        <div style="background: var(--bg-terminal); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.75rem; margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
            <span style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono);">Verbose HTTP / TLS Probe (curl)</span>
            <button class="btn btn-secondary btn-sm copy-btn" id="t5-copy-curl" style="padding: 0.15rem 0.5rem; font-size: 0.7rem;">Copy</button>
          </div>
          <code style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent-indigo);" id="t5-cmd-curl">curl ...</code>
        </div>

        <!-- Simulated Packet Output -->
        <div class="terminal-window">
          <div class="terminal-header">
            <div class="terminal-dots"><span class="terminal-dot dot-yellow"></span></div>
            <div class="terminal-title">Diagnostic Terminal Output (Simulated)</div>
            <span class="tag-badge tag-rose" id="t5-trace-badge">Triage Trace</span>
          </div>
          <div class="terminal-body" id="t5-terminal-output" style="min-height: 180px; max-height: 220px;">// Click 'Simulate Packet Trace' to inspect wire exchange...</div>
        </div>
      </div>
    </div>

    <!-- Production Configuration Blueprint -->
    <div class="glass-card">
      <div class="card-title">
        <span>Production Configuration Blueprint</span>
        <span class="tag-badge tag-emerald">Hardened Architecture</span>
      </div>
      <p class="card-desc">Drop-in configuration snippet to implement the permanent architectural resolution.</p>
      <div class="terminal-window">
        <div class="terminal-header">
          <div class="terminal-dots"><span class="terminal-dot dot-green"></span></div>
          <div class="terminal-title">Configuration Recipe</div>
          <button class="btn btn-secondary btn-sm copy-btn" id="t5-copy-config" style="padding: 0.2rem 0.6rem; font-size: 0.75rem;">Copy Snippet</button>
        </div>
        <div class="terminal-body" id="t5-config-snippet" style="min-height: 140px; max-height: 200px;">// Config snippet...</div>
      </div>
    </div>
  `;

  setupTask5Events();
  loadTask5Scenario('timeout_60s');
}

let currentScenarioKey = 'timeout_60s';

function setupTask5Events() {
  const buttons = document.querySelectorAll('.tree-option-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const key = btn.getAttribute('data-scenario');
      if (key) {
        currentScenarioKey = key;
        loadTask5Scenario(key);
      }
    });
  });

  document.getElementById('t5-btn-simulate-trace')?.addEventListener('click', () => {
    simulateTask5Trace();
  });

  document.getElementById('t5-copy-tcpdump')?.addEventListener('click', () => {
    const text = document.getElementById('t5-cmd-tcpdump')?.textContent || '';
    navigator.clipboard.writeText(text);
    window.showToast?.('Copied tcpdump command to clipboard', 'info');
  });

  document.getElementById('t5-copy-curl')?.addEventListener('click', () => {
    const text = document.getElementById('t5-cmd-curl')?.textContent || '';
    navigator.clipboard.writeText(text);
    window.showToast?.('Copied curl command to clipboard', 'info');
  });

  document.getElementById('t5-copy-config')?.addEventListener('click', () => {
    const text = document.getElementById('t5-config-snippet')?.textContent || '';
    navigator.clipboard.writeText(text);
    window.showToast?.('Copied configuration snippet to clipboard', 'info');
  });
}

function loadTask5Scenario(key) {
  const scen = TRIAGE_SCENARIOS[key];
  if (!scen) return;

  const titleEl = document.getElementById('t5-active-title');
  const catEl = document.getElementById('t5-active-category');
  const symEl = document.getElementById('t5-active-symptom');
  const causeEl = document.getElementById('t5-active-cause');
  const remList = document.getElementById('t5-remediation-list');
  const cmdDump = document.getElementById('t5-cmd-tcpdump');
  const cmdCurl = document.getElementById('t5-cmd-curl');
  const configSnip = document.getElementById('t5-config-snippet');
  const termOut = document.getElementById('t5-terminal-output');

  if (titleEl) titleEl.textContent = scen.title;
  if (catEl) catEl.textContent = scen.category;
  if (symEl) symEl.textContent = scen.symptom;
  if (causeEl) causeEl.textContent = scen.rootCause;

  if (remList) {
    remList.innerHTML = scen.remediation.map(r => `<li style="margin-bottom: 0.35rem;">${r}</li>`).join('');
  }

  if (cmdDump) cmdDump.textContent = scen.diagnosticCommand;
  if (cmdCurl) cmdCurl.textContent = scen.diagnosticCurl;
  if (configSnip) configSnip.textContent = scen.configSnippet;
  if (termOut) termOut.textContent = '// Click "Simulate Packet Trace" to view diagnostic output...';
}

function simulateTask5Trace() {
  const scen = TRIAGE_SCENARIOS[currentScenarioKey];
  if (!scen) return;

  const termOut = document.getElementById('t5-terminal-output');
  if (termOut) {
    termOut.textContent = scen.simulatedOutput;
    termOut.scrollTop = 0;
  }
  window.showToast?.(`Diagnostic trace simulated for: ${scen.category}`, 'info');
}
