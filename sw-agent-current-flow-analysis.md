# SW Agent — Current Connection Flow Analysis

## 1. Component map

```text
Browser Client                           Mock Relay                             SW Agent                            PostgreSQL DB
(tests/e2e/browser-client.ts)            (dev/mock-relay.ts)                    (channels/agent-session.ts)         (execution/query-runner.ts)
      |                                        |                                        |                                 |
      |--- WSS Connect (/wss) ---------------->|                                        |                                 |
      |                                        |<--- HTTP GET (/agent/wake) ------------|                                 |
      |                                        |     (channels/wake-channel.ts)         |                                 |
      |                                        |                                        |                                 |
      |                                        |--- SSE: WakeEvent (auto-ping) -------->|                                 |
      |                                        |                                        |                                 |
      |                                        |<--- WSS Connect (/agent/data) ---------|                                 |
      |                                        |     (channels/data-channel.ts)         |                                 |
      |                                        |                                        |                                 |
      |--- WSS Message (JSON) ---------------->|                                        |                                 |
      |                                        |--- WSS Binary Forward ---------------->|                                 |
      |                                        |                                        |--- Execute SQL Query ---------->|
      |                                        |                                        |<-- Return Query Result ---------|
      |                                        |<-- WSS Binary Response ----------------|                                 |
      |<-- WSS Message (JSON) Broadcast -------|                                        |                                 |
```

## 2. Agent side: how it connects

The SW Agent is designed to maintain a lightweight, persistent connection to the cloud relay. It utilizes two distinct communication channels: a unidirectional Server-Sent Events (SSE) channel for wake events, and a bidirectional WebSocket (WSS) channel for heavy data transfer.

**Relay URL Configuration:**
The agent determines which relay to connect to at startup. The resolution logic resides in `src/cli/commands/start.ts`. It first checks for a `--relay` command-line argument. If none is provided, it falls back to the `cloud_url` property stored in the machine configuration file (`sw-agent.config.json`).
```typescript
let relayUrl = opts.relayUrl;
const relayIdx = args.indexOf('--relay');
if (relayIdx !== -1 && relayIdx + 1 < args.length) {
  relayUrl = args[relayIdx + 1];
}
if (!relayUrl) {
  relayUrl = machineConfig.cloud_url;
}
```

**Agent ID and Token Source:**
Both the `agent_id` and `agent_token` are fundamental for identifying the agent to the relay. These values are loaded into memory via `loadMachineConfig()` in `src/config/machine-config.ts`. They are persisted in the `sw-agent.config.json` file created during the initial setup of the agent.

**SSE Connection URL (Wake Channel):**
The initial connection the agent establishes is the Wake Channel. This is an HTTP GET request that is upgraded to an SSE stream, keeping a persistent, low-bandwidth socket open. 
The target URL is constructed dynamically: `https://<relay-domain>/agent/wake`. 
Importantly, authentication is not passed via the URL query string; instead, it is safely transmitted via HTTP headers:
```typescript
const headers: Record<string, string> = {
  'Authorization': `Bearer ${this.opts.token}`,
  'X-Agent-Id': this.opts.agentId,
  'Accept': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
};
```
*(Located in `src/channels/wake-channel.ts`, lines 244-250)*

**WSS Connection URL (Data Channel):**
When the relay needs the agent to process a request (e.g., from a browser client), it sends a `WakeEvent` down the SSE connection. This event contains a short-lived `data_channel_token`. Upon receiving this, the agent immediately initiates a new WebSocket connection to handle the incoming request.
The target URL is: `wss://<relay-domain>/agent/data?token=<data_channel_token>&agent_id=<agent_id>&session=<browser_session_id>`.
Authentication is passed both in the query string and through headers to ensure broad compatibility while maintaining strict security checks.
```typescript
const url = new URL(targetUrl);
url.searchParams.set('token', this.opts.dataChannelToken);
url.searchParams.set('agent_id', this.opts.agentId);
url.searchParams.set('session', this.opts.browserSessionId);

this.ws = new WebSocket(url.toString(), {
  headers: {
    'Authorization': `Bearer ${this.opts.dataChannelToken}`,
    'X-Agent-Id': this.opts.agentId,
  },
  handshakeTimeout: 10_000,
  perMessageDeflate: true,
});
```
*(Located in `src/channels/data-channel.ts`, lines 67-100)*

**Disconnect and Reconnect Logic:**
Robustness is built into the `WakeChannel`. If the SSE connection drops, the agent relies on a `runLoop()` utilizing a `Backoff` utility to pace reconnection attempts with jitter to prevent thundering herd scenarios. Additionally, there is a keepalive timer that expects a payload at least every 5 minutes (`DEFAULTS.WAKE_KEEPALIVE_MS`). If silence exceeds this duration, the socket is forcibly destroyed and reconnected. Reconnections will continue infinitely unless the relay explicitly responds with a 401 or 403 HTTP status, which signifies a fatal authentication failure and stops the reconnect loop.

## 3. Browser side: how it connects (today, via mock relay)

The browser acts as the remote client, querying databases connected to the agent. Today, this interaction is simulated via `BrowserClient` inside end-to-end tests.

**Browser WSS URL:**
The browser directly connects to the relay's WebSocket server intended for frontend clients. It establishes a connection to the `/wss` endpoint.
```typescript
const wsUrl = mockRelayUrl.replace(/^http/, 'ws') + '/wss';
this.ws = new WebSocket(wsUrl);
```
*(Located in `src/tests/e2e/browser-client.ts`, lines 16-17)*

**Specifying the Target Agent:**
In the current implementation, the browser is incredibly naive. It does not actively specify which agent it intends to communicate with at the connection level. While the messages it sends contain fields like `project`, the relay completely ignores them and simply routes data to whatever agent is currently connected.

**Authentication:**
There is no authentication mechanism implemented for the browser client today. The connection to `/wss` is unauthenticated; it does not require a JWT, session cookie, or specialized headers. Any script capable of opening a WebSocket connection to the mock relay's `/wss` endpoint can inject messages into the agent's stream.

## 4. Mock relay: what it does today

The mock relay acts as the middleman for local development and testing, bridging the browser and the agent. It is a highly simplified Node.js application that does not reflect production architecture constraints.

**Accepting Connections:**
The relay instantiates an `http.Server` capable of handling three distinct pathways:
1. `GET /agent/wake`: It intercepts this request, checks for basic token validity (if strict mode is enabled), and responds with headers necessary to keep an SSE stream alive (`Content-Type: text/event-stream`).
2. `Upgrade /agent/data`: It intercepts HTTP upgrade requests to establish the agent's bidirectional `DataChannel`.
3. `Upgrade /wss`: It intercepts HTTP upgrade requests to establish the browser's command channel.

**Routing Messages:**
The mock relay entirely skips formal routing logic (e.g., mapping a `project_id` to an `agent_id`). Instead, it relies on global variables to store active connections and blindly broadcasts messages.
When a browser sends a JSON message, the relay serializes it to bytes and pushes it down the WebSocket of the most recently connected agent (`activeWs`):
```typescript
if (activeWs && activeWs.readyState === WebSocket.OPEN) {
  const bytes = serializeToBytes(msg);
  activeWs.send(bytes);
}
```
*(Located in `src/dev/mock-relay.ts`, lines 166-168)*

Conversely, when an agent responds with binary data, the relay deserializes it, wraps it as JSON, and iterates through a `Set` of all connected browsers, broadcasting the response to every single one:
```typescript
for (const browserWs of browserWses) {
  if (browserWs.readyState === WebSocket.OPEN) {
    browserWs.send(jsonStr);
  }
}
```
*(Located in `src/dev/mock-relay.ts`, lines 138-142)*

**What it does NOT do:**
- **No Token Validation:** By default, the mock relay bypasses all real authentication. Unless specific `validTokens` are hardcoded in the relay's startup options, it will accept any token.
- **No User Accounts:** There is no concept of users, organizations, or permissions within the relay.
- **No Persistence or Redis:** There is no shared state layer. Connections are just held in local memory.
- **No Project Routing:** It cannot route a request for "Project X" exclusively to the agent registered for "Project X".

## 5. Token lifecycle today

The entire security model currently relies on locally generated tokens that persist indefinitely.

**Generation:**
Tokens are manufactured entirely on the agent side during initialization. The agent uses Node's `crypto.randomBytes` to generate 32 base62 characters and prefixes them with `swagt_`. Because it is generated locally, the cloud (or mock relay) has no prior knowledge of this token.
```typescript
export function generateAgentToken(): string {
  let result = '';
  while (result.length < 32) {
    const bytes = crypto.randomBytes(1);
    const val = bytes[0];
    if (val < 248) {
      result += BASE62_CHARS[val % 62];
    }
  }
  return `swagt_${result}`;
}
```
*(Located in `src/config/token.ts`, lines 8-18)*

**Storage:**
The generated token is saved locally to disk within the agent's configuration file (`sw-agent.config.json`). This file is read via `fs.readFileSync` whenever the agent starts (`src/config/machine-config.ts`, line 159).

**Transmission:**
The token is exposed to the relay only during the initial SSE Wake Channel connection phase via the `Authorization: Bearer` header (`src/channels/wake-channel.ts`, line 245). It is not embedded in the Data Channel WSS connection, which instead uses a short-lived token provided by the relay during the wake event.

**Validation and Revocation:**
Currently, token validation is virtually non-existent. The mock relay does not query a database to verify token authenticity. Furthermore, there is no implemented mechanism for token rotation or revocation. Once generated, a token is valid forever on the local machine unless manually deleted.

## 6. Message flow trace (one concrete example)

To fully understand the architecture, here is a step-by-step trace of a complete round-trip interaction: a user starts the agent, a browser client connects, issues a request, and receives a response.

1. **Agent Startup:** The user executes `sw-agent start`. The CLI entrypoint `runStart()` is invoked (`src/cli/commands/start.ts`:23).
2. **Session Initialization:** The application logic reads the local `machineConfig` and starts `runAgent()`, which in turn instantiates an `AgentSession` (`src/channels/agent-session.ts`).
3. **Establishing Wake Channel:** `AgentSession.start()` initializes the `WakeChannel` and invokes `await this.wakeChannel.start()` (`agent-session.ts`:87).
4. **SSE Handshake:** `WakeChannel.connectOnce()` fires an HTTP GET request to `/agent/wake` with the agent's persistent token encoded in the `Authorization` header (`wake-channel.ts`:244).
5. **Relay Acceptance:** The HTTP server inside `mock-relay.ts` accepts the `/agent/wake` request. It records the active response object (`activeSseRes`) and maintains an open connection with a `Content-Type: text/event-stream` header (`mock-relay.ts`:57).
6. **Browser Client Connects:** A test script instantiates a `BrowserClient` and connects to the `/wss` endpoint on the mock relay (`tests/e2e/browser-client.ts`:16).
7. **Relay Registers Browser:** `mock-relay.ts` accepts the WebSocket upgrade and adds the new connection socket to its `browserWses` Set (`mock-relay.ts`:153).
8. **Relay Wakes Agent:** The mock relay pushes a `WakeEvent` down the open SSE connection. This event contains a short-lived `data_channel_token` and a specific `browser_session_id` (`mock-relay.ts`:203).
9. **Agent Processes Wake Event:** The agent's `WakeChannel` receives the chunked text, parses the JSON payload, and fires `opts.onWake()`. This calls `AgentSession.handleWakeEvent()` (`agent-session.ts`:160).
10. **Agent Opens Data Channel:** `AgentSession` spawns a new `DataChannel` instance using the short-lived `data_channel_token`. It connects to `/agent/data` via an upgraded WebSocket connection (`agent-session.ts`:182-199).
11. **Browser Sends Request:** The browser script invokes `sendAndWait()`, passing an `AgentMessage` with a unique `request_id` (`browser-client.ts`:76).
12. **Relay Forwards Request:** `mock-relay.ts` receives the JSON string in its `wssBrowser.on('message')` listener, serializes it to a highly efficient binary format, and forwards it to the single connected agent (`activeWs`) (`mock-relay.ts`:166-168).
13. **Agent Receives Request:** `DataChannel.ws.on('message')` receives the binary payload, deserializes it back into an `AgentMessage`, runs validation logic, and triggers the configured `opts.onMessage` callback (`data-channel.ts`:108-160).
14. **Execution:** The agent handles the payload via its internal dispatcher, routing it to the PostgreSQL query runner to fetch database results.
15. **Agent Sends Response:** The execution engine replies using `AgentSession.send()`, which calls `DataChannel.send()`. This step serializes the response into binary format and pushes it over the WSS link back to the relay (`data-channel.ts`:212).
16. **Relay Broadcasts Response:** The mock relay receives the binary message from the agent. It deserializes it into JSON and iterates through all connections in the `browserWses` Set, broadcasting the response (`mock-relay.ts`:138-142).
17. **Browser Resolves:** The `BrowserClient.ws.on('message')` listener intercepts the broadcasted message, matches the embedded `request_id` against its `pending` promises map, and gracefully resolves the Promise (`browser-client.ts`:38-46).

## 7. Gaps for production (what's missing vs the device-pairing flow we discussed)

The current local development flow is highly simulated and lacks critical infrastructure required for a secure, multi-tenant cloud environment. Before moving to production, the following gaps must be addressed:

- **Tokens are generated locally instead of by the relay:** `src/config/token.ts` currently manufactures tokens locally. In production, a secure device flow should be utilized where the cloud relay issues and signs agent tokens. This requires fundamentally refactoring `createDefaultMachineConfig()` in `src/config/machine-config.ts`.
- **No functional pairing flow exists:** The CLI `/link` command (`src/cli/commands/link.ts`) is currently just a printed stub. It outputs: *“This command is a stub. In production, it would: 1. Call the cloud API to register the project binding.”* The agent is not genuinely tied to any specific cloud project.
- **No user or organization concept in the relay:** The core relay logic in `src/dev/mock-relay.ts` operates completely blindly. A production relay must map a frontend user’s session to authorized organizations, verified projects, and subsequently, the specific linked agent IDs.
- **No token validation is performed:** The `mock-relay.ts` lacks integration with a cloud database or Redis layer. Consequently, it completely bypasses token validation, rendering the agent access highly insecure for public endpoints.
- **No token revocation mechanism:** Because tokens are locally generated and never verified against a centralized store, there is no way to invalidate a compromised token or rotate keys gracefully.
- **The browser connects blindly without authentication:** `src/tests/e2e/browser-client.ts` initiates its connection with no JWT or session cookies. Since `mock-relay.ts` blindly forwards everything it receives, anyone who discovers the WSS endpoint could execute unauthorized actions against the locally connected agent. The mock relay must enforce strict project-level routing instead of blindly broadcasting.

## 8. What works today (for local dev)

Despite the gaps necessary for a production-grade cloud deployment, the underlying architectural pipes are solid and serve local development extremely well:

- **Mock relay + local agent works end-to-end:** The complex orchestration of initializing an SSE wake connection, parsing events, and subsequently opening and authenticating a secondary Data Channel WebSocket operates smoothly without authentication friction.
- **240+ E2E tests pass:** The testing framework relies heavily on this mock infrastructure. The ability of `BrowserClient` to multiplex multiple concurrent queries and handle streamed data through WebSockets is proven to be robust.
- **Real PG queries work:** The binary serialization and deserialization layer on the data channels reliably compresses and handles complex database responses, successfully bridging local databases to a simulated remote frontend.
