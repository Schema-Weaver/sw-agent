import { loadDbConfig, dbConfigExists } from '../../config/db-config';

/**
 * Lists projects currently registered inside db config entries.
 */
export async function runLsProjects(_args: string[]): Promise<void> {
  if (!dbConfigExists()) {
    console.log('No projects linked yet.');
    process.exit(0);
  }

  const config = loadDbConfig();
  if (config.length === 0) {
    console.log('No projects linked yet.');
    process.exit(0);
  }

  config.forEach((e) => {
    console.log(`${e.project_name.padEnd(11)} → ${e.db_alias} (${e.host}:${e.port})`);
  });

  process.exit(0);
}
