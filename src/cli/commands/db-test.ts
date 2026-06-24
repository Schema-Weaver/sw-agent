import { findDbEntry } from '../../config/db-config';
import { Pool, PoolConfig } from 'pg';
import * as fs from 'fs';

/**
 * Tests connection to a database configuration.
 */
export async function runDbTest(args: string[]): Promise<void> {
  const alias = args[0];
  if (!alias) {
    console.log('Usage: sw-agent db:test <alias>');
    process.exit(1);
  }

  const entry = findDbEntry(alias);
  if (!entry) {
    console.error(`Error: Database alias "${alias}" not found.`);
    process.exit(1);
  }

  console.log(`Testing ${alias} (${entry.host}:${entry.port}/${entry.database})...`);

  const passwordEnv = entry.password_env;
  const password = process.env[passwordEnv];

  if (!password) {
    console.error(`\n✗ Connection failed: Environment variable "${passwordEnv}" is not set.\n`);
    console.log('Troubleshooting:');
    console.log(`- Check that the password env var ${passwordEnv} is set`);
    console.log('- Check that the host is reachable from this machine');
    console.log('- Check that the PG user has login permission');
    console.log('- Check SSL configuration');
    process.exit(1);
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
      rejectUnauthorized: entry.ssl_mode === 'verify-ca' || entry.ssl_mode === 'verify-full',
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
        setTimeout(() => reject(new Error('Connection timed out (5s)')), 5000),
      ),
    ]);
    const latency = Date.now() - startTime;
    const versionStr = result.rows[0]?.version || 'unknown version';
    const dbName = result.rows[0]?.current_database || entry.database;
    const dbUser = result.rows[0]?.current_user || entry.user;

    console.log('\n✓ Connected');
    console.log(`  ${versionStr}`);
    console.log(`  Database: ${dbName}`);
    console.log(`  User: ${dbUser}`);
    console.log(`  Latency: ${latency}ms`);
    process.exit(0);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Connection failed: ${errMsg}\n`);
    console.log('Troubleshooting:');
    console.log(`- Check that the password env var ${passwordEnv} is set`);
    console.log('- Check that the host is reachable from this machine');
    console.log('- Check that the PG user has login permission');
    console.log('- Check SSL configuration');
    process.exit(1);
  } finally {
    await pool.end();
  }
}
