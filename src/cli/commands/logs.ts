import * as path from 'path';
import * as fs from 'fs';
import { getSwAgentDir } from '../../config/paths';
import { AuditEvent } from '../../audit/types';
import { formatEventRow, formatTableHeader } from '../logs/format';

export interface LogsOptions {
  limit?: number;
  project?: string;
  user?: string;
  action?: string;
  follow?: boolean;
  json?: boolean;
}

export async function runLogs(args: string[], opts: LogsOptions = {}): Promise<void> {
  const limit = opts.limit ?? parseInt(findArg(args, '--limit', '-l') || '100', 10);
  const project = opts.project ?? findArg(args, '--project', '-p');
  const user = opts.user ?? findArg(args, '--user', '-u');
  const action = opts.action ?? findArg(args, '--action', '-a');
  const follow = opts.follow || args.includes('--follow') || args.includes('-f');
  const json = opts.json || args.includes('--json') || args.includes('-j');
  
  const swAgentDir = getSwAgentDir();
  const auditDir = path.join(swAgentDir, 'audit');
  
  if (follow) {
    await followLogs(auditDir, { project, user, action, json });
  } else {
    await dumpLogs(auditDir, { limit, project, user, action, json });
  }
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
  
  const filtered = events.filter(e => {
    if (opts.project && e.project !== opts.project) return false;
    if (opts.user && e.user_id !== opts.user) return false;
    if (opts.action && e.action !== opts.action) return false;
    return true;
  }).slice(-opts.limit);
  
  if (filtered.length === 0) {
    console.log('No logs found.');
    return;
  }
  
  if (opts.json) {
    for (const event of filtered) {
      console.log(JSON.stringify(event));
    }
  } else {
    console.log(formatTableHeader());
    for (const event of filtered) {
      console.log(formatEventRow(event));
    }
  }
}

async function followLogs(
  auditDir: string,
  opts: { project?: string; user?: string; action?: string; json: boolean }
): Promise<void> {
  const files = await getAuditFiles(auditDir);
  const currentFile = files[files.length - 1] || path.join(auditDir, 'audit.jsonl');
  
  const fd = fs.openSync(currentFile, 'r');
  fs.readSync(fd, Buffer.alloc(0), 0, 0, fs.fstatSync(fd).size);
  
  console.log(`Tailing ${currentFile}...`);
  
  let tailSize = 0;
  
  const poll = () => {
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
            
          }
        }
        tailSize = newSize;
      }
    } catch {
      
    }
  };
  
  const interval = setInterval(poll, 1000);
  
  await new Promise<void>(() => {});
  
  clearInterval(interval);
  fs.closeSync(fd);
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
  } catch {
    
  }
  return files;
}

async function readRecentEvents(auditDir: string, maxEvents: number): Promise<AuditEvent[]> {
  const files = await getAuditFiles(auditDir);
  const events: AuditEvent[] = [];
  
  for (const file of files) {
    try {
      const content = await fs.promises.readFile(file, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          events.push(JSON.parse(line) as AuditEvent);
        } catch {
          
        }
      }
    } catch {
      
    }
  }
  
  return events.slice(-maxEvents);
}
