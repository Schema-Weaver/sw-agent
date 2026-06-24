import { askConfirm, closePrompts } from '../prompt';
import { removeDbEntry, findDbEntry } from '../../config/db-config';

/**
 * Removes a database config by alias.
 */
export async function runDbRemove(args: string[]): Promise<void> {
  const alias = args[0];
  if (!alias) {
    console.log('Usage: sw-agent db:remove <alias>');
    process.exit(1);
  }

  const entry = findDbEntry(alias);
  if (!entry) {
    console.error(`Error: Database alias "${alias}" not found.`);
    process.exit(1);
  }

  const confirm = await askConfirm(
    `Remove database "${alias}" (project: ${entry.project_name}, host: ${entry.host})?`,
    false,
  );
  if (confirm) {
    const removed = removeDbEntry(alias);
    if (removed) {
      console.log(`✓ Removed ${alias}.`);
    } else {
      console.error(`Error: Failed to remove database "${alias}".`);
    }
  } else {
    console.log('Aborted.');
  }

  closePrompts();
  process.exit(0);
}
