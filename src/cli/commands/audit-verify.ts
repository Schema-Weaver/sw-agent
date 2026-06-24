import * as path from 'path';
import * as fs from 'fs';
import { getSwAgentDir } from '../../config/paths';
import { AuditEvent } from '../../audit/types';
import { verifyHashChain, computeEventHash } from '../../audit/chain';

export interface AuditVerifyOptions {
  verbose?: boolean;
}

export interface VerifyResult {
  file: string;
  totalEvents: number;
  validEvents: number;
  hashErrors: number;
  parseErrors: number;
  chainBrokenIndex?: number;
}

export async function runAuditVerify(args: string[], opts: AuditVerifyOptions = {}): Promise<void> {
  const verbose = opts.verbose || args.includes('--verbose') || args.includes('-v');
  
  const swAgentDir = getSwAgentDir();
  const auditDir = path.join(swAgentDir, 'audit');
  
  const files = await getAuditFiles(auditDir);
  
  if (files.length === 0) {
    console.log('No audit log files found.');
    process.exit(0);
  }
  
  let totalEvents = 0;
  let totalHashErrors = 0;
  let totalParseErrors = 0;
  let allPassed = true;
  
  for (const file of files) {
    const result = await verifyFile(file, verbose);
    totalEvents += result.totalEvents;
    totalHashErrors += result.hashErrors;
    totalParseErrors += result.parseErrors;
    
    if (result.chainBrokenIndex !== undefined) {
      allPassed = false;
    }
    
    printResult(result, verbose);
  }
  
  console.log(`\nTotal: ${files.length} file(s), ${totalEvents} event(s), ${totalHashErrors} hash error(s), ${totalParseErrors} parse error(s)`);
  
  if (allPassed && totalHashErrors === 0) {
    console.log('✓ Audit log integrity verified.');
    process.exit(0);
  } else {
    console.log('✗ Audit log integrity check failed.');
    process.exit(1);
  }
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

async function verifyFile(file: string, verbose: boolean): Promise<VerifyResult> {
  const result: VerifyResult = {
    file: path.basename(file),
    totalEvents: 0,
    validEvents: 0,
    hashErrors: 0,
    parseErrors: 0,
  };
  
  let content: string;
  try {
    content = await fs.promises.readFile(file, 'utf8');
  } catch {
    return result;
  }
  
  const lines = content.split('\n').filter(Boolean);
  result.totalEvents = lines.length;
  
  const events: AuditEvent[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    try {
      const event = JSON.parse(lines[i]) as AuditEvent;
      events.push(event);
      result.validEvents++;
    } catch {
      result.parseErrors++;
      if (verbose) {
        console.log(`  ${file}:${i + 1}: parse error`);
      }
    }
  }
  
  if (events.length > 0) {
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];
      const { hash: _, ...prevWithoutHash } = prev;
      const expectedHash = computeEventHash(prevWithoutHash as any);
      
      if (curr.prev_hash !== expectedHash) {
        result.hashErrors++;
        if (result.chainBrokenIndex === undefined) {
          result.chainBrokenIndex = i;
        }
        if (verbose) {
          console.log(`  ${file}:${i + 1}: hash chain broken (expected ${expectedHash.slice(0, 16)}, got ${curr.prev_hash?.slice(0, 16) || 'null'})`);
        }
      }
    }
  }
  
  if (events.length >= 1) {
    const verified = verifyHashChain(events);
    if (!verified.intact) {
      if (result.chainBrokenIndex === undefined) {
        result.chainBrokenIndex = verified.brokenAt;
      }
    }
  }
  
  return result;
}

function printResult(result: VerifyResult, verbose: boolean): void {
  const status = result.hashErrors === 0 && result.parseErrors === 0 ? '✓' : '✗';
  console.log(`${status} ${result.file}: ${result.totalEvents} event(s)`);
  if (verbose || result.hashErrors > 0 || result.parseErrors > 0) {
    if (result.hashErrors > 0) {
      console.log(`    ${result.hashErrors} hash error(s)`);
    }
    if (result.parseErrors > 0) {
      console.log(`    ${result.parseErrors} parse error(s)`);
    }
  }
}
