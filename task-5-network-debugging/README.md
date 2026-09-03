# Task 5: Enterprise Zero-Trust Debugging Playbook

Comprehensive technical field playbook and isolation strategy for troubleshooting Model Context Protocol (MCP) and LLM Gateway deployments in enterprise zero-trust corporate networks.

---

## Deliverable Document

The complete architectural guide and runbook is located in:
**[ENTERPRISE_DEBUGGING_PLAYBOOK.md](./ENTERPRISE_DEBUGGING_PLAYBOOK.md)**

---

## Playbook Structure Overview

### 1. Executive Incident Summary & Problem Anatomy
- Incident framing for multi-turn agent tool executions hanging behind egress proxies.
- Rapid Triage Matrix mapping symptoms to CLI diagnostic commands.

### 2. Live Diagnostic Toolkit & Real-Time Inspection Commands
- **Packet Capture**: `tcpdump` and `tshark` commands capturing TLS handshakes, TCP RST/FIN flags, and retransmissions.
- **Socket Health**: `ss -tiepm` and `netstat` diagnosing silent half-open TCP states, unacknowledged Send-Q buffers, and timer states.
- **System Call Tracing**: `strace` isolating blocking `epoll_wait` and `read` system calls.
- **mTLS Verification**: `openssl s_client` and `curl -ivv` inspecting proxy CONNECT tunnels, certificate chains, and SSL MITM inspection proxies.

### 3. Systematic Root Cause Isolation Decision Tree
- **Branch 1: mTLS Handshake & Session Expiration Level**: Corporate SSL inspection cert stripping, TLS 1.3 renegotiation drops, and air-gapped OCSP timeouts.
- **Branch 2: Intermediate Proxy SSE & Idle Connection Timeouts**: Reverse proxy response buffer deadlocks, 60s TCP idle timeouts during long tool runs, and missing keepalives.
- **Branch 3: LLM Context Window Truncation & Silent Resets**: Token expansion across turns, mid-JSON truncation on max tokens limit, and protocol desynchronization.

### 4. Architectural Remediation & Transport Redesign
- **Keepalive Architecture**: Application-level SSE comment frames (`: ping\n\n`) and Linux kernel TCP keepalive tuning (`net.ipv4.tcp_keepalive_time=15`).
- **Transport Modernization**: HTTP/2 multiplexing vs WebSockets migration with protocol-level ping/pong frames.
- **Resilience**: Idempotency keys (`Idempotency-Key`) for safe tool retries and exponential backoff with full jitter.
- **Proxy Configuration**: Buffer bypass (`X-Accel-Buffering: no`), proxy timeout extension, and mTLS inspection bypass rules.

### 5. Field Engineering 15-Minute Emergency Runbook
- Rapid diagnostic protocol for on-site client triage sessions.
