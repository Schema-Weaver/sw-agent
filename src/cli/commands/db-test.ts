import { findDbEntry, dbConfigExists, loadDbConfig } from '../../config/db-config';
import { Pool, PoolConfig } from 'pg';
import * as fs from 'fs';
import { isReplMode } from '../prompt';
import { C, S, createSpinner, renderTable } from '../ui';

function exit_(code: number): never {
  if (isReplMode()) {
    throw { __exitCode: code };
  }
  process.exit(code);
}

interface TestResult {
  alias: string;
  host: string;
  ok: boolean;
  latency: number;
  version: string;
  error: string;
}

async function testOne(
  entry: ReturnType<typeof findDbEntry> | null,
): Promise<TestResult> {
  if (!entry) {
    return { alias: '-', host: '-', ok: false, latency: 0, version: '', error: 'not found' };
  }

  const password =
    entry.password_stored ||
    (entry.password_env ? process.env[entry.password_env] : undefined);

  if (!password) {
    return {
      alias: entry.db_alias,
      host: `${entry.host}:${entry.port}`,
      ok: false,
      latency: 0,
      version: '',
      error: 'password not set',
    };
  }

  const poolConfig: PoolConfig = {
    host: entry.host,
    port: entry.port,
    database: entry.database,
    user: entry.user,
    password,
    connectionTimeoutMillis: 5000,
  };

  if (entry.ssl_mode !== 'disable') {
    poolConfig.ssl = {
      rejectUnauthorized:
        entry.ssl_mode === 'verify-ca' || entry.ssl_mode === 'verify-full',
    };
    if (entry.ssl_root_cert) {
      poolConfig.ssl.ca = fs.readFileSync(entry.ssl_root_cert, 'utf8');
    }
  }

  const pool = new Pool(poolConfig);
  const startTime = Date.now();

  try {
    const result = await Promise.race([
      pool.query('SELECT version(), current_database(), current_user;'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timed out (5s)')), 5000),
      ),
    ]);
    const latency = Date.now() - startTime;
    const raw = result.rows[0]?.version || 'unknown';
    const match = raw.match(/PostgreSQL [^\s,]+/);
    const versionStr = match ? match[0] : 'PostgreSQL';

    return {
      alias: entry.db_alias,
      host: `${entry.host}:${entry.port}`,
      ok: true,
      latency,
      version: versionStr,
      error: '',
    };
  } catch (err) {
    return {
      alias: entry.db_alias,
      host: `${entry.host}:${entry.port}`,
      ok: false,
      latency: Date.now() - startTime,
      version: '',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await pool.end();
  }
}

export async function runDbTest(args: string[]): Promise<void> {
  const testAll = args.includes('--all');

  if (testAll) {
    // Test every configured database concurrently.
    if (!dbConfigExists()) {
      console.log(`  ${C.yellow(S.warning)} No databases configured. Run ${C.cyan('db add')} first.`);
      exit_(0);
    }

    const config = loadDbConfig();
    if (config.length === 0) {
      console.log(`  ${C.yellow(S.warning)} No databases configured.`);
      exit_(0);
    }

    console.log();
    console.log(C.bold('  Testing all databases'));
    console.log();

    const spinner = createSpinner();
    spinner.start(`Testing ${C.white(String(config.length))} databases…`);

    const results = await Promise.all(config.map((db) => testOne(db)));

    spinner.stop();
    console.log();

    const rows = results.map((r) => ({
      alias: r.ok ? C.green(r.alias) : C.red(r.alias),
      host: C.dim(r.host),
      status: r.ok
        ? C.green(`${C.green(S.check)} ${r.latency}ms`)
        : C.red(`${S.cross} ${truncate(r.error, 30)}`),
      version: r.ok ? C.white(r.version) : C.dim('-'),
    }));

    console.log(
      renderTable(rows, {
        columns: [
          { key: 'alias', header: 'ALIAS', minWidth: 10, maxWidth: 18, priority: 0 },
          { key: 'host', header: 'HOST', minWidth: 14, maxWidth: 30, priority: 2 },
          { key: 'status', header: 'STATUS', minWidth: 12, maxWidth: 28, priority: 1 },
          { key: 'version', header: 'VERSION', minWidth: 12, maxWidth: 20, priority: 4 },
        ],
      }),
    );

    console.log();
    const ok = results.filter((r) => r.ok).length;
    console.log(
      `  ${ok === config.length
        ? C.green(`${S.check} All ${ok} databases connected successfully.`)
        : C.yellow(`${S.warning} ${ok}/${config.length} databases connected.`)
      }`,
    );
    console.log();
    exit_(ok === config.length ? 0 : 1);
  }

  // Single alias test.
  const alias = args[0];
  if (!alias) {
    console.log(`  ${C.yellow('Usage:')} ${C.white('db test <alias>')} ${C.dim('or')} ${C.white('db test --all')}`);
    exit_(1);
  }

  const entry = findDbEntry(alias);
  if (!entry) {
    console.log(`  ${C.red(S.cross)} Database alias "${C.white(alias)}" not found.`);
    console.log(
      `  ${C.dim('Run')} ${C.cyan('db list')} ${C.dim('to see available databases.')}`,
    );
    exit_(1);
  }

  console.log();
  console.log(
    `  ${C.bold('Testing')} ${C.white(alias)} ${C.dim(`(${entry.host}:${entry.port}/${entry.database})`)}`,
  );
  console.log();

  const spinner = createSpinner();
  spinner.start('Connecting…');

  const result = await testOne(entry);

  if (result.ok) {
    spinner.succeed(`Connected in ${C.green(`${result.latency}ms`)}`);
    console.log();
    console.log(`  ${C.green(S.check)} ${C.white(result.version)}`);
    console.log();
  } else {
    if (spinner) spinner.fail(`Connection failed: ${C.red(result.error)}`);
    console.log();
    exit_(1);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
