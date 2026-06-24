import { spawn } from 'child_process';
import * as path from 'path';
import { loadMachineConfig } from '../../config/machine-config';
import { loadDatabasesConfig } from '../../config/db-config';
import { getSwAgentDir } from '../../config/paths';
import { readPidFile, isProcessAlive } from '../daemon/pid-file';
import { runAgent } from '../daemon/runtime';

export interface StartOptions {
  daemon?: boolean;
  relayUrl?: string;
}

export async function runStart(args: string[], opts: StartOptions = {}): Promise<void> {
  const daemon = opts.daemon || args.includes('--daemon') || args.includes('-d');
  
  const swAgentDir = getSwAgentDir();
  const pidFile = path.join(swAgentDir, 'sw-agent.pid');
  const statusFile = path.join(swAgentDir, 'sw-agent.status');
  const auditDir = path.join(swAgentDir, 'audit');
  
  const machineConfig = loadMachineConfig();
  if (!machineConfig) {
    console.error('Error: Machine config not found. Run "sw-agent init" first.');
    process.exit(1);
  }
  
  let relayUrl = opts.relayUrl;
  const relayIdx = args.indexOf('--relay');
  if (relayIdx !== -1 && relayIdx + 1 < args.length) {
    relayUrl = args[relayIdx + 1];
  }
  if (!relayUrl) {
    relayUrl = machineConfig.cloud_url;
  }
  
  let autoExitMs: number | undefined;
  const autoExitIdx = args.indexOf('--auto-exit');
  if (autoExitIdx !== -1 && autoExitIdx + 1 < args.length) {
    autoExitMs = parseInt(args[autoExitIdx + 1], 10);
  }
  
  const existingPid = await readPidFile({ path: pidFile });
  if (existingPid && isProcessAlive(existingPid.pid)) {
    console.error(`Error: Agent already running (pid ${existingPid.pid})`);
    process.exit(1);
  }
  
  if (daemon) {
    const nodePath = process.execPath;
    const scriptPath = path.resolve(__dirname, '../../../../../dist/cli/index.js');
    
    const child = spawn(nodePath, [scriptPath, 'start', '--internal-daemon'], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        SW_AGENT_DAEMON: '1',
      },
    });
    child.unref();
    
    console.log(`Agent started in daemon mode (pid ${child.pid})`);
    process.exit(0);
  }
  
  handleInternalDaemon();
  
  const databasesConfig = loadDatabasesConfig() || { databases: [] };
  
  const exitCode = await runAgent({
    machineConfig,
    databasesConfig,
    relayUrl,
    auditDir,
    statusFile,
    pidFile,
    foreground: true,
    autoExitMs,
  });
  
  process.exit(exitCode);
}

function handleInternalDaemon(): void {
  if (process.env.SW_AGENT_DAEMON === '1') {
    setupDaemonLogging();
  }
}

function setupDaemonLogging(): void {
  const fs = require('fs');
  const swAgentDir = getSwAgentDir();
  const logFile = path.join(swAgentDir, 'daemon.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  
  process.stdout.write = process.stderr.write = logStream.write.bind(logStream);
}
