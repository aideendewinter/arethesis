// Measures the minified bundles and checks them against size-budget.json.
// Run after `npm run build`. `--update` rewrites the budgets from this build
// plus 5% headroom; do that deliberately, in the commit that adds the weight.
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { bundle, fixtures } from './bundle-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budgetFile = resolve(root, 'size-budget.json');
const update = process.argv.includes('--update');

const measure = (code) => ({
  min: Buffer.byteLength(code),
  gzip: gzipSync(code, { level: 9 }).length,
  brotli: brotliCompressSync(code).length,
});

const rows = [];
const cdn = resolve(root, 'dist/cdn');
const chunks = readdirSync(resolve(cdn, 'chunks')).filter(f => f.endsWith('.js')).map(f => readFileSync(resolve(cdn, 'chunks', f), 'utf8'));
for (const file of ['arethesis.min.js', 'components.min.js']) {
  rows.push({ name: `cdn/${file}`, ...measure(readFileSync(resolve(cdn, file), 'utf8')) });
}
rows.push({ name: 'cdn/ (all files)', ...measure([...['arethesis.min.js', 'components.min.js'].map(f => readFileSync(resolve(cdn, f), 'utf8')), ...chunks].join('\n')) });
for (const fixture of fixtures) rows.push({ name: `app: ${fixture.name}`, ...measure((await bundle(fixture)).total) });

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
let budgets = {};
try {
  budgets = JSON.parse(readFileSync(budgetFile, 'utf8'));
} catch {
  /* no budgets yet */
}

if (update) {
  const next = Object.fromEntries(rows.map(r => [r.name, Math.ceil((r.gzip * 1.05) / 100) * 100]));
  writeFileSync(budgetFile, JSON.stringify(next, null, 2) + '\n');
  console.log(`Wrote ${rows.length} budgets (gzip bytes) to size-budget.json`);
}

let over = 0;
const lines = ['| Bundle | Minified | Gzip | Brotli | Budget (gzip) |', '| --- | ---: | ---: | ---: | ---: |'];
for (const r of rows) {
  const budget = update ? undefined : budgets[r.name];
  const bad = budget !== undefined && r.gzip > budget;
  if (bad) over++;
  lines.push(`| ${r.name} | ${kb(r.min)} | ${kb(r.gzip)} | ${kb(r.brotli)} | ${budget === undefined ? '—' : `${kb(budget)}${bad ? ' ✗' : ''}`} |`);
}
const table = lines.join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bundle size\n\n${table}\n`);
if (!update) {
  const missing = rows.filter(r => budgets[r.name] === undefined).map(r => r.name);
  if (missing.length) console.warn(`No budget for: ${missing.join(', ')}. Run \`npm run size -- --update\`.`);
}
if (over) {
  console.error(`\n${over} bundle(s) over budget.`);
  process.exit(1);
}
