import { closePrompts } from '../prompt';
import { loadMachineConfig } from '../../config/machine-config';

export interface LinkOptions {
  project?: string;
  token?: string;
}

export async function runLink(args: string[], opts: LinkOptions = {}): Promise<void> {
  const project = opts.project ?? args[0];
  
  const machineConfig = loadMachineConfig();
  if (!machineConfig) {
    console.error('Error: Machine config not found. Run "sw-agent init" first.');
    process.exit(1);
  }
  
  if (!project) {
    console.error('Error: Project name required.');
    console.log('Usage: sw-agent link <project> [token]');
    process.exit(1);
  }
  
  console.log(`Linking project "${project}" to agent ${machineConfig.agent_id}...`);
  console.log('');
  console.log('This command is a stub. In production, it would:');
  console.log('  1. Call the cloud API to register the project binding');
  console.log('  2. Store the binding in the local config');
  console.log('  3. Optionally test the connection');
  console.log('');
  console.log('For now, ensure your backend has the project configured');
  console.log('and the agent token matches what the backend expects.');
  console.log('');
  console.log(`Agent token: ${machineConfig.agent_token}`);
  console.log('');
  
  closePrompts();
  process.exit(0);
}
