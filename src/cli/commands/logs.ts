import * as path from 'path';
import * as fs from 'fs';
import { getSwAgentDir } from '../../config/paths';
import { AuditEvent } from '../../audit/types';
import { formatEventRow, formatTableHeader, renderLogTable } from '../logs/format';
import { isReplMode } from '../prompt';
import { C, S } from '../ui';

function exit_(code: number): never {
  if (isReplMode()) {
    throw { __exitCode: code };
  }
  process.exit(code);
}

export interface LogsOptions {
  limit?: number;
  project?: string;
  user?: string;
  action?: string;
  follow?: boolean;
  json?: boolean;
}

export async function runLogs(args: string[], opts: LogsOptions = {}): Promise<void> {
  const limit = opts.limit ?? parseInt(findArg(args, '--limit', '-l') || '20', 10);
  const project = opts.project ?? findArg(args, '--project', '-p');
  const user = opts.user ?? findArg(args, '--user', '-u');
  const action = opts.action ?? findArg(args, '--action', '-a');
  const follow = opts.follow || args.includes('--follow') || args.includes('-f');
  const json = opts.json || args.includes('--json') || args.includes('-j');

  const swAgentDir = getSwAgentDir();
  const auditDir = path.join(swAgentDir, 'audit');

  console.log();

  if (follow) {
    await followLogs(auditDir, { project, user, action, json });
  } else {
    await dumpLogs(auditDir, { limit, project, user, action, json });
  }

  exit_(0);
}

function findArg(args: string[], longFlag: string, shortFlag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === longFlag || args[i] === shortFlag) {
      return args[i + 1];
    }
  }
  return undefined;
}

async function dumpLogs(
  auditDir: string,
  opts: { limit: number; project?: string; user?: string; action?: string; json: boolean }
): Promise<void> {
  const events = await readRecentEvents(auditDir, opts.limit * 2);

  const filtered = events.filter((e) => {
    if (opts.project && e.project !== opts.project) return false;
    if (opts.user && e.user_id !== opts.user) return false;
    if (opts.action && e.action !== opts.action) return false;
    return true;
  }).slice(-opts.limit);

  if (filtered.length === 0) {
    console.log(`  ${C.yellow(S.warning)} No logs found.`);
    console.log();
    return;
  }

  if (opts.json) {
    for (const event of filtered) {
      console.log(JSON.stringify(event));
    }
  } else {
    console.log(C.bold('  Audit Logs'));
    console.log();
    console.log(renderLogTable(filtered));
    console.log();
    console.log(`  ${C.dim('Preview truncated. Use')} ${C.cyan('--json')} ${C.dim('to inspect full event payloads.')}`);
  }
  console.log();
}

async function followLogs(
  auditDir: string,
  opts: { project?: string; user?: string; action?: string; json: boolean }
): Promise<void> {
  const files = await getAuditFiles(auditDir);
  const currentFile = files[files.length - 1] || path.join(auditDir, 'audit.jsonl');

  let fd: number | null = null;
  let tailSize = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let isRunning = true;

  // Create a cleanup function
  const cleanup = () => {
    isRunning = false;
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      fd = null;
    }
  };

  // Set up SIGINT handler for follow mode
  const onSigint = () => {
    cleanup();
    console.log();
    console.log(`  ${C.dim('Follow mode stopped.')}`);
    // Don't call exit_ - just return
  };
  process.on('SIGINT', onSigint);

  try {
    fd = fs.openSync(currentFile, 'r');
    const stat = fs.fstatSync(fd);
    tailSize = stat.size;
  } catch {
    console.log(`  ${C.yellow(S.warning)} Audit log file not found. Waiting for new entries...`);
  }

  console.log(`  ${C.cyan(S.link)} Following ${C.white(path.basename(currentFile))}...`);
  console.log(`  ${C.dim('Press Ctrl+C to stop.')}`);
  console.log();
  if (!opts.json) {
    console.log(formatTableHeader());
  }

  interval = setInterval(() => {
    if (!isRunning || fd === null) return;
    try {
      const stat = fs.fstatSync(fd);
      const newSize = stat.size;
      if (newSize > tailSize) {
        const readSize = newSize - tailSize;
        const readBuf = Buffer.alloc(readSize);
        fs.readSync(fd, readBuf, 0, readSize, tailSize);
        const lines = readBuf.toString('utf8').split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const event = JSON.parse(line) as AuditEvent;
            if (opts.project && event.project !== opts.project) continue;
            if (opts.user && event.user_id !== opts.user) continue;
            if (opts.action && event.action !== opts.action) continue;

            if (opts.json) {
              console.log(JSON.stringify(event));
            } else {
              console.log(formatEventRow(event));
            }
          } catch {
            // ignore malformed lines
          }
        }
        tailSize = newSize;
      }
    } catch {
      // ignore errors
    }
  }, 1000);

  // Wait for SIGINT
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!isRunning) {
        clearInterval(check);
        process.off('SIGINT', onSigint);
        resolve();
      }
    }, 100);
  });

  cleanup();
}

async function getAuditFiles(auditDir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.promises.readdir(auditDir);
    for (const entry of entries) {
      if (entry.startsWith('audit') && entry.endsWith('.jsonl')) {
        files.push(path.join(auditDir, entry));
      }
    }
    files.sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return numA - numB;
    });
  } catch { /* ignore */ }
  return files;
}

async function readRecentEvents(auditDir: string, maxEvents: number): Promise<AuditEvent[]> {
  const files = await getAuditFiles(auditDir);
  const events: AuditEvent[] = [];

  for (const file of files) {
    try {
      const content = await fs.promises.readFile(file, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        try {
          const line = i === 0 ? stripBom(lines[i]) : lines[i];
          events.push(JSON.parse(line) as AuditEvent);
        } catch { /* ignore malformed */ }
      }
    } catch { /* ignore unreadable */ }
  }

  return events.slice(-maxEvents);
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
