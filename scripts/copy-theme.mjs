// Copies the component kit's stylesheet and design tokens into dist/, writes
// the drop-in theme boot script, and writes the two entry files that 0.2 and
// earlier published (dist/arethesis.js, dist/components.js), so deep links
// and old CDN URLs keep working.
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
writeFileSync(resolve(dist, 'arethesis.js'), "// Kept for compatibility; the entry is ./index.js.\nexport * from './index.js';\n");
writeFileSync(resolve(dist, 'components.js'), "// Kept for compatibility; the entry is ./kit/index.js.\nexport * from './kit/index.js';\n");
console.log('Copied the theme stylesheets and design tokens to dist/, wrote the theme boot scripts and the compatibility entries');
