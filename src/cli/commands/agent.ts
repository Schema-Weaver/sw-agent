
import { runStart } from './start';
import { runStop } from './stop';
import { runStatus } from './status';

export { runStart, runStop, runStatus };

export async function runRestart(args: string[]): Promise<void> {
  await runStop(args);
  await runStart(args);
}
