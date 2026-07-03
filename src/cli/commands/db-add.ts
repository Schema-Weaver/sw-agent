import { ask, askConfirm, askSecret, askChoice, closePrompts, isReplMode } from '../prompt';
import { machineConfigExists } from '../../config/machine-config';
import { addDbEntry, findDbByProject, removeDbEntry, DbEntry } from '../../config/db-config';
import {
  isValidIdentifier,
  isValidHostname,
  isValidIpv4,
  isValidIpv6,
} from '../../config/schema';
import { PermissionLevel } from '../../config/machine-config';
import { Pool, PoolConfig } from 'pg';
import * as fs from 'fs';
import { C, S, check, separator, createSpinner } from '../ui';

function exit_(code: number): never {
  closePrompts();
  if (isReplMode()) {
    throw { __exitCode: code };
  }
  process.exit(code);
}

export async function runDbAdd(_args: string[]): Promise<void> {
  if (!machineConfigExists()) {
    console.log(`  ${C.red(S.cross)} Error: Run ${C.cyan('init')} first.`);
    exit_(1);
  }

  console.log();
  console.log(C.bold(C.brand('  Add a Database')));
  console.log(separator('', 50));
  console.log();

  let projectName = '';
  for (;;) {
    projectName = await ask('Project name');
    if (projectName.trim() === '') continue;
    if (isValidIdentifier(projectName, 64) && !projectName.includes(' ')) {
      break;
    }
    console.log(`  ${C.red(S.cross)} Use letters, numbers, hyphens, underscores only.`);
  }

  // One-DB-per-project: check before proceeding and offer recovery.
  const existing = findDbByProject(projectName);
  if (existing) {
    console.log();
    console.log(
      `  ${C.yellow(S.warning)} Project "${C.white(projectName)}" already has a database:`,
    );
    console.log(
      `    ${C.cyan(existing.db_alias)}  ${C.dim(`${existing.host}:${existing.port}/${existing.database}`)}`,
    );
    console.log();
    console.log(`  ${C.dim('Schema Weaver allows one database per project.')}`);
    console.log();

    const fix = await askChoice(
      'What would you like to do?',
      ['Use a different project name', 'Remove existing and re-add', 'Cancel'],
      'Use a different project name',
    );

    if (fix === 'Cancel') {
      console.log(`  ${C.dim('Aborted.')}`);
      exit_(0);
    }
    if (fix === 'Remove existing and re-add') {
      const confirm = await askConfirm(
        C.red(`Remove "${existing.db_alias}" and add a new entry?`),
        false,
      );
      if (!confirm) {
        console.log(`  ${C.dim('Aborted.')}`);
        exit_(0);
      }
      removeDbEntry(existing.db_alias);
      console.log(`  ${check(`Removed existing entry ${C.cyan(existing.db_alias)}.`)}`);
      console.log();
    } else {
      // Loop back to re-ask the project name.
      console.log();
      for (;;) {
        projectName = await ask('Project name');
        if (projectName.trim() === '' && isValidIdentifier(projectName, 64) && !projectName.includes(' ')) continue;
        if (projectName.trim() !== '' && isValidIdentifier(projectName, 64) && !projectName.includes(' ')) break;
        console.log(`  ${C.red(S.cross)} Use letters, numbers, hyphens, underscores only.`);
      }
    }
  }

  console.log(`  ${check(`Project: ${C.white(projectName)}`)}`);
  console.log();

  let dbAlias = '';
  for (;;) {
    dbAlias = await ask('Database alias');
    if (dbAlias.trim() === '') continue;
    if (isValidIdentifier(dbAlias, 64) && !dbAlias.includes(' ')) {
      break;
    }
    console.log(`  ${C.red(S.cross)} Use letters, numbers, hyphens, underscores only.`);
  }
  console.log(`  ${check(`Alias: ${C.white(dbAlias)}`)}`);
  console.log();

  let host = '';
  for (;;) {
    host = await ask('Host', 'localhost');
    if (host.trim() === '') continue;
    if (isValidHostname(host) || isValidIpv4(host) || isValidIpv6(host)) {
      break;
    }
    console.log(`  ${C.red(S.cross)} Invalid hostname or IP.`);
  }
  console.log(`  ${check(`Host: ${C.white(host)}`)}`);
  console.log();

  let portVal = 5432;
  for (;;) {
    const portStr = await ask('Port', '5432');
    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port >= 1 && port <= 65535) {
      portVal = port;
      break;
    }
    console.log(`  ${C.red(S.cross)} Port must be 1-65535.`);
  }
  console.log(`  ${check(`Port: ${C.white(String(portVal))}`)}`);
  console.log();

  let database = '';
  for (;;) {
    database = await ask('Database name');
    if (database.trim() === '') continue;
    if (database.length <= 63) {
      break;
    }
    console.log(`  ${C.red(S.cross)} Database name too long (max 63).`);
  }
  console.log(`  ${check(`Database: ${C.white(database)}`)}`);
  console.log();

  let user = '';
  for (;;) {
    user = await ask('Username');
    if (user.trim() === '') continue;
    if (user.length <= 63) {
      break;
    }
    console.log(`  ${C.red(S.cross)} Username too long (max 63).`);
  }
  console.log(`  ${check(`User: ${C.white(user)}`)}`);
  console.log();

  // Password: prefer env var, allow stored as fallback
  const passwordChoice = await askChoice(
    'Password storage',
    ['Environment variable', 'Store directly (less secure)'],
    'Environment variable',
  );

  let passwordEnv: string | undefined;
  let passwordStored: string | undefined;

  if (passwordChoice === 'Environment variable') {
    const envVar = await ask('Environment variable name', 'DB_PASSWORD');
    if (envVar && /^[A-Z][A-Z0-9_]*$/.test(envVar)) {
      passwordEnv = envVar;
    } else {
      console.log(
        `  ${C.yellow(S.warning)} Invalid env var name. Using stored password instead.`,
      );
      passwordStored = await askSecret('Password');
    }
  } else {
    passwordStored = await askSecret('Password');
  }

  const sslMode = (await askChoice(
    'SSL mode',
    ['disable', 'require', 'verify-ca', 'verify-full'],
    'require',
  )) as DbEntry['ssl_mode'];

  let sslRootCert: string | null = null;
  if (sslMode !== 'disable') {
    for (;;) {
      const certPath = await ask('SSL root cert path', '');
      if (certPath.trim() === '') {
        sslRootCert = null;
        break;
      }
      if (fs.existsSync(certPath)) {
        sslRootCert = certPath;
        break;
      }
      console.log(`  ${C.red(S.cross)} Cert file not found.`);
    }
  }

  const permOverride = await askChoice(
    'Permission',
    ['read_only', 'auto_upgrade', 'manual', 'full', 'use default'],
    'use default',
  );
  const finalPerm =
    permOverride === 'use default' ? null : (permOverride as PermissionLevel);

  const entry: Omit<DbEntry, 'created_at'> = {
    project_name: projectName,
    db_alias: dbAlias,
    host,
    port: portVal,
    database,
    user,
    password_env: passwordEnv,
    password_stored: passwordStored,
    ssl_mode: sslMode,
    ssl_root_cert: sslRootCert,
    permission_override: finalPerm,
  };

  // Test connection BEFORE saving
  const spinner = createSpinner();
  spinner.start(`Testing connection to ${C.white(dbAlias)}...`);

  const poolConfig: PoolConfig = {
    host: entry.host,
    port: entry.port,
    database: entry.database,
    user: entry.user,
    password: passwordEnv
      ? process.env[passwordEnv] || ''
      : passwordStored || '',
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
  let connectionOk = false;
  let connectionError = '';
  let versionStr = '';

  try {
    const result = await Promise.race([
      pool.query('SELECT version();'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out (5s)')), 5000),
      ),
    ]);
    versionStr = result.rows[0]?.version || 'unknown version';
    const match = versionStr.match(/PostgreSQL [^\s,]+/);
    versionStr = match ? match[0] : 'PostgreSQL';
    connectionOk = true;
  } catch (connErr) {
    connectionError =
      connErr instanceof Error ? connErr.message : String(connErr);
  } finally {
    await pool.end();
  }

  if (!connectionOk) {
    spinner.fail(`Connection failed: ${C.red(connectionError)}`);
    console.log();
    const saveAnyway = await askConfirm(
      C.yellow('Connection failed. Save entry anyway?'),
      false,
    );
    if (!saveAnyway) {
      console.log(`  ${C.yellow(S.warning)} Aborted. No entry saved.`);
      exit_(0);
    }
  } else {
    spinner.succeed(`Connected. ${C.green(versionStr)}`);
  }

  try {
    addDbEntry(entry);
  } catch (err) {
    console.log(
      `  ${C.red(S.cross)} Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    exit_(1);
  }

  console.log();
  console.log(
    `  ${C.green(S.check)} ${C.brightGreen('Database added successfully!')}`,
  );
  console.log();
  console.log(`  ${C.bold('Summary:')}`);
  console.log(`    Project:    ${C.white(projectName)}`);
  console.log(`    Alias:      ${C.white(dbAlias)}`);
  console.log(`    Host:       ${C.white(host)}:${C.white(String(portVal))}`);
  console.log(`    Database:   ${C.white(database)}`);
  console.log(`    User:       ${C.white(user)}`);
  console.log(`    SSL:        ${C.white(sslMode)}`);
  console.log(
    `    Password:   ${passwordEnv ? C.green('env var') : C.yellow('stored')}`,
  );
  console.log(
    `    Permission: ${C.yellow(permOverride)}`,
  );
  console.log();
  console.log(
    `  ${C.dim('Next:')} ${C.cyan('agent start')} ${C.dim('to start the agent.')}`,
  );
  console.log();
  exit_(0);
}
