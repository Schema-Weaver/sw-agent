import * as crypto from 'crypto';

export function fingerprintStatement(sql: string): string {
  const normalized = sql
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/;\s*$/, '')
    .trim();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

export function previewStatement(sql: string): string {
  const trimmed = sql.trim();
  return trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed;
}
