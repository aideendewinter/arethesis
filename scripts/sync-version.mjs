// Runs as the npm "version" lifecycle script: copies the new package.json
// version into src/version.ts and stages it, so `npm version` commits both.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const file = resolve(root, 'src/version.ts');
const source = readFileSync(file, 'utf8');
const next = source.replace(/export const VERSION = '[^']*';/, `export const VERSION = '${version}';`);
if (next === source && !source.includes(`'${version}'`)) throw new Error('src/version.ts: VERSION not found');
writeFileSync(file, next);
execFileSync('git', ['add', file], { cwd: root });
console.log(`src/version.ts → ${version}`);
