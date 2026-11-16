// Regenerate everything derived from the design tokens in src/kit/tokens:
//   - the custom properties in src/kit/theme.css (between the generated markers)
//   - src/kit/theme-boot.generated.ts (critical CSS for flash-free loading)
// `node scripts/build-tokens.mjs --check` fails instead of writing if anything is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { criticalCss, loadTokens, TOKENS_DIR, withThemeCss } from './tokens.mjs';

const check = process.argv.includes('--check');
const loaded = loadTokens();
const outputs = {
  [resolve(TOKENS_DIR, '../theme.css')]: css => withThemeCss(css, loaded),
  [resolve(TOKENS_DIR, '../theme-boot.generated.ts')]: () => `// Generated from src/kit/tokens by \`npm run tokens\`; do not edit by hand.

/** Background, text color and color-scheme for every theme: what a page needs before its stylesheet loads. */
export const CRITICAL_CSS = ${JSON.stringify(criticalCss(loaded))};
`,
};

let stale = 0;
for (const [file, generate] of Object.entries(outputs)) {
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    /* new file */
  }
  const next = generate(current);
  if (next === current) continue;
  if (check) {
    console.error(`Out of date: ${file}. Run \`npm run tokens\`.`);
    stale++;
  } else {
    writeFileSync(file, next);
    console.log(`Wrote ${file}`);
  }
}
if (stale) process.exit(1);
if (!check) console.log('Design tokens are valid and everything generated from them is up to date.');
