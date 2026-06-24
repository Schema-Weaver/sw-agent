/**
 * Local JSONL audit log on agent machine.
 * Logs metadata for every request: ts, user, role, db, action, status, ms, rows.
 * NEVER logs: full SQL text, query results, DB credentials.
 * Location: ~/.sw-agent/audit.log (or %USERPROFILE%\.sw-agent\audit.log on Windows)
 */

// TODO: Part 7 — implement append(entry), rotate()
export {};
