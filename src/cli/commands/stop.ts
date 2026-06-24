import * as path from 'path';
import { getSwAgentDir } from '../../config/paths';
import { readPidFile, deletePidFile, isProcessAlive } from '../daemon/pid-file';

export interface StopOptions {
  force?: boolean;
  timeoutMs?: number;
}

export async function runStop(args: string[], opts: StopOptions = {}): Promise<void> {
  const force = opts.force || args.includes('--force') || args.includes('-f');
  const timeoutMs = opts.timeoutMs ?? 30_000;
  
  const swAgentDir = getSwAgentDir();
  const pidFile = path.join(swAgentDir, 'sw-agent.pid');
  
  const pidInfo = await readPidFile({ path: pidFile });
  if (!pidInfo) {
    console.log('No agent running (no PID file found).');
    process.exit(0);
  }
  
  const { pid, started_at, version } = pidInfo;
  
  if (!isProcessAlive(pid)) {
    console.log(`Agent (pid ${pid}) is not running. Cleaning up stale PID file.`);
    await deletePidFile({ path: pidFile });
    process.exit(0);
  }
  
  console.log(`Stopping agent (pid ${pid}, started ${started_at}, v${version})...`);
  
  if (force) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      
    }
    const deadline = Date.now() + timeoutMs;
    while (isProcessAlive(pid) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (isProcessAlive(pid)) {
      console.log(`Process ${pid} did not exit gracefully, sending SIGKILL.`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (isProcessAlive(pid)) {
      console.error(`Error: Failed to kill process ${pid}.`);
      process.exit(1);
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      console.error(`Error: Failed to send SIGTERM to process ${pid}.`);
      process.exit(1);
    }
  }
  
  console.log('✓ Agent stopped.');
  process.exit(0);
}
