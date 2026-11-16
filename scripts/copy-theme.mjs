// Copies the component kit stylesheet into dist/.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'dist'), { recursive: true });
copyFileSync(resolve(root, 'src/kit/theme.css'), resolve(root, 'dist/theme.css'));
console.log('Copied theme.css to dist/');
