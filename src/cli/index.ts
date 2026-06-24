#!/usr/bin/env node
import { VERSION } from '../index';
import { runInit } from './commands/init';
import { runDbAdd } from './commands/db-add';
import { runDbLs } from './commands/db-ls';
import { runDbRemove } from './commands/db-remove';
import { runDbTest } from './commands/db-test';
import { runLsProjects } from './commands/ls-projects';
import { runStart } from './commands/start';
import { runStop } from './commands/stop';
import { runStatus } from './commands/status';
import { runDoctor } from './commands/doctor';
import { runLogs } from './commands/logs';
import { runAuditVerify } from './commands/audit-verify';
import { runLink } from './commands/link';

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

const HELP_TEXT = `
SW Agent v${VERSION}

Usage: sw-agent <command> [options]

Commands:
  init                  First-time setup on this machine
  link <project>        Bind this machine to a browser project
  unlink <project>      Remove project binding [stub]
  ls:projects           List projects linked to this machine
  db:add                Add a database entry (interactive)
  db:ls                 List database entries
  db:remove <alias>     Remove a database entry
  db:test <alias>       Ping a database
  start                 Start agent (foreground)
  start --daemon        Start as background daemon
  stop                  Stop running agent
  status                Show agent + tunnel + DB status
  logs                  Tail recent logs
  doctor                Full diagnostic check
  audit:verify          Verify audit log integrity
  --version, -v         Show version
  --help, -h            Show this help
`;

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    process.exit(0);
  }

  if (command === '--internal-daemon') {
    return;
  }

  try {
    switch (command) {
      case 'init':
        await runInit(rest);
        break;
      case 'db:add':
        await runDbAdd(rest);
        break;
      case 'db:ls':
        await runDbLs(rest);
        break;
      case 'db:remove':
        await runDbRemove(rest);
        break;
      case 'db:test':
        await runDbTest(rest);
        break;
      case 'ls:projects':
        await runLsProjects(rest);
        break;
      case 'link':
        await runLink(rest);
        break;
      case 'start':
        await runStart(rest);
        break;
      case 'stop':
        await runStop(rest);
        break;
      case 'status':
        await runStatus(rest);
        break;
      case 'logs':
        await runLogs(rest);
        break;
      case 'doctor':
        await runDoctor(rest);
        break;
      case 'audit:verify':
        await runAuditVerify(rest);
        break;
      case 'unlink':
        console.log(`[stub] Command "${command}" not yet implemented.`);
        process.exit(1);
        break;
      default:
        console.error(`Unknown command: ${command}\nRun "sw-agent --help" for usage.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

main();
