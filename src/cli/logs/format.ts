import { AuditEvent } from '../../audit/types';

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function formatEventRow(event: AuditEvent): string {
  const ts = event.ts.slice(0, 19).replace('T', ' ');
  const project = truncate(event.project, 12);
  const user = truncate(event.user_id, 12);
  const action = truncate(event.action, 14);
  const decision = truncate(event.decision, 9);
  const outcome = truncate(event.outcome, 8);
  const preview = truncate(event.statement_preview ?? '', 60);
  return `${ts}  ${project.padEnd(12)}  ${user.padEnd(12)}  ${action.padEnd(14)}  ${decision.padEnd(9)}  ${outcome.padEnd(8)}  ${preview}`;
}

export function formatEventJson(event: AuditEvent): string {
  return JSON.stringify(event);
}

export function formatTableHeader(): string {
  const header = 'TS                 PROJECT     USER         ACTION         DECISION  OUTCOME   PREVIEW';
  const separator = '-----------------  ------------  ------------  --------------  ---------  --------  ------------------------------------------------------------';
  return `${header}\n${separator}`;
}
