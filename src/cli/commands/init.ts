import * as os from 'os';
import { ask, askConfirm, askChoice, closePrompts } from '../prompt';
import {
  createDefaultMachineConfig,
  saveMachineConfig,
  machineConfigExists,
  MachineConfig,
  PermissionLevel,
} from '../../config/machine-config';
import { getMachineConfigPath } from '../../config/paths';
import { generateAgentToken } from '../../config/token';

function padLine(label: string, value: string, width = 46): string {
  const prefix = `│ ${label}:`;
  const content = `${prefix} ${value}`;
  const paddingSize = width - content.length - 2;
  const padding = paddingSize > 0 ? ' '.repeat(paddingSize) : '';
  return `${content}${padding} │`;
}

function padPathLine(text: string, width = 46): string {
  const prefix = `│ ${text}`;
  const paddingSize = width - prefix.length - 2;
  const padding = paddingSize > 0 ? ' '.repeat(paddingSize) : '';
  return `${prefix}${padding} │`;
}

/**
 * Initializes first-time machine config setup.
 */
export async function runInit(_args: string[]): Promise<void> {
  if (machineConfigExists()) {
    const overwrite = await askConfirm('Machine config already exists. Overwrite?', false);
    if (!overwrite) {
      console.log('Aborted. No changes made.');
      closePrompts();
      process.exit(0);
    }
  }

  const defaultLabel = os
    .hostname()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  let machineLabel = '';
  for (;;) {
    machineLabel = await ask('Machine label', defaultLabel);
    if (
      /^[a-zA-Z0-9_-]+$/.test(machineLabel) &&
      machineLabel.length >= 1 &&
      machineLabel.length <= 64
    ) {
      break;
    }
    console.log(
      'Project name/machine label can only contain letters, numbers, hyphens, and underscores.',
    );
  }

  let cloudUrl = '';
  for (;;) {
    cloudUrl = await ask('Cloud URL', 'wss://agent.schema-weaver.dev');
    if ((cloudUrl.startsWith('wss://') || cloudUrl.startsWith('ws://')) && cloudUrl.length >= 10) {
      break;
    }
    console.log('Cloud URL must start with wss:// or ws:// and be at least 10 characters.');
  }

  console.log('\nDefault Permission Levels:');
  console.log('  - read_only: Only select queries are allowed.');
  console.log('  - auto_upgrade: Automatically executes select and approved schema migrations.');
  console.log('  - manual: Prompts for browser approval on every non-read query.');
  console.log('  - full: Allows any queries/migrations without checks.');

  const defaultPermission = (await askChoice(
    'default permission',
    ['read_only', 'auto_upgrade', 'manual', 'full'],
    'auto_upgrade',
  )) as PermissionLevel;

  const logLevel = (await askChoice(
    'log level',
    ['debug', 'info', 'warn', 'error'],
    'info',
  )) as MachineConfig['log_level'];

  const token = generateAgentToken();
  const config = createDefaultMachineConfig({
    machineLabel,
    cloudUrl,
    permission: defaultPermission,
    token,
  });
  config.log_level = logLevel;

  const pathStr = getMachineConfigPath();

  console.log('\n┌─ SW Agent Configuration ──────────────────────┐');
  console.log(padLine('Machine label', config.machine_label));
  console.log(padLine('Cloud URL', config.cloud_url));
  console.log(padLine('Agent ID', config.agent_id));
  console.log(padLine('Agent token', config.agent_token));
  console.log(padLine('Permission', config.default_permission));
  console.log(padLine('Log level', config.log_level));
  console.log('│                                                │');
  console.log(padPathLine(`Config path: ${pathStr}`));
  console.log('└────────────────────────────────────────────────┘');

  console.log("\n⚠️  SAVE YOUR TOKEN. You'll need it to link this agent to a browser project.");
  console.log('    The token is stored in the config file but is shown here only once');
  console.log('    in this summary.\n');

  const save = await askConfirm('Save?', true);
  if (save) {
    saveMachineConfig(config);
    console.log('✓ Config saved.');
    console.log('\nNext steps:');
    console.log('1. Add a database: sw-agent db:add');
    console.log('2. (Part 4) Start the agent: sw-agent start');
  } else {
    console.log('Aborted. Config not saved.');
  }

  closePrompts();
  process.exit(0);
}
