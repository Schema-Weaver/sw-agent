import { loadMachineConfig } from '../../config/machine-config';
import { loadDatabasesConfig } from '../../config/db-config';
import { getSwAgentDir } from '../../config/paths';
import { DoctorCheck, runAllChecks, DoctorContext } from '../doctor/checks';

export interface DoctorOptions {
  json?: boolean;
}

export async function runDoctor(args: string[], opts: DoctorOptions = {}): Promise<void> {
  const json = opts.json || args.includes('--json') || args.includes('-j');
  
  const swAgentDir = getSwAgentDir();
  let machineConfig = null;
  let databasesConfig = null;
  
  try {
    machineConfig = loadMachineConfig();
  } catch {
    
  }
  
  try {
    databasesConfig = loadDatabasesConfig();
  } catch {
    
  }
  
  const ctx: DoctorContext = {
    swAgentDir,
    machineConfig,
    databasesConfig,
    nodeVersion: process.version,
    platform: process.platform,
  };
  
  const checks = await runAllChecks(ctx);
  
  if (json) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    printResultsTable(checks);
  }
  
  const hasFail = checks.some(c => c.status === 'fail');
  process.exit(hasFail ? 1 : 0);
}

function printResultsTable(checks: DoctorCheck[]): void {
  console.log('SW Agent Diagnostic Check\n');
  
  const statusIcon = (status: DoctorCheck['status']): string => {
    switch (status) {
      case 'pass': return '✓';
      case 'fail': return '✗';
      case 'warn': return '⚠';
    }
  };
  
  const statusColor = (status: DoctorCheck['status']): string => {
    switch (status) {
      case 'pass': return '\x1b[32m';
      case 'fail': return '\x1b[31m';
      case 'warn': return '\x1b[33m';
    }
  };
  
  const reset = '\x1b[0m';
  
  for (const check of checks) {
    const icon = statusIcon(check.status);
    const color = statusColor(check.status);
    const detail = check.detail ? ` — ${check.detail}` : '';
    console.log(`  ${color}${icon}${reset} ${check.name}${detail}`);
  }
  
  const passes = checks.filter(c => c.status === 'pass').length;
  const fails = checks.filter(c => c.status === 'fail').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  
  console.log(`\nSummary: ${passes} pass, ${warns} warn, ${fails} fail`);
}
