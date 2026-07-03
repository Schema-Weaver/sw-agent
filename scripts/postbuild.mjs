#!/usr/bin/env node

/**
 * Post-build script: ensures the CLI entry point has a shebang
 * and executable permissions. Runs after tsc build:cjs.
 */

import { readFile, writeFile, chmod } from 'node:fs/promises';

const CLI_PATH = 'dist/cjs/cli/index.js';

async function main() {
  try {
    const content = await readFile(CLI_PATH, 'utf8');
    if (!content.startsWith('#!')) {
      await writeFile(CLI_PATH, '#!/usr/bin/env node\n' + content);
      console.log('[postbuild] Injected shebang into', CLI_PATH);
    } else {
      console.log('[postbuild] Shebang already present in', CLI_PATH);
    }

    // Set executable bit (no-op on Windows, essential on Unix)
    await chmod(CLI_PATH, 0o755);
    console.log('[postbuild] Set executable permissions on', CLI_PATH);
  } catch (err) {
    console.error('[postbuild] Error:', err.message);
    process.exit(1);
  }
}

main();
