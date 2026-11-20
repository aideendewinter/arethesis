// Checks that every path in package.json `exports` exists in dist/ (one
// example per wildcard). Run after `npm run build`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const missing = [];
const check = (key, target) => {
  if (!target.includes('*')) {
    if (!existsSync(resolve(root, target))) missing.push(`${key} → ${target}`);
    return;
  }
  const dir = resolve(root, dirname(target));
  const [, suffix] = target.split('*');
  if (!existsSync(dir) || !readdirSync(dir).some(f => f.endsWith(suffix))) missing.push(`${key} → ${target} (no matches)`);
};
for (const [key, value] of Object.entries(pkg.exports)) {
  for (const target of typeof value === 'string' ? [value] : Object.values(value)) check(key, target);
}
for (const field of ['main', 'module', 'types']) check(field, pkg[field]);
if (missing.length) {
  console.error(`Missing export targets:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`All ${Object.keys(pkg.exports).length} export targets exist.`);
