# Enterprise Zero-Trust MCP & LLM Gateway Debugging Playbook
## Production Troubleshooting, Root Cause Isolation, and Transport Resilience

- **Author**: Forward Deployed Engineering (FDE) Architecture Team
- **Target Systems**: Model Context Protocol (MCP) Gateways, LLM Reverse Proxies, Enterprise Egress Infrastructure
- **Scenario**: Multi-turn agent tool executions experience intermittent connection drops and hanging requests inside an enterprise zero-trust network behind strict egress proxies.

---

## 1. Executive Incident Summary & Problem Anatomy

### 1.1 The Incident Framing
In an enterprise zero-trust environment, AI agent workflows operate as multi-turn conversational graphs:
1. Agent submits user prompt to LLM Gateway.
2. LLM decides to invoke an external MCP tool (e.g. querying a customer record or triggering a financial workflow).
3. The MCP Gateway executes the tool. For complex workflows (e.g. multi-step database lookups, code execution, or human-in-the-loop approvals), tool execution latency can span 15 to 120 seconds.
4. The tool result returns to the LLM Gateway to generate subsequent tokens.

### 1.2 Failure Symptom
During multi-turn tool execution, requests hang indefinitely. Client applications eventually crash with socket hang-up errors (`ECONNRESET`, `ETIMEDOUT`, or empty `504 Gateway Timeout` responses). The issue appears intermittent, correlating with tool calls taking longer than 30 seconds.

### 1.3 High-Level Triage Matrix

| Failure Domain | Primary Symptom | Key Signature | CLI Verification Command |
|---|---|---|---|
| **mTLS / SSL Inspection** | Connection fails at start or renegotiation | TLS alert 46 / 48; handshake reset | `openssl s_client -connect ... -tlsextdebug` |
| **Proxy Idle Timeout** | Drops after 30s to 60s of silence | Upstream sends TCP RST after idle period | `tcpdump -nnvv -i any 'tcp[tcpflags] & (tcp-rst) != 0'` |
| **Proxy Buffer Deadlock** | Response data never reaches client | Server-Sent Events (SSE) buffered in proxy memory | `curl -ivv -N -H "Accept: text/event-stream"` |
| **Silent Half-Open TCP** | Socket stays `ESTABLISHED` with no traffic | Send-Q > 0, unacknowledged segments | `ss -tiepm '( dport = :443 or sport = :443 )'` |
| **Context Window Truncation** | LLM response cuts off mid-JSON | Missing closing bracket `}` in tool payload | Token accounting audit vs model context limit |

---

## 2. Live Diagnostic Toolkit & Real-Time Inspection Commands

When responding on-site or during a live customer triage bridge, use the following Linux CLI commands in sequence.

### 2.1 Network Packet & TCP Flag Inspection (`tcpdump` & `tshark`)

#### Capture Full Packet Traces on Streaming / MCP Ports
Capture raw traffic between the agent client, intermediate egress proxy, and gateway:
```bash
# Capture full packet payload (-s 0) on interface eth0, filtering on gateway ports
sudo tcpdump -i eth0 -s 0 -nnvv -w /tmp/mcp_troubleshoot.pcap \
  "tcp port 443 or tcp port 8443 or tcp port 8000"
```

#### Real-Time TCP RST (Reset) and FIN Isolation
Detect if an intermediate proxy or stateful firewall is silently injecting `RST` packets:
```bash
# Filter specifically for TCP RST or TCP FIN flags
sudo tcpdump -i any -nn "tcp[tcpflags] & (tcp-rst|tcp-fin) != 0"
```

#### TShark Flow Analysis: Dissecting Disconnections
Extract TCP retransmissions, zero-window probes, and connection resets:
```bash
# Analyze captured pcap file for connection resets and retransmissions
tshark -r /tmp/mcp_troubleshoot.pcap -Y \
  "tcp.flags.reset==1 or tcp.analysis.retransmission or tcp.analysis.zero_window" \
  -T fields -e frame.time -e ip.src -e ip.dst -e tcp.srcport -e tcp.dstport -e tcp.flags
```

### 2.2 Socket State & Connection Health Inspection (`ss` & `netstat`)

#### Detecting Silent Half-Open Sockets
When an egress proxy drops a connection without sending a `FIN` packet, the client socket remains in `ESTABLISHED` while the server has already discarded the state:
```bash
# Display detailed socket timers, keepalives, and unacknowledged queues
ss -tiepm state established '( dport = :443 or sport = :443 )'
```
- **Diagnostic Signals**:
  - `Send-Q > 0`: Bytes written by the gateway are buffered in the OS socket buffer but never acknowledged (`ACK`) by the proxy.
  - `timer:(keepalive,...)`: Verifies whether TCP keepalive probes are actively configured on the socket.

#### Checking Sockets in Lingering States
```bash
# Check for sockets stuck in CLOSE_WAIT, FIN_WAIT_1, or LAST_ACK
ss -tan state close-wait state fin-wait-1
```

### 2.3 Process & System Call Tracing (`strace`)

Trace the Gateway process to identify if it is blocked on `read()`, `epoll_wait()`, or waiting on downstream tool execution:
```bash
# Trace network-related system calls on a running Gateway PID
sudo strace -f -tt -T -p <GATEWAY_PID> -e trace=network,poll,epoll_wait,read,write
```
- **Diagnostic Signals**:
  - Process spends >60s inside `epoll_wait()`: Upstream tool call is blocking; proxy idle timer is at risk of expiring.
  - `read(...) = 0`: Immediate socket EOF received (remote end closed connection gracefully).
  - `write(...) = -1 ECONNRESET (Connection reset by peer)`: Proxy or downstream forcibly tore down TCP connection.

### 2.4 TLS & mTLS Handshake Verification (`openssl s_client` & `curl`)

#### Testing Complete Connection Path through Corporate Egress Proxy
```bash
# Test mTLS connectivity directly through an enterprise HTTP CONNECT proxy
curl -ivv --proxy http://proxy.corp.internal:8080 \
  --cacert /etc/ssl/certs/corp-ca.pem \
  --cert /etc/ssl/certs/client-mcp.crt \
  --key /etc/ssl/certs/client-mcp.key \
  https://mcp-gateway.production.internal/v1/tools/list
```

#### Detailed OpenSSL Handshake Inspection & Certificate Chain Validation
Verify TLS cipher suite negotiation, SNI matching, and certificate chain validity:
```bash
openssl s_client -connect mcp-gateway.production.internal:443 \
  -proxy proxy.corp.internal:8080 \
  -servername mcp-gateway.production.internal \
  -CAfile /etc/ssl/certs/corp-ca.pem \
  -cert /etc/ssl/certs/client-mcp.crt \
  -key /etc/ssl/certs/client-mcp.key \
  -tls1_3 -showcerts -tlsextdebug
```
- **Diagnostic Signals**:
  - `Verify return code: 0 (ok)`: CA trust chain is intact.
  - `Verify return code: 19 (self signed certificate in certificate chain)`: Corporate SSL interception proxy is terminating TLS and replacing certificates with an untrusted corporate root.
  - `SSL_ERROR_WANT_READ` or TLS Alert 40/46: Client certificate rejected by mutual TLS policy.

---

## 3. Systematic Root Cause Isolation Decision Tree

When requests hang during multi-turn tool execution, follow this decision tree to isolate the exact layer of failure.

```
                  [Multi-Turn Request Hangs]
                              │
                              ▼
                Run Live Diagnostic Tracing
          (tcpdump + ss -tiepm + curl -ivv)
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
[Failure at Handshake] [Drops After Silence] [Abrupt Mid-Stream Cut]
         │                    │                    │
         ▼                    ▼                    ▼
    [BRANCH 1]           [BRANCH 2]           [BRANCH 3]
  mTLS / Security     Proxy Idle Timeout &   LLM Context Truncation
Inspection Proxy       Buffer Accumulation     & Protocol Desync
```

---

### Branch 1: mTLS Handshake & Session Expiration Level

#### Symptoms
- Connection fails immediately upon socket establishment or periodically during mid-stream session ticket renegotiation.
- Error messages: `SSL routine:tls_process_server_certificate:certificate verify failed` or `SSL alert number 46 (certificate unknown)`.

#### Root Cause Analysis
1. **Corporate SSL Interception (MITM) Mismatch**: Strict zero-trust egress firewalls (e.g. Zscaler, Palo Alto Networks) decrypt outbound HTTPS traffic. If the proxy decrypts an mTLS connection, it strips the client certificate, causing the downstream MCP Gateway to reject the connection.
2. **Session Ticket / TLS Renegotiation Drop**: Some enterprise proxies disable TLS session resumption or drop connections when TLS 1.3 session tickets are exchanged after handshakes.
3. **Certificate Revocation Checking (CRL/OCSP) Timeout**: If the gateway is in an air-gapped subnet and attempts online OCSP validation without outbound internet access, the handshake blocks until timing out (typically 30 seconds).

#### Verification Tests
- Check if the issuer matches the expected internal PKI:
  ```bash
  openssl s_client -connect mcp-gateway.internal:443 | grep -E "depth|issuer"
  ```
- If the issuer contains `CN = Corporate Forward Untrusted CA` or third-party firewall vendor signatures, the connection is being intercepted and broken.

---

### Branch 2: Intermediate Egress Proxy SSE / Idle Connection Timeout

#### Symptoms
- Fast tool calls (<5 seconds) succeed consistently.
- Long-running multi-turn tool executions (e.g. database schema migrations, code compilation, deep web research taking >30 seconds) hang.
- Client receives `HTTP 504 Gateway Timeout` or sudden `TCP RST` exactly 30, 60, or 120 seconds after the request started.

#### Root Cause Analysis
1. **Proxy TCP Idle Timeout**: Intermediate egress proxies (Squid, Envoy, AWS ALB, NGINX) enforce an idle timeout on HTTP connections (frequently 60 seconds). If neither the client nor server sends bytes while the MCP tool executes, the proxy terminates the connection.
2. **Reverse Proxy Response Buffering**: By default, NGINX and standard proxies buffer responses (`proxy_buffering on`). In Server-Sent Events (SSE) or chunked streams, the proxy holds chunks in internal memory until a 4KB/8KB buffer fills. To the client, the stream appears completely hung.
3. **Missing TCP Keepalive Probes**: Without OS-level keepalive packets, firewall connection tracking tables (conntrack) evict the idle NAT entry, resulting in silent packet drops.

#### Verification Tests
- Run `curl` with non-buffered flag `-N`:
  ```bash
  curl -ivv -N -X POST http://mcp-gateway:8000/v1/tools/call ...
  ```
- If `-N` allows tokens to appear immediately, the intermediate proxy is buffering SSE frames.
- Run `tcpdump` during an idle period. If no packets traverse the wire for 60 seconds followed by a `RST` from the proxy IP, the root cause is an **idle connection timeout**.

---

### Branch 3: LLM Context Window Truncation & Silent Socket Resets

#### Symptoms
- The connection drops specifically on turn 4, 5, or 6 of a multi-turn conversation.
- The client receives an incomplete JSON payload: e.g. `{"tool_call": {"name": "query_db", "arguments": {"query": "SELECT * FROM ...` without closing braces.
- The JSON parser throws `SyntaxError: Unexpected end of JSON input`.

#### Root Cause Analysis
1. **Context Window Saturation**: As the conversation history expands with verbose tool outputs (e.g. large SQL result sets or logs), the total token count exceeds the model's context window limit (e.g. 8k, 32k, or 128k tokens).
2. **Max Tokens Limit Reached**: The upstream provider truncates the response midway when reaching `max_tokens`. The upstream provider sends `finish_reason: "length"` instead of `finish_reason: "tool_calls"`.
3. **JSON-RPC Desynchronization**: The client remains blocked waiting for the terminating newline or closing bracket, eventually timing out.

#### Verification Tests
- Inspect the prompt token consumption of the failing turn.
- Calculate: `prompt_tokens + max_tokens >= model_context_window`.
- Check if upstream response contains `finish_reason: "length"`.

---

## 4. Architectural Remediation & Transport Redesign

To eliminate connection drops and hanging requests permanently, implement the following architectural mitigations.

### 4.1 Keepalive & Heartbeat Architecture

#### Application-Level SSE Heartbeat Frames
To prevent intermediate proxies from dropping idle streaming connections while an MCP tool executes, the Gateway must inject periodic comment frames. In the SSE specification, lines starting with a colon (`:`) are comments and ignored by standard client parsers:

```
event: tool_start
data: {"tool": "long_database_query"}

: ping (emitted every 10 seconds to reset proxy idle timer)

: ping (emitted every 10 seconds)

event: tool_result
data: {"status": "success", "rows": 120}
```

#### Gateway SSE Heartbeat Implementation (TypeScript)
```typescript
function startSseHeartbeat(res: http.ServerResponse, intervalMs = 15000): NodeJS.Timeout {
  return setInterval(() => {
    if (!res.writableEnded) {
      // Comment line resets intermediate proxy TCP idle timers
      res.write(": ping\n\n");
    }
  }, intervalMs);
}
```

#### Operating System TCP Keepalive Tuning
Configure low-level TCP socket keepalives on all Gateway endpoints to keep stateful firewall conntrack tables active:
```bash
# Tune Linux kernel TCP keepalive parameters
sudo sysctl -w net.ipv4.tcp_keepalive_time=15    # Send first probe after 15s of silence
sudo sysctl -w net.ipv4.tcp_keepalive_intvl=5    # Resend probe every 5s if unacknowledged
sudo sysctl -w net.ipv4.tcp_keepalive_probes=3   # Drop connection after 3 failed probes
```

In Node.js socket configuration:
```typescript
server.on("connection", (socket) => {
  socket.setKeepAlive(true, 15000); // 15-second keepalive probe
});
```

---

### 4.2 Transport Modernization: HTTP/2 & Bidirectional WebSockets

For enterprise multi-turn workflows, replace basic HTTP/1.1 chunked transport with modern, multiplexed protocols.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Transport Protocol Comparison                      │
├──────────────────┬─────────────────┬────────────────────────────────────┤
│ Protocol         │ Multiplexing    │ Connection Resiliency              │
├──────────────────┼─────────────────┼────────────────────────────────────┤
│ HTTP/1.1 (Chunk) │ No (HOL Block)  │ Poor: prone to proxy idle drops    │
│ HTTP/2           │ Yes (Streams)   │ High: native PING frames & mux     │
│ WebSockets (WSS) │ Full Duplex     │ Maximum: bidirectional heartbeat   │
└──────────────────┴─────────────────┴────────────────────────────────────┘
```

#### Benefits of WebSocket Migration for Multi-Turn MCP
- **Native Ping/Pong Frames**: Protocol-level opcodes (`0x9` Ping / `0xA` Pong) maintain proxy state without interfering with payload serialization.
- **Persistent Bi-Directional Session**: Tool executions can send asynchronous progress notifications (`progress: 45%`) back to the client while running.
- **Connection Re-establishment**: Built-in state machine enables transparent reconnection without abandoning the multi-turn agent thread.

---

### 4.3 Resilience: Idempotency Keys & Exponential Backoff

When network drops inevitably occur in enterprise environments, clients must retry safely without triggering duplicate actions (e.g. duplicate financial refunds or repeated database writes).

#### 1. Idempotency Token Header
Every state-changing tool call must include a unique idempotency key:
```http
POST /v1/tools/call HTTP/1.1
Host: mcp-gateway.production.internal
Idempotency-Key: 9f8a3c42-2b61-4c12-9c17-8e6f11223344
Content-Type: application/json

{
  "name": "trigger_refund",
  "arguments": { "customer_id": "CUST-10001", "amount": 100.0, "reason": "Return" }
}
```

#### 2. Exponential Backoff with Jitter (Full Jitter Algorithm)
```typescript
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
  baseDelayMs = 500,
  maxDelayMs = 8000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) {
        throw err;
      }
      // Full jitter: uniform random backoff between 0 and min(maxDelay, base * 2^attempt)
      const maxJitter = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const backoff = Math.floor(Math.random() * maxJitter);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}
```

---

### 4.4 Enterprise Egress Proxy Configuration Best Practices

Ensure the corporate infrastructure team applies the following configurations on reverse proxies and egress gateways (NGINX, Envoy, Squid):

#### 1. Disable Response Buffering
Add the buffering bypass header in all Gateway responses:
```http
X-Accel-Buffering: no
```

In NGINX egress configuration:
```nginx
location /v1/tools/stream {
    proxy_pass http://mcp_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;      # Extend idle timeout to 5 minutes
    proxy_send_timeout 300s;
    chunked_transfer_encoding on;
}
```

#### 2. Configure Proxy Bypass / Direct Allowlisting for MCP Endpoints
In zero-trust architectures using Zscaler or Palo Alto GlobalProtect:
- Request an **SSL Inspection Bypass Rule** for the specific domain `*.mcp-gateway.corp.internal`.
- This ensures mutual TLS (mTLS) client certificates pass directly to the Gateway without termination or MITM stripping.

---

## 5. Field Engineering Runbook (Emergency Triage Protocol)

Follow this 15-minute diagnostic drill during live customer escalations:

```
[Minute 0-3] Verify Physical & TLS Connectivity
  └─ curl -ivv --proxy $PROXY https://$GATEWAY/health
     Check: HTTP 200 vs 401/403 vs 504. Look for TLS issuer identity.

[Minute 4-7] Validate Streaming & Proxy Buffering
  └─ curl -ivv -N -X POST https://$GATEWAY/v1/stream -d '{"prompt":"ping"}'
     Check: Do chunks stream incrementally, or does curl block until the end?

[Minute 8-11] Inspect Active Sockets & Queue Saturation
  └─ ss -tiepm state established '( dport = :443 )'
     Check: Is Send-Q accumulating? Are keepalive timers ticking?

[Minute 12-15] Check Upstream Packet Reset Injection
  └─ sudo tcpdump -nn -i any "tcp[tcpflags] & tcp-rst != 0"
     Check: Who sent the RST packet? (Client IP, Proxy IP, or Gateway IP?)
```
