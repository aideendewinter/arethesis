// Copies the component kit's stylesheet and design tokens into dist/, and
// writes the drop-in theme boot script.
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootFile, loadTokens, POLYCHROME_RESOLVER_FILE, TOKENS_DIR } from './tokens.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
mkdirSync(resolve(dist, 'tokens'), { recursive: true });
copyFileSync(resolve(root, 'src/kit/theme.css'), resolve(dist, 'theme.css'));
copyFileSync(resolve(root, 'src/kit/theme-polychrome.css'), resolve(dist, 'theme-polychrome.css'));
for (const file of readdirSync(TOKENS_DIR)) if (file.endsWith('.json')) copyFileSync(resolve(TOKENS_DIR, file), resolve(dist, 'tokens', file));
writeFileSync(resolve(dist, 'theme-boot.js'), bootFile(loadTokens()));
writeFileSync(resolve(dist, 'theme-polychrome-boot.js'), bootFile(loadTokens(TOKENS_DIR, POLYCHROME_RESOLVER_FILE)));
console.log('Copied the theme stylesheets and design tokens to dist/, and wrote the theme boot scripts');
