import { AuditEvent } from '../../audit/types';
import { C, S, alignAnsi, renderTable, truncateAnsi, terminalWidth } from '../ui';

function truncate(s: string, n: number): string {
  return truncateAnsi(s, n, S.ellipsis);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 5) return 'now';
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

const DECISION_COLOR: Record<string, (s: string) => string> = {
  allow: C.green,
  deny: C.red,
  pending: C.yellow,
  approved: C.yellow,
  rejected: C.brightRed,
  expired: C.brightRed,
};

const OUTCOME_COLOR: Record<string, (s: string) => string> = {
  success: C.green,
  error: C.red,
  cancelled: C.yellow,
  'n/a': C.dim,
};

export function renderLogTable(events: AuditEvent[]): string {
  const rows = events.map((event) => ({
    when: event.ts.slice(5, 19).replace('T', ' '),
    age: relativeTime(event.ts),
    project: event.project,
    user: event.user_id,
    action: event.action,
    decision: event.decision,
    outcome: event.outcome,
    ms: event.duration_ms === undefined ? '-' : `${event.duration_ms}ms`,
    preview: event.statement_preview ?? '-',
  }));

  return renderTable(rows, {
    maxWidth: terminalWidth() - 2,
    columns: [
      { key: 'when', header: 'WHEN', minWidth: 12, maxWidth: 14, priority: 2 },
      { key: 'age', header: 'AGE', minWidth: 4, maxWidth: 6, priority: 8, color: C.dim },
      { key: 'project', header: 'PROJECT', minWidth: 10, maxWidth: 18, priority: 1, formatter: (v) => truncate(String(v), 18) },
      { key: 'user', header: 'USER', minWidth: 8, maxWidth: 16, priority: 5, formatter: (v) => truncate(String(v), 16) },
      { key: 'action', header: 'ACTION', minWidth: 10, maxWidth: 16, priority: 3 },
      {
        key: 'decision',
        header: 'DECISION',
        minWidth: 7,
        maxWidth: 10,
        priority: 4,
        color: (value, row) => (DECISION_COLOR[String(row.decision)] ?? C.white)(value),
      },
      {
        key: 'outcome',
        header: 'OUTCOME',
        minWidth: 7,
        maxWidth: 10,
        priority: 6,
        color: (value, row) => (OUTCOME_COLOR[String(row.outcome)] ?? C.white)(value),
      },
      { key: 'ms', header: 'TIME', minWidth: 6, maxWidth: 8, priority: 7, align: 'right' },
      { key: 'preview', header: 'SQL PREVIEW', minWidth: 18, maxWidth: 72, priority: 0, formatter: (v) => truncate(String(v), 72) },
    ],
  });
}

export function formatEventRow(event: AuditEvent): string {
  const decision = (DECISION_COLOR[event.decision] ?? C.white)(event.decision);
  const outcome = (OUTCOME_COLOR[event.outcome] ?? C.white)(event.outcome);
  const preview = truncate(event.statement_preview ?? '-', Math.max(12, terminalWidth() - 58));
  return [
    C.dim(relativeTime(event.ts).padStart(4)),
    C.cyan(truncate(event.project, 14).padEnd(14)),
    truncate(event.action, 14).padEnd(14),
    alignAnsi(decision, 10),
    alignAnsi(outcome, 10),
    preview,
  ].join('  ');
}

export function formatTableHeader(): string {
  return [
    C.dim(' AGE'),
    C.dim('PROJECT'.padEnd(14)),
    C.dim('ACTION'.padEnd(14)),
    C.dim('DECISION'.padEnd(10)),
    C.dim('OUTCOME'.padEnd(10)),
    C.dim('SQL PREVIEW'),
  ].join('  ');
}

export function formatEventJson(event: AuditEvent): string {
  return JSON.stringify(event);
}
