#!/usr/bin/env node
import { VERSION } from '../index';
import { runInit } from './commands/init';
import { runDbAdd, runDbList, runDbTest, runDbRemove, runDbEdit } from './commands/db';
import { runProjectList, runProjectShow } from './commands/project';
import { runStart, runStop, runStatus, runRestart } from './commands/agent';
import { runDoctor } from './commands/doctor';
import { runLogs } from './commands/logs';
import { runAuditVerify } from './commands/audit-verify';
import { runConfigShow } from './commands/config-show';
import { runLink } from './commands/link';
import { startInteractive } from './interactive';
import { printBanner } from './banner';
import { C, clearScreen } from './ui';

const HELP_TEXT = `${C.bold('SW Agent')} v${VERSION}  ${C.dim('— bridge between your browser IDE and PostgreSQL')}

${C.dim('Usage:')} sw-agent ${C.cyan('<command>')} [options]
${C.dim('Run sw-agent with no arguments to start the interactive REPL.')}

${C.bold(C.brand('Databases'))}
  ${C.cyan('db list')}            List configured databases          ${C.dim('(alias: ls)')}
  ${C.cyan('db add')}             Add a database entry (interactive) ${C.dim('(alias: add)')}
  ${C.cyan('db edit <alias>')}    Edit a database entry
  ${C.cyan('db remove <alias>')}  Remove a database entry            ${C.dim('(alias: rm)')}
  ${C.cyan('db test <alias>')}    Test a connection                  ${C.dim('(--all to test every DB)')}

${C.bold(C.brand('Projects'))}
  ${C.cyan('project list')}       List linked projects               ${C.dim('(alias: projects)')}
  ${C.cyan('project show <name>')} Show details for a project

${C.bold(C.brand('Agent'))}
  ${C.cyan('agent start')}        Start the agent daemon             ${C.dim('(alias: up)')}
  ${C.cyan('agent stop')}         Stop the running agent             ${C.dim('(alias: down)')}
  ${C.cyan('agent status')}       Show agent + channel + DB status   ${C.dim('(alias: ps)')}
  ${C.cyan('agent restart')}      Restart the agent                  ${C.dim('(alias: restart)')}

${C.bold(C.brand('Setup & Ops'))}
  ${C.cyan('init')}               First-time setup on this machine
  ${C.cyan('doctor')}             Full diagnostic check              ${C.dim('(--fix to self-repair)')}
  ${C.cyan('config show')}        Show machine configuration          ${C.dim('(--token to reveal token)')}
  ${C.cyan('link <project>')}     Pairing stub for browser projects
  ${C.cyan('logs')}               View audit logs                    ${C.dim('(-f to follow)')}
  ${C.cyan('audit verify')}       Verify audit log integrity
  ${C.cyan('clear')}              Clear terminal and redraw status
  ${C.cyan('--version')}          Show version
  ${C.cyan('--help')}             Show this help
`;

class CLIError extends Error {
  constructor(public readonly exitCode: number, message: string) {
    super(message);
    this.name = 'CLIError';
  }
}

// Legacy colon-form commands, mapped to the new noun-verb form.
const LEGACY: Record<string, string> = {
  'db:ls': 'db list',
  'db:add': 'db add',
  'db:remove': 'db remove',
  'db:rm': 'db remove',
  'db:test': 'db test',
  'db:edit': 'db edit',
  'ls:projects': 'project list',
  'audit:verify': 'audit verify',
  'config:show': 'config show',
};

/** Alias map for quick one-word commands. */
const ALIASES: Record<string, string> = {
  'ls': 'db list',
  'add': 'db add',
  'rm': 'db remove',
  'projects': 'project list',
  'start': 'agent start',
  'stop': 'agent stop',
  'status': 'agent status',
  'ps': 'agent status',
  'up': 'agent start',
  'down': 'agent stop',
  'restart': 'agent restart',
};

/** Multi-word command router used by the non-interactive (bin) entry point. */
async function runNamed(command: string, rest: string[]): Promise<number> {
  // First check alias
  if (ALIASES[command]) {
    command = ALIASES[command];
  }

  // Two-word command detection
  const twoWordHeads = new Set([
    'db list', 'db add', 'db edit', 'db remove', 'db test',
    'project list', 'project show',
    'agent start', 'agent stop', 'agent status', 'agent restart',
    'config show',
    'audit verify',
  ]);

  let head = command;
  let args = rest;
  if (rest.length > 0) {
    const candidate = `${command} ${rest[0]}`;
    if (twoWordHeads.has(candidate)) {
      head = candidate;
      args = rest.slice(1);
    }
  }

  switch (head) {
    case 'init': await runInit(args); break;
    case 'db add': await runDbAdd(args); break;
    case 'db list': await runDbList(args); break;
    case 'db remove': await runDbRemove(args); break;
    case 'db test': await runDbTest(args); break;
    case 'db edit': await runDbEdit(args); break;
    case 'project list': await runProjectList(args); break;
    case 'project show': await runProjectShow(args); break;
    case 'agent start': await runStart(args); break;
    case 'agent stop': await runStop(args); break;
    case 'agent status': await runStatus(args); break;
    case 'agent restart': await runRestart(args); break;
    case 'doctor': await runDoctor(args); break;
    case 'config show': await runConfigShow(args); break;
    case 'link': await runLink(args); break;
    case 'logs': await runLogs(args); break;
    case 'audit verify': await runAuditVerify(args); break;
    case 'clear': clearScreen(); printBanner(); break;
    default:
      console.error(`\n  ${C.yellow('Unknown command:')} ${C.white(command)}`);
      console.error(`  ${C.dim('Run')} ${C.cyan('sw-agent --help')} ${C.dim('for usage.')}\n`);
      return 1;
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  // Handle --internal-daemon before any command parsing
  if (args.includes('--internal-daemon')) {
    const cleanArgs = args.filter((a) => a !== '--internal-daemon');
    await runStart(cleanArgs);
    return 0;
  }

  // No args, or --interactive / -i → drop into interactive REPL
  if (!command || command === '--interactive' || command === '-i') {
    return startInteractive();
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP_TEXT);
    return 0;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return 0;
  }

  // Legacy colon-form compatibility.
  if (LEGACY[command]) {
    console.error(`\n  ${C.yellow('Note:')} ${C.dim(`"${command}" is now "${LEGACY[command]}". The old form still works.`)}\n`);
    return runNamed(LEGACY[command], rest);
  }

  try {
    return await runNamed(command, rest);
  } catch (err) {
    if (err instanceof CLIError) {
      return err.exitCode;
    }
    if (err && typeof err === 'object' && '__exitCode' in err) {
      return (err as any).__exitCode as number;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n  ${C.red('Error:')} ${message}\n`);
    return 1;
  }
}

// Only auto-run when this module is the entry point, not when imported
if (require.main === module) {
  main(process.argv).then((code) => process.exit(code)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
