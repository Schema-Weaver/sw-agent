import { loadDbConfig, dbConfigExists } from '../../config/db-config';

/**
 * Lists database configurations.
 */
export async function runDbLs(args: string[]): Promise<void> {
  if (!dbConfigExists()) {
    console.log('No databases configured. Run `sw-agent db:add` to add one.');
    process.exit(0);
  }

  const config = loadDbConfig();
  if (config.length === 0) {
    console.log('No databases configured. Run `sw-agent db:add` to add one.');
    process.exit(0);
  }

  const isJson = args.includes('--json');
  if (isJson) {
    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
  }

  const headers = ['ALIAS', 'PROJECT', 'HOST', 'PORT', 'DATABASE', 'SSL', 'PERMISSION'];
  const rows = config.map((e) => [
    e.db_alias,
    e.project_name,
    e.host,
    String(e.port),
    e.database,
    e.ssl_mode,
    e.permission_override || '(default)',
  ]);

  const widths = headers.map((h, i) => {
    return Math.max(h.length, ...rows.map((row) => row[i].length));
  });

  const headerStr = headers.map((h, i) => h.padEnd(widths[i] + 2)).join('');
  console.log(headerStr.trimEnd());

  rows.forEach((row) => {
    const rowStr = row.map((val, i) => val.padEnd(widths[i] + 2)).join('');
    console.log(rowStr.trimEnd());
  });

  process.exit(0);
}
