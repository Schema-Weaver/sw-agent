# SW Agent Outbound Security Analysis

## 1. Outbound Connections

| Connection | Protocol | Endpoint | Direction | Purpose | Data Sent |
|------------|----------|----------|-----------|---------|-----------|
| **Wake Channel** | SSE over HTTPS | `GET /api/agent/wake` | Agent → Cloud | Persistent SSE stream for wake events | `Bearer <agent_token>` (header), `X-Agent-Id` (header) |
| **Data Channel** | WSS | `wss://.../api/agent/data` | Agent → Cloud | On-demand WebSocket for query execution | Short-lived `data_channel_token` (query param + Bearer header), `agent_id` (query param), `session` (query param) |
| **Audit Upload** (stub) | HTTPS | Configured cloud URL | Agent → Cloud | (Not implemented) | Would send audit events |

### Key Findings:
- **Only outbound connections.** Agent never opens a listening socket.
- WSS URL is derived from `cloud_url` in machine config (`wss://` → `wss://`, `https://` → `wss://`).
- Data channel token is **short-lived** (expires after a few minutes, delivered via SSE wake event).
- No HTTP polling or REST fallback — purely SSE + WSS.

## 2. Inbound Connections

| Type | Port | Status |
|------|------|--------|
| TCP Listener | Any | **NONE** — agent never calls `server.listen()` |
| UDP Listener | Any | **NONE** |
| Unix Socket | Any | **NONE** |
| Named Pipe | Any | **NONE** |

**Verdict:** The agent accepts **zero** inbound connections. All communication is outbound-only.

## 3. External Discoverability

| Attack Vector | Possible? | Why |
|---------------|-----------|-----|
| Port scan finds agent | **No** | No listening ports |
| Probe cloud relay for agent list | **Partially** | Cloud relay knows which agent tokens are connected, but this requires compromising the relay or having valid credentials |
| Guess agent token | **Extremely unlikely** | 32 base62 chars = 62^32 ≈ 2.27 × 10^57 combinations |
| Enumerate agent IDs | **Partially** | Agent ID format is `agt_<label>_<8hex>` — label is guessable (hostname), but 8 hex chars = 16^8 = 4.29 billion |
| DNS SRV / discovery | **No** | No DNS discovery mechanism |

**Verdict:** The tunnel is not directly discoverable from the internet. The only exposure surface is the cloud relay itself.

## 4. Token Exposure Risk

| Token | Where It Travels | In Logs? | Risk |
|-------|------------------|----------|------|
| `agent_token` (long-lived) | **SSE:** `Authorization: Bearer <token>` header | **HTTP server logs** may capture this header. **NOT** in URL query params — safe from URL logging | Medium — appears in HTTP headers, but not in URL |
| `data_channel_token` (short-lived) | **WSS:** `?token=...` query param **AND** `Authorization: Bearer <token>` header | **YES** — query params appear in **web server access logs, proxy logs, CDN logs** | High — exposed in URL query params |
| `agent_id` | SSE header `X-Agent-Id`, WSS query param | Headers less likely to be logged, but query param appears in logs | Low |

### Critical Finding: Data Channel Token in Query Param
`data-channel.ts` line 68:
```ts
url.searchParams.set('token', this.opts.dataChannelToken);
```

This is a **major exposure**. The short-lived data channel token appears in the WSS URL query string, which means:
- Reverse proxy access logs capture it
- CDN logs capture it  
- Browser DevTools "Network" tab shows it (if relay is web-based)
- Server error logs may include the URL on connection failures

**Mitigation:** Move the token entirely to the `Authorization` header (which already exists at line 95) and remove the query param.

## 5. Malicious Relay / MITM Injection Risk

| Threat | Current Mitigation | Gap |
|--------|---------------------|-----|
| **Message spoofing** | `validateMessage()` checks envelope structure (v=1, valid type, required fields, max lengths) | No **cryptographic signature** on messages. Anyone who can inject into the WSS stream can send valid-looking messages. |
| **Role spoofing** | Browser sends `user.role`, but agent re-classifies SQL via `classifyStatement()` and checks `hasCapability(role, capability)` | No **cloud attestation** of the role. If MITM can send a message with `role: admin`, the agent will process it. |
| **Replay attack** | Message ID is a UUID, but no nonce or timestamp window check | An attacker could replay old messages with new IDs. |
| **Command injection** | `validateMessage()` + `validatePayload()` checks type-specific fields | No **origin verification** — no way to verify the message came from the legitimate cloud relay. |
| **Wake event spoofing** | `validateAndTriggerWake()` checks `wake_id`, `reason`, `queued_at`, `data_channel_token` fields exist | No signature on wake events. SSE stream is HTTPS but no additional auth on individual events. |
| **Cloud relay compromise** | If cloud relay is compromised, attacker has access to all agent tokens and can send wake events | **No out-of-band verification** of relay identity. Agent blindly trusts the configured cloud URL. |

### Key Gaps:
1. **No message signing or HMAC** — messages are plain JSON over WSS (TLS protects in transit but not from relay compromise).
2. **No origin verification** — agent doesn't verify the WSS peer is the legitimate cloud relay (could be mitigated with certificate pinning).
3. **Role is self-reported** by browser and forwarded by cloud; agent trusts it without cloud attestation.

## 6. Data Flow OUT of the Agent

| Data Type | Leaves Agent? | Where It Goes | Notes |
|-----------|---------------|---------------|-------|
| **DB credentials** | **No** | N/A | `password_stored` / `password_env` never leave local machine. Agent resolves env vars locally. |
| **Query results** | **Yes** | WSS → Cloud → Browser | `response` messages contain full query result data, row counts, execution time |
| **Schema introspection** | **Yes** | WSS → Cloud → Browser | `introspect` returns full table/column/index metadata |
| **SQL statements** | **Yes** | WSS → Cloud → Browser | `query` and `stream_query` messages contain the SQL. Also in audit logs (fingerprint + preview). |
| **Audit events** | **Partially** (stub) | Local disk + optional cloud upload | `statement_preview` (first 200 chars of SQL) and `statement_fingerprint` (SHA256) go to local audit log. Cloud upload is a stub. |
| **Error details** | **Yes** | WSS → Cloud → Browser | PostgreSQL error codes, severity, detail, hint, position |
| **Migration results** | **Yes** | WSS → Cloud → Browser | Statement-by-statement status, affected rows, errors |
| **Agent metadata** | **Yes** | SSE + WSS headers | Agent ID, agent token (see Token Exposure section) |
| **Machine config** | **No** | N/A | `cloud_url`, `default_permission`, `machine_label` stay local |

### Critical Finding: No PII Redaction on Query Results
The `response` and `stream_chunk` payloads contain **raw query result data** without any PII redaction. If a browser user queries a table containing sensitive data (emails, SSNs, etc.), that data flows through the cloud relay unredacted.

The `audit/redact.ts` module only redacts SQL previews (truncates to 200 chars) and creates fingerprints — it does NOT touch query result data.

### What DOESN'T Leave the Machine:
- `databases.config.json` (DB credentials, connection strings)
- `sw-agent.config.json` (agent token, machine config)
- `password_env` values (resolved from environment variables at runtime, never transmitted)
- Full filesystem paths (only project names, db aliases, and relative paths)

---

## 7. Threat Matrix

| Threat | Vector | Likelihood | Impact | Current Mitigation | Recommended Fix |
|--------|--------|------------|--------|---------------------|---------------|
| **Data channel token leaked in WSS URL** | Query params logged by proxies/CDN/servers | High | High | Short-lived (minutes) | Move token to header only; remove query param |
| **Agent token leaked in SSE headers** | HTTP server logs capture Authorization header | Medium | Critical | None | Implement token rotation; use mTLS instead of Bearer tokens |
| **Malicious cloud relay injects commands** | Compromised or malicious cloud relay | Low | Critical | Message validation (structure only) | Add message signing (HMAC-SHA256) with shared secret; implement certificate pinning |
| **Role spoofing via MITM** | Attacker sends messages with `role: admin` | Medium | High | Capability checks + anti-spoofing (re-classifies SQL) | Cloud attestation: cloud signs user role in message; agent verifies signature |
| **Replay attack** | Attacker captures and replays old WSS messages | Medium | Medium | UUID message IDs (no nonce) | Add timestamp window validation (±30s) + nonce deduplication cache |
| **Query result PII exposure** | Cloud relay logs or compromised relay sees raw query data | Medium | High | None | Implement PII column redaction (configurable per column); encrypt sensitive result cells |
| **Dev token exposure** | `swagt_DEV_LOCAL_ONLY` is hardcoded | High (dev) | Medium | Token format check allows it | Remove dev token from production builds; enforce production-only tokens |
| **Cloud relay MITM** | Attacker intercepts TLS to cloud relay | Low | Critical | HTTPS/WSS TLS | Certificate pinning for known relay CAs; mTLS (client cert) for agent authentication |
| **Audit log tampering** | Local attacker modifies `audit.jsonl` | Low | Medium | Hash-chain with SHA-256 (prev_hash) | Sign audit entries with agent private key; store signatures |
| **SQL injection via browser** | Malicious SQL in query payload | Low | High | Statement classification + intent validation + parameterization | Add parameterized query enforcement (reject non-parameterized queries); SQL injection detection |
| **Idle WSS hijacking** | Attacker reconnects to idle WSS before timeout | Very Low | Medium | 60s idle timeout | Shorten idle timeout; add session binding (token + session fingerprint) |
| **Agent token brute-force** | Attacker guesses token | Very Low | Critical | 32-char base62 token | Rate limiting on token validation; implement token rotation |
| **Local config file exposure** | `databases.config.json` or `sw-agent.config.json` readable | Medium | High | `0o600` permissions | Add file encryption at rest; support OS keychain integration |
| **Wake event SSE stream poisoning** | Attacker injects fake wake events | Low | Medium | Field validation (structure only) | Sign wake events with cloud private key; agent verifies signature |
| **Query timeout DoS** | Attacker sends queries with `timeout_ms: 0` or huge values | Low | Medium | `timeout_ms` validated as non-negative number | Enforce max timeout (e.g., 300s) on agent side; reject unreasonable timeouts |
| **Cell truncation data leak** | Large cells truncated to 1MB; truncation info leaks | Very Low | Low | `has_truncated_cells` flag | Redact truncated content markers; don't reveal truncation in public responses |
| **Migration plan registration abuse** | Attacker registers large plans | Low | Low | Max 500 statements, 1MB each | Add rate limiting on plan registration; implement plan expiration |

---

## 8. Architecture Trust Model (Actual vs. Claimed)

**Claimed (from ARCHITECTURE.md):**
- Browser is untrusted
- Cloud relay is semi-trusted
- Agent is fully trusted
- Credentials never leave the machine

**Actual (from code analysis):**
- ✅ Browser is untrusted (anti-spoofing re-classifies SQL)
- ⚠️ Cloud relay is **more trusted than claimed** — agent has no way to verify relay identity beyond TLS
- ⚠️ Agent is trusted but **no tamper-evident audit** (hash chain exists but no signing)
- ✅ Credentials never leave the machine (DB passwords stay local)
- ⚠️ BUT: query results flow through cloud relay unredacted, creating a data exposure path
- ⚠️ User role is **self-reported** by browser and forwarded by cloud; no cryptographic attestation

---

## 9. Summary: Top 5 Security Priorities

1. **🔴 CRITICAL: Move data channel token from query param to header only** — currently exposed in WSS URL
2. **🔴 CRITICAL: Implement message signing (HMAC)** — prevent relay/MITM command injection
3. **🟠 HIGH: Add PII redaction for query results** — prevent sensitive data exposure through cloud relay
4. **🟠 HIGH: Implement certificate pinning / mTLS** — verify cloud relay identity
5. **🟡 MEDIUM: Add cloud attestation of user roles** — prevent role spoofing
