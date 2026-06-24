import { MachineConfig } from '../../config/machine-config';
import { DatabasesConfig } from '../../config/db-config';
import { isProcessAlive } from '../daemon/pid-file';

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail?: string;
}

export interface DoctorContext {
  swAgentDir: string;
  machineConfig: MachineConfig | null;
  databasesConfig: DatabasesConfig | null;
  nodeVersion: string;
  platform: string;
}

export async function checkSwAgentDirExists(ctx: DoctorContext): Promise<DoctorCheck> {
  try {
    const fs = await import('fs/promises');
    const stat = await fs.stat(ctx.swAgentDir);
    if (stat.isDirectory()) {
      return { name: 'SW Agent directory exists', status: 'pass' };
    }
    return { name: 'SW Agent directory exists', status: 'fail', detail: 'Not a directory' };
  } catch {
    return { name: 'SW Agent directory exists', status: 'fail', detail: 'Directory does not exist' };
  }
}

export async function checkMachineConfigValid(ctx: DoctorContext): Promise<DoctorCheck> {
  if (!ctx.machineConfig) {
    return { name: 'Machine config valid', status: 'fail', detail: 'Config file missing or invalid' };
  }
  if (!ctx.machineConfig.agent_token) {
    return { name: 'Machine config valid', status: 'fail', detail: 'Missing agent_token' };
  }
  return { name: 'Machine config valid', status: 'pass', detail: `Agent ID: ${ctx.machineConfig.agent_id}` };
}

export async function checkTokenFormat(ctx: DoctorContext): Promise<DoctorCheck> {
  if (!ctx.machineConfig?.agent_token) {
    return { name: 'Token format', status: 'fail', detail: 'No token to check' };
  }
  const token = ctx.machineConfig.agent_token;
  const pattern = /^swagt_[A-Za-z0-9]{32}$/;
  if (pattern.test(token)) {
    return { name: 'Token format', status: 'pass' };
  }
  if (!token.startsWith('swagt_')) {
    return { name: 'Token format', status: 'fail', detail: 'Token must start with "swagt_"' };
  }
  const body = token.slice(6);
  if (body.length < 32) {
    return { name: 'Token format', status: 'fail', detail: `Token body too short (${body.length} chars, expected 32)` };
  }
  if (body.length > 32) {
    return { name: 'Token format', status: 'fail', detail: `Token body too long (${body.length} chars, expected 32)` };
  }
  if (!/^[A-Za-z0-9]+$/.test(body)) {
    return { name: 'Token format', status: 'fail', detail: 'Token body contains invalid characters (must be base62)' };
  }
  return { name: 'Token format', status: 'pass' };
}

export async function checkDatabasesConfigValid(ctx: DoctorContext): Promise<DoctorCheck> {
  if (!ctx.databasesConfig) {
    return { name: 'Databases config valid', status: 'fail', detail: 'Config file missing or invalid' };
  }
  if (ctx.databasesConfig.databases.length === 0) {
    return { name: 'Databases config valid', status: 'warn', detail: 'No databases configured' };
  }
  return { name: 'Databases config valid', status: 'pass', detail: `${ctx.databasesConfig.databases.length} database(s) configured` };
}

export async function checkDatabasesReachable(_ctx: DoctorContext): Promise<DoctorCheck> {
  return { name: 'Databases reachable', status: 'warn', detail: 'Skipped (requires connection test)' };
}

export async function checkAuditDirWritable(ctx: DoctorContext): Promise<DoctorCheck> {
  const fs = await import('fs/promises');
  const auditDir = `${ctx.swAgentDir}/audit`;
  const testFile = `${auditDir}/.write_test`;
  try {
    await fs.mkdir(auditDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(testFile, 'test', { mode: 0o600 });
    await fs.unlink(testFile);
    return { name: 'Audit directory writable', status: 'pass' };
  } catch (err: unknown) {
    return { name: 'Audit directory writable', status: 'fail', detail: (err as Error).message };
  }
}

export async function checkDiskSpace(_ctx: DoctorContext): Promise<DoctorCheck> {
  return { name: 'Disk space', status: 'pass', detail: 'Skipped (platform check)' };
}

export async function checkNodeVersion(ctx: DoctorContext): Promise<DoctorCheck> {
  const versionMatch = ctx.nodeVersion.match(/^v?(\d+)/);
  if (!versionMatch) {
    return { name: 'Node version', status: 'fail', detail: `Unknown version: ${ctx.nodeVersion}` };
  }
  const major = parseInt(versionMatch[1], 10);
  if (major >= 18) {
    return { name: 'Node version', status: 'pass', detail: ctx.nodeVersion };
  }
  return { name: 'Node version', status: 'fail', detail: `${ctx.nodeVersion} (need >= 18.0.0)` };
}

export async function checkPidFile(ctx: DoctorContext): Promise<DoctorCheck> {
  const fs = await import('fs/promises');
  const pidPath = `${ctx.swAgentDir}/sw-agent.pid`;
  try {
    const content = await fs.readFile(pidPath, 'utf8');
    const pidInfo = JSON.parse(content);
    if (isProcessAlive(pidInfo.pid)) {
      return { name: 'PID file', status: 'warn', detail: `Stale PID file (process ${pidInfo.pid} is alive)` };
    }
    return { name: 'PID file', status: 'warn', detail: `Stale PID file (process ${pidInfo.pid} is dead)` };
  } catch {
    return { name: 'PID file', status: 'pass', detail: 'No PID file (agent not running)' };
  }
}

export async function runAllChecks(ctx: DoctorContext): Promise<DoctorCheck[]> {
  return [
    await checkSwAgentDirExists(ctx),
    await checkMachineConfigValid(ctx),
    await checkTokenFormat(ctx),
    await checkDatabasesConfigValid(ctx),
    await checkDatabasesReachable(ctx),
    await checkAuditDirWritable(ctx),
    await checkDiskSpace(ctx),
    await checkNodeVersion(ctx),
    await checkPidFile(ctx),
  ];
}
