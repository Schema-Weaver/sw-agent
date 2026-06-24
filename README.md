# @vivekmind/sw-agent

> **Bridge between the Schema Weaver browser IDE and your PostgreSQL databases.**
> Runs near the DB. Never exposes credentials. Executes queries and migrations on demand.

[![npm version](https://img.shields.io/npm/v/@vivekmind/sw-agent.svg)](https://www.npmjs.com/package/@vivekmind/sw-agent)
[![license](https://img.shields.io/npm/l/@vivekmind/sw-agent.svg)](./LICENSE)
[![node version](https://img.shields.io/node/v/@vivekmind/sw-agent.svg)](https://nodejs.org)

## What is Schema Weaver?

[Schema Weaver](https://schemaweaver.vivekmind.com) is a PostgreSQL schema management SaaS that helps teams visualize, edit, and migrate their database schemas from a browser-based IDE. SW Agent is the on-premises bridge that connects that IDE to your actual databases—without ever exposing credentials to the cloud.

## What SW Agent Does

SW Agent is a lightweight daemon that:

- **Runs near your database** — on your laptop, an EC2 instance, or a bastion host in your VPC
- **Holds DB credentials locally** — never sends connection strings to the cloud
- **Enforces per-user permissions** — 4 permission levels × 4 roles
- **Executes queries & migrations** — on demand from the browser IDE
- **Streams results efficiently** — chunked for large datasets (100 rows / 64KB / 100ms)
- **Writes a tamper-evident audit log** — SHA-256 hash chain for compliance

## Architecture

```
┌────────────────┐                    ┌────────────────┐                    ┌────────────────┐
│     Browser    │      WSS           │   Cloud User   │      WSS          │    SW Agent    │
│  (Schema       │◄──────────────────►│    Gateway     │◄──────────────────►│   (this pkg)   │
│   Weaver IDE)  │  www.worker-pod.io │                │                    │                │
└────────────────┘                    └────────────────┘                    └───────┬────────┘
                                                                                    │
                                                                          PostgreSQL │
                                                                                    │
                                                                           pg        ▼
                                                                           ┌────────────────┐
                                                                           │    Postgres    │
                                                                           │    Database   │
                                                                           └────────────────┘
                                                                                   
                                                                                   ┌────────────────┐
                                                                                   │   Audit Log    │
                                                                                   │ (JSONL + hash  │
                                                                                   │    chain)      │
                                                                                   └────────────────┘
```

The agent connects **outbound** to the cloud gateway — no inbound firewall changes required.

## Install

### As a CLI (run the agent daemon)

```bash
npm install -g @vivekmind/sw-agent

# Or use without installing:
npx @vivekmind/sw-agent init
```

### As a library (programmatic API)

```bash
npm install @vivekmind/sw-agent
```

## Quick Start (CLI)

```bash
# 1. Initialize the agent on your machine
sw-agent init
# ✓ Created ~/.sw-agent/sw-agent.config.json
# ✓ Agent ID: agt_laptop_a1b2c3d4
# ✓ Token: swagt_7Kk2mP9xQr4T...

# 2. Add a PostgreSQL database
sw-agent db:add
# > Project name: myapp
# > Connection string: postgresql://user:pass@localhost:5432/mydb
# > Permission level: full

# 3. Verify everything works
sw-agent doctor
# ✓ Node.js 18.17.0
# ✓ Config file OK
# ✓ Database myapp: connected (12 tables)

# 4. Start the agent daemon
sw-agent start
# [agent] Listening for browser connections...

# 5. Check status
sw-agent status
# Agent: running (PID 12345)
# Uptime: 2h 34m
# Projects: myapp
# Last query: 5 minutes ago
```

## Quick Start (Programmatic)

```typescript
import { AgentClient } from '@vivekmind/sw-agent';

const client = new AgentClient({
  relayUrl: 'wss://www.worker-pod.io',
  agentId: 'agt_laptop_a1b2c3d4',
  token: 'swagt_7Kk2mP9xQr4T...',
});

await client.connect();

const ctx = { project: 'myapp', role: 'admin' as const, userId: 'alice' };

// Run a query
const result = await client.query('SELECT * FROM users LIMIT 10', ctx);
console.log(result.rows);

// Stream a large result
for await (const chunk of client.streamQuery('SELECT * FROM big_table', ctx)) {
  console.log(`Chunk ${chunk.chunkIndex}: ${chunk.rows.length} rows`);
}

// Run a migration
const migration = await client.migrate(
  'CREATE TABLE foo (id serial PRIMARY KEY);',
  ctx,
  { strategy: 'single_tx' }
);

// Introspect the schema
const schema = await client.introspect(ctx);
console.log(schema.tables);

await client.disconnect();
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `sw-agent init` | Initialize agent on this machine (generate ID + token) |
| `sw-agent db:add` | Add a PostgreSQL database (interactive) |
| `sw-agent db:ls` | List configured databases |
| `sw-agent db:remove <alias>` | Remove a database entry |
| `sw-agent db:test <alias>` | Test database connection |
| `sw-agent ls:projects` | List all configured projects |
| `sw-agent start` | Start agent daemon (foreground) |
| `sw-agent start --daemon` | Start as background daemon |
| `sw-agent stop` | Stop running agent |
| `sw-agent status` | Show daemon health and stats |
| `sw-agent doctor` | Run pre-flight diagnostic checks |
| `sw-agent logs` | View/filter the audit log |
| `sw-agent audit:verify` | Verify audit log hash chain integrity |
| `sw-agent link <project>` | Link to a browser project |

## Permission Model

Each project has a **permission level**:

| Level | Behavior |
|-------|----------|
| `read_only` | Only SELECT queries allowed |
| `auto_upgrade` | Reads + pre-registered migrations auto-approved |
| `manual` | Every query/migration requires browser approval |
| `full` | All queries and migrations auto-approved |

Each request is stamped with a **role** from the browser:

| Role | query | write | migrate | cancel | introspect |
|------|-------|-------|---------|--------|------------|
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `developer` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `data_reader` | ✓ | ✗ | ✗ | ✓ | ✓ |
| `viewer` | ✓ | ✗ | ✗ | ✗ | ✓ |

## Audit Log

Every action is logged to `~/.sw-agent/audit/audit.jsonl` with a SHA-256 hash chain:

```bash
# View recent events
sw-agent logs --limit 20

# Filter by user
sw-agent logs --user alice

# Verify chain integrity
sw-agent audit:verify
# ✓ Verified 1,247 entries, chain intact
```

Each entry includes: timestamp, user, role, action, decision (allow/deny), outcome, SQL fingerprint, and duration.

## Configuration Files

Files live in `~/.sw-agent/` with `0600` permissions:

| File | Description |
|------|-------------|
| `sw-agent.config.json` | Machine config (agent_id, token, version) |
| `databases.config.json` | Registered databases (one per project) |
| `audit/audit.jsonl` | Tamper-evident audit log |
| `agent.pid` | Daemon PID file (runtime) |
| `agent.status.json` | Daemon health (runtime) |

## Features

- **Query execution** — Run SQL with automatic timeout and cancellation
- **Streaming** — Chunked results for large datasets (async iterable)
- **Migrations** — Single-transaction or per-statement strategies
- **Advisory locks** — Prevent concurrent migrations on the same DB
- **Schema introspection** — List tables, columns, indexes, constraints
- **Query cancellation** — In-flight queries can be cancelled via control channel
- **Manual approval flow** — Browser prompts for sensitive operations
- **Auto-upgrade** — Pre-register migration plans for auto-approval
- **Mock relay** — Built-in development relay for local testing

## Development

```bash
cd sw-agent

# Install dependencies
npm install

# Build
npm run build

# Type check
npm run typecheck

# Lint
npm run lint

# Run unit tests
npm test

# Run E2E tests (requires PostgreSQL)
TEST_PG_URL=postgresql://localhost:5432/test npm run test:e2e
```

## API Exports

### `@vivekmind/sw-agent` (Client SDK)

Browser-safe exports for connecting to agents:

```typescript
export { AgentClient } from '@vivekmind/sw-agent';
export { AgentClientError, AgentClientTimeoutError, AgentClientDisconnectedError } from '@vivekmind/sw-agent';
export { MessageType, ErrorCode } from '@vivekmind/sw-agent';
```

### `@vivekmind/sw-agent` (Server Runtime)

Full exports including PostgreSQL execution:

```typescript
// Config
export { loadMachineConfig, saveMachineConfig } from '@vivekmind/sw-agent';
export { loadDatabaseConfig, saveDatabaseConfig, getDatabase } from '@vivekmind/sw-agent';

// Protocol
export { MessageType, ErrorCode, createMessage, serialize, deserialize } from '@vivekmind/sw-agent';

// Execution
export { PoolManager, QueryRunner, MigrationRunner, Introspector, Canceller } from '@vivekmind/sw-agent';

// Permissions
export { PermissionChecker, AutoUpgradeChecker, ManualApprovalHandler, PlanRegistry } from '@vivekmind/sw-agent';

// Audit
export { AuditSink, LocalAuditWriter, CloudAuditWriter, verifyChain } from '@vivekmind/sw-agent';

// Channels
export { AgentSession, WakeChannel, DataChannel } from '@vivekmind/sw-agent';
```

## Test Coverage

- **240+ tests** across protocol, channels, execution, permissions, audit, and CLI
- **E2E tests** for full agent ↔ relay ↔ client flows
- **Mock relay** for isolated testing

## Related

- [Schema Weaver](https://schemaweaver.vivekmind.com) — Main product
- [GitHub](https://github.com/vivekmind/sw-agent) — Source code

## License

MIT © 2026 Schema Weaver
