import { ask, askChoice, askSecret, closePrompts, isReplMode } from '../prompt';
import { findDbEntry, loadDbConfig, saveDbConfig, DbEntry } from '../../config/db-config';
import {
  isValidIdentifier,
  isValidHostname,
  isValidIpv4,
  isValidIpv6,
} from '../../config/schema';
import { PermissionLevel } from '../../config/machine-config';
import * as fs from 'fs';
import { C, S, check, separator, cross } from '../ui';

function exit_(code: number): never {
  closePrompts();
  if (isReplMode()) {
    throw { __exitCode: code };
  }
  process.exit(code);
}

export async function runDbEdit(args: string[]): Promise<void> {
  const alias = args[0];
  if (!alias) {
    console.log(`  ${C.yellow('Usage:')} ${C.white('db edit <alias>')}`);
    exit_(1);
  }

  const entry = findDbEntry(alias);
  if (!entry) {
    console.log(`  ${C.red(S.cross)} Database alias "${C.white(alias)}" not found.`);
    console.log(`  ${C.dim('Run')} ${C.cyan('db list')} ${C.dim('to see available databases.')}`);
    exit_(1);
  }

  console.log();
  console.log(C.bold(C.brand(`  Edit database: ${C.white(alias)}`)));
  console.log(separator('', 50));
  console.log();

  // Ask which field(s) to edit — skip if only one field is requested.
  const field = args[1];
  let fieldsToEdit: readonly string[];
  if (field && VALID_FIELDS.includes(field as any)) {
    fieldsToEdit = [field];
  } else {
    const choice = await askChoice(
      'Which field to edit?',
      [...VALID_FIELDS, 'all'] as string[],
      'all',
    );
    fieldsToEdit = choice === 'all' ? VALID_FIELDS : ([choice] as const);
  }

  const config = loadDbConfig();
  const idx = config.findIndex((e) => e.db_alias === alias);
  const newEntry: Partial<DbEntry> = { ...entry };

  if (fieldsToEdit.includes('project_name')) {
    const val = await ask(`Project name`, entry.project_name);
    if (val && isValidIdentifier(val, 64)) newEntry.project_name = val;
    else console.log(`  ${cross('Invalid, keeping current.')}`);
  }
  if (fieldsToEdit.includes('host')) {
    const val = await ask(`Host`, entry.host);
    if (val && (isValidHostname(val) || isValidIpv4(val) || isValidIpv6(val)))
      newEntry.host = val;
    else console.log(`  ${cross('Invalid, keeping current.')}`);
  }
  if (fieldsToEdit.includes('port')) {
    const val = await ask(`Port`, String(entry.port));
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 1 && num <= 65535) newEntry.port = num;
    else console.log(`  ${cross('Invalid, keeping current.')}`);
  }
  if (fieldsToEdit.includes('database')) {
    const val = await ask(`Database name`, entry.database);
    if (val && val.length <= 63) newEntry.database = val;
    else console.log(`  ${cross('Invalid, keeping current.')}`);
  }
  if (fieldsToEdit.includes('user')) {
    const val = await ask(`Username`, entry.user);
    if (val && val.length <= 63) newEntry.user = val;
    else console.log(`  ${cross('Invalid, keeping current.')}`);
  }
  if (fieldsToEdit.includes('password')) {
    const pwChoice = await askChoice(
      'Password',
      ['Keep current', 'Use environment variable', 'Enter new password'],
      'Keep current',
    );
    if (pwChoice === 'Use environment variable') {
      const envVar = await ask('Env var name', entry.password_env || 'DB_PASSWORD');
      newEntry.password_env = envVar;
      newEntry.password_stored = undefined;
    } else if (pwChoice === 'Enter new password') {
      const pw = await askSecret('Password');
      newEntry.password_stored = pw;
      newEntry.password_env = undefined;
    }
  }
  if (fieldsToEdit.includes('ssl')) {
    const newSsl = await askChoice(
      'SSL mode',
      ['disable', 'require', 'verify-ca', 'verify-full'],
      entry.ssl_mode,
    );
    newEntry.ssl_mode = newSsl as DbEntry['ssl_mode'];

    if (newEntry.ssl_mode !== 'disable') {
      const cert = await ask('SSL root cert path', entry.ssl_root_cert || '');
      if (cert.trim() === '') {
        newEntry.ssl_root_cert = null;
      } else if (fs.existsSync(cert)) {
        newEntry.ssl_root_cert = cert;
      } else {
        console.log(`  ${C.yellow(S.warning)} Cert file not found. Keeping existing.`);
      }
    } else {
      newEntry.ssl_root_cert = null;
    }
  }
  if (fieldsToEdit.includes('permission')) {
    const perm = await askChoice(
      'Permission',
      ['read_only', 'auto_upgrade', 'manual', 'full', 'use default'],
      entry.permission_override || 'use default',
    );
    newEntry.permission_override =
      perm === 'use default' ? null : (perm as PermissionLevel);
  }

  const updatedEntry: DbEntry = {
    ...entry,
    ...newEntry,
    created_at: entry.created_at,
  };

  config[idx] = updatedEntry;
  saveDbConfig(config);

  console.log();
  console.log(`  ${check('Database updated successfully.')}`);
  console.log();
  console.log(`  ${C.bold('Updated fields:')}`);
  for (const f of fieldsToEdit) {
    const label = FIELD_LABELS[f] || f;
    const val = (updatedEntry as any)[f];
    console.log(`    ${C.bold(label.padEnd(14))} ${C.white(String(val ?? 'default'))}`);
  }
  console.log();
  exit_(0);
}

const VALID_FIELDS = [
  'project_name',
  'host',
  'port',
  'database',
  'user',
  'password',
  'ssl',
  'permission',
] as const;

const FIELD_LABELS: Record<string, string> = {
  project_name: 'Project',
  host: 'Host',
  port: 'Port',
  database: 'Database',
  user: 'User',
  password: 'Password',
  ssl: 'SSL',
  permission: 'Permission',
};
