import * as path from 'path';
import { getSwAgentDir } from '../../config/paths';
import { readPidFile, isProcessAlive } from '../daemon/pid-file';
import { readStatusFile, isStatusStale } from '../daemon/status-file';
import { DaemonStatus } from '../daemon/status-file';

interface DisplayStatus {
  agent: {
    running: boolean;
    pid: number | null;
    version: string | null;
    started_at: string | null;
    uptime_sec: number | null;
    last_heartbeat: string | null;
    status_ok: boolean;
  };
  channels: DaemonStatus['channels'] | null;
  stats: DaemonStatus['stats'] | null;
  last_error: DaemonStatus['last_error'] | null;
}

export async function runStatus(_args: string[]): Promise<void> {
  const swAgentDir = getSwAgentDir();
  const pidFile = path.join(swAgentDir, 'sw-agent.pid');
  const statusFile = path.join(swAgentDir, 'sw-agent.status');
  
  const pidInfo = await readPidFile({ path: pidFile });
  const statusInfo = await readStatusFile({ path: statusFile });
  
  let running = false;
  let pid: number | null = null;
  let version: string | null = null;
  let startedAt: string | null = null;
  let uptimeSec: number | null = null;
  let lastHeartbeat: string | null = null;
  let statusOk = true;
  
  const now = new Date();
  
  if (pidInfo) {
    pid = pidInfo.pid;
    version = pidInfo.version;
    startedAt = pidInfo.started_at;
    running = isProcessAlive(pid);
    
    if (startedAt) {
      const startTime = new Date(startedAt);
      uptimeSec = Math.floor((now.getTime() - startTime.getTime()) / 1000);
    }
  }
  
  if (statusInfo && running && pid === statusInfo.pid) {
    lastHeartbeat = statusInfo.last_heartbeat;
    if (isStatusStale(statusInfo)) {
      statusOk = false;
    }
    
    const lines = formatStatusOutput({
      agent: {
        running,
        pid,
        version,
        started_at: startedAt,
        uptime_sec: uptimeSec,
        last_heartbeat: lastHeartbeat,
        status_ok: statusOk,
      },
      channels: statusInfo.channels,
      stats: statusInfo.stats,
      last_error: statusInfo.last_error,
    });
    
    console.log(lines);
  } else {
    const lines = formatStatusOutput({
      agent: {
        running,
        pid,
        version,
        started_at: startedAt,
        uptime_sec: uptimeSec,
        last_heartbeat: lastHeartbeat,
        status_ok: statusOk,
      },
      channels: null,
      stats: null,
      last_error: null,
    });
    
    console.log(lines);
  }
  
  const exitCode = running && statusOk ? 0 : 1;
  process.exit(exitCode);
}

function formatStatusOutput(status: DisplayStatus): string {
  const lines: string[] = [];
  
  lines.push('┌─ Agent Status ─────────────────────────────────┐');
  lines.push(padLine('Running', status.agent.running ? 'Yes' : 'No'));
  lines.push(padLine('PID', status.agent.pid !== null ? String(status.agent.pid) : '-'));
  lines.push(padLine('Version', status.agent.version || '-'));
  lines.push(padLine('Started', status.agent.started_at ? formatTimestamp(status.agent.started_at) : '-'));
  lines.push(padLine('Uptime', status.agent.uptime_sec !== null ? formatDuration(status.agent.uptime_sec) : '-'));
  lines.push(padLine('Last heartbeat', status.agent.last_heartbeat ? formatTimestamp(status.agent.last_heartbeat) : '-'));
  if (status.agent.running) {
    lines.push(padLine('Status', status.agent.status_ok ? 'OK' : 'STALE (heartbeat > 90s ago)'));
  }
  
  if (status.channels) {
    lines.push('├─ Channels ─────────────────────────────────────┤');
    lines.push(padLine('SSE', status.channels.sse));
    lines.push(padLine('WSS', status.channels.wss));
  }
  
  if (status.stats) {
    lines.push('├─ Stats ────────────────────────────────────────┤');
    lines.push(padLine('Queries served', String(status.stats.queries_served)));
    lines.push(padLine('Streams served', String(status.stats.streams_served)));
    lines.push(padLine('Migrations run', String(status.stats.migrations_run)));
    lines.push(padLine('Cancellations', String(status.stats.cancellations)));
    lines.push(padLine('Permission denies', String(status.stats.permission_denies)));
    lines.push(padLine('Audit events', String(status.stats.audit_events_written)));
    lines.push(padLine('Buffer overflows', String(status.stats.audit_buffer_overflows)));
  }
  
  if (status.last_error) {
    lines.push('├─ Last Error ───────────────────────────────────┤');
    lines.push(padLine('Time', formatTimestamp(status.last_error.ts)));
    lines.push(padLine('Code', status.last_error.code));
    lines.push(padLine('Message', truncate(status.last_error.message, 30)));
  }
  
  lines.push('└────────────────────────────────────────────────┘');
  
  return lines.join('\n');
}

function padLine(label: string, value: string, width = 46): string {
  const prefix = `│ ${label}:`;
  const content = `${prefix} ${value}`;
  const paddingSize = width - content.length - 2;
  const padding = paddingSize > 0 ? ' '.repeat(paddingSize) : '';
  return `${content}${padding} │`;
}

function formatTimestamp(ts: string): string {
  return ts.replace('T', ' ').slice(0, 19);
}

function formatDuration(sec: number): string {
  const hours = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
