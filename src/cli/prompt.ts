import * as readline from 'readline';

let rl: readline.Interface | null = null;

function getInterface(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.on('SIGINT', () => {
      console.log('\nCancelled.');
      if (rl) {
        rl.close();
      }
      process.exit(0);
    });
  }
  return rl;
}

/**
 * Shows "Question [default]: " and returns user input or default. Trims whitespace.
 */
export function ask(question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const promptInterface = getInterface();
    const displayDefault = defaultValue !== undefined ? ` [${defaultValue}]` : '';
    promptInterface.question(`${question}${displayDefault}: `, (answer) => {
      const trimmed = answer.trim();
      if (trimmed === '' && defaultValue !== undefined) {
        resolve(defaultValue);
      } else {
        resolve(trimmed);
      }
    });
  });
}

/**
 * Shows "Question: " and reads input. Warnings about password masking if TTY.
 */
export function askSecret(question: string): Promise<string> {
  if (process.stdin.isTTY) {
    console.warn('⚠️  Warning: Password masking is not supported yet. Your input will be visible.');
  }
  return new Promise((resolve) => {
    const promptInterface = getInterface();
    promptInterface.question(`${question}: `, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Shows numbered choices. Users can type either index number or exact value.
 */
export async function askChoice(
  question: string,
  choices: string[],
  defaultValue?: string,
): Promise<string> {
  console.log(`\nAvailable choices for ${question}:`);
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choice}`);
  });

  for (;;) {
    const ans = await ask(`Select choice (1-${choices.length})`, defaultValue);
    const idx = parseInt(ans, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= choices.length) {
      return choices[idx - 1];
    }
    const match = choices.find((c) => c.toLowerCase() === ans.toLowerCase());
    if (match) {
      return match;
    }
    console.log(
      `Invalid selection. Please enter a number between 1 and ${choices.length} or type the choice exactly.`,
    );
  }
}

/**
 * Shows "Question (Y/n): " or "Question (y/N): " based on default and returns boolean.
 */
export async function askConfirm(question: string, defaultValue: boolean): Promise<boolean> {
  const displaySuffix = defaultValue ? ' (Y/n)' : ' (y/N)';
  for (;;) {
    const ans = await ask(`${question}${displaySuffix}`);
    if (ans === '') {
      return defaultValue;
    }
    const lower = ans.toLowerCase();
    if (lower === 'y' || lower === 'yes') {
      return true;
    }
    if (lower === 'n' || lower === 'no') {
      return false;
    }
    console.log('Please enter "y" or "n".');
  }
}

/**
 * Closes the readline interface.
 */
export function closePrompts(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}
