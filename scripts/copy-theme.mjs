// Copies the component kit's stylesheet and design tokens into dist/, and
// writes the drop-in theme boot script.
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootFile, loadTokens, TOKENS_DIR } from './tokens.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
mkdirSync(resolve(dist, 'tokens'), { recursive: true });
copyFileSync(resolve(root, 'src/kit/theme.css'), resolve(dist, 'theme.css'));
for (const file of readdirSync(TOKENS_DIR)) copyFileSync(resolve(TOKENS_DIR, file), resolve(dist, 'tokens', file));
writeFileSync(resolve(dist, 'theme-boot.js'), bootFile(loadTokens()));
console.log('Copied theme.css and design tokens to dist/, and wrote dist/theme-boot.js');
