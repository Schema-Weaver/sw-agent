import { ask, askChoice, closePrompts } from '../prompt';
import { machineConfigExists } from '../../config/machine-config';
import { addDbEntry, DbEntry } from '../../config/db-config';
import {
  isValidIdentifier,
  isValidHostname,
  isValidIpv4,
  isValidIpv6,
  isValidEnvVarName,
} from '../../config/schema';
import { PermissionLevel } from '../../config/machine-config';
import { Pool, PoolConfig } from 'pg';
import * as fs from 'fs';

/**
 * Adds a database entry to the databases config file.
 */
export async function runDbAdd(_args: string[]): Promise<void> {
  if (!machineConfigExists()) {
    console.error('Error: Run `sw-agent init` first.');
    process.exit(1);
  }

  let projectName = '';
  for (;;) {
    projectName = await ask('Project name');
    if (isValidIdentifier(projectName, 64) && !projectName.includes(' ')) {
      break;
    }
    console.log('Project name can only contain letters, numbers, hyphens, and underscores.');
  }

  let dbAlias = '';
  for (;;) {
    dbAlias = await ask('Database alias');
    if (isValidIdentifier(dbAlias, 64) && !dbAlias.includes(' ')) {
      break;
    }
    console.log('Database alias can only contain letters, numbers, hyphens, and underscores.');
  }

  let host = '';
  for (;;) {
    host = await ask('Host');
    if (host.length > 0 && (isValidHostname(host) || isValidIpv4(host) || isValidIpv6(host))) {
      break;
    }
    console.log('Host must be a valid hostname or IP address.');
  }

  let portVal = 5432;
  for (;;) {
    const portStr = await ask('Port', '5432');
    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port >= 1 && port <= 65535) {
      portVal = port;
      break;
    }
    console.log('Port must be between 1 and 65535.');
  }

  let database = '';
  for (;;) {
    database = await ask('Database name');
    if (database.length > 0 && database.length <= 63) {
      break;
    }
    console.log('Database name must be 1-63 characters.');
  }

  let user = '';
  for (;;) {
    user = await ask('Username');
    if (user.length > 0 && user.length <= 63) {
      break;
    }
    console.log('Username must be 1-63 characters.');
  }

  let passwordEnv = '';
  for (;;) {
    passwordEnv = await ask('Password env var name (e.g. VOXA_PROD_PW)');
    if (isValidEnvVarName(passwordEnv)) {
      break;
    }
    console.log(
      'Env var name must be uppercase letters, digits, and underscores, starting with a letter.',
    );
  }

  const sslMode = (await askChoice(
    'SSL mode',
    ['disable', 'require', 'verify-ca', 'verify-full'],
    'require',
  )) as DbEntry['ssl_mode'];

  let sslRootCert: string | null = null;
  for (;;) {
    const certPath = await ask('SSL root cert path (null = none)', 'null');
    if (certPath.toLowerCase() === 'null' || certPath === '') {
      sslRootCert = null;
      break;
    }
    if (fs.existsSync(certPath)) {
      sslRootCert = certPath;
      break;
    }
    console.log(`SSL root cert path does not exist on disk: ${certPath}`);
  }

  const permOverride = await askChoice(
    'Permission override (null = use machine default)',
    ['read_only', 'auto_upgrade', 'manual', 'full', 'null'],
    'null',
  );
  const finalPerm = permOverride === 'null' ? null : (permOverride as PermissionLevel);

  const entry = {
    project_name: projectName,
    db_alias: dbAlias,
    host,
    port: portVal,
    database,
    user,
    password_env: passwordEnv,
    ssl_mode: sslMode,
    ssl_root_cert: sslRootCert,
    permission_override: finalPerm,
  };

  try {
    addDbEntry(entry);
  } catch (err) {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
    closePrompts();
    process.exit(1);
  }

  console.log(`\nTesting connection to ${dbAlias}...`);
  const password = process.env[passwordEnv];
  if (!password) {
    console.log(
      `⚠️  Warning: Password env var "${passwordEnv}" is not set. Skipping connection test.`,
    );
  } else {
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
        rejectUnauthorized: entry.ssl_mode === 'verify-ca' || entry.ssl_mode === 'verify-full',
      };
      if (entry.ssl_root_cert) {
        poolConfig.ssl.ca = fs.readFileSync(entry.ssl_root_cert, 'utf8');
      }
    }

    const pool = new Pool(poolConfig);
    try {
      const result = await Promise.race([
        pool.query('SELECT version();'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timed out (5s)')), 5000),
        ),
      ]);
      const versionStr = result.rows[0]?.version || 'unknown version';
      const match = versionStr.match(/PostgreSQL [^\s,]+/);
      const shortVersion = match ? match[0] : 'PostgreSQL';
      console.log(`✓ Connected. ${shortVersion}`);
    } catch (connErr) {
      console.log(
        `⚠️  Connection failed: ${connErr instanceof Error ? connErr.message : String(connErr)}. Entry saved but you'll need to fix this before starting the agent.`,
      );
    } finally {
      await pool.end();
    }
  }

  console.log(`\nMake sure the password env var is set before starting the agent:`);
  console.log(`  export ${passwordEnv}="your-password-here"\n`);
  console.log('✓ Database entry added.');

  closePrompts();
  process.exit(0);
}
