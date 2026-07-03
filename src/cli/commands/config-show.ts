import { loadMachineConfig } from '../../config/machine-config';
import { isReplMode } from '../prompt';
import { C, S } from '../ui';

function exit_(code: number): never {
  if (isReplMode()) {
    throw { __exitCode: code };
  }
  process.exit(code);
}

export async function runConfigShow(args: string[]): Promise<void> {
  try {
    const config = loadMachineConfig();
    const revealToken = args.includes('--token') || args.includes('-t');
    const json = args.includes('--json') || args.includes('-j');

    if (json) {
      console.log(JSON.stringify({
        ...config,
        agent_token: revealToken ? config.agent_token : redactToken(config.agent_token),
      }, null, 2));
      exit_(0);
    }

    console.log();
    console.log(C.bold('  Configuration'));
    console.log();
    console.log(`    ${C.bold('Agent ID:')}    ${C.cyan(config.agent_id)}`);
    console.log(`    ${C.bold('Label:')}       ${C.white(config.machine_label)}`);
    console.log(`    ${C.bold('Cloud URL:')}   ${C.white(config.cloud_url)}`);
    console.log(`    ${C.bold('Permission:')}  ${C.yellow(config.default_permission)}`);
    console.log(`    ${C.bold('Log level:')}   ${C.white(config.log_level)}`);
    console.log(`    ${C.bold('Token:')}      ${revealToken ? C.white(config.agent_token) : C.dim(redactToken(config.agent_token) + ' (use --token to reveal)')}`);

    if (revealToken) {
      console.log();
      console.log(`  ${C.yellow(S.warning)} ${C.yellow('Token revealed because --token was provided.')}`);
    }

    console.log();
  } catch (err: any) {
    console.log(`  ${C.red('Error:')} ${err.message}`);
  }
  exit_(0);
}

function redactToken(token: string): string {
  if (token.length <= 12) return '***';
  return `${token.slice(0, 10)}...${token.slice(-4)}`;
}
