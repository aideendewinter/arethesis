// Checks that apps importing part of Arethesis get only that part. Run after
// `npm run build`.
import { bundle, fixtures } from './bundle-fixtures.mjs';

let failed = 0;
for (const fixture of fixtures) {
  const { entry } = await bundle(fixture);
  const problems = [
    ...(fixture.mustContain ?? []).filter(s => !entry.includes(s)).map(s => `missing ${JSON.stringify(s)}`),
    ...(fixture.mustNotContain ?? []).filter(s => entry.includes(s)).map(s => `contains ${JSON.stringify(s)}`),
  ];
  if (problems.length) failed++;
  console.log(`${problems.length ? '✗' : '✓'} ${fixture.name}${problems.length ? `: ${problems.join(', ')}` : ''}`);
}
if (failed) {
  console.error(`\n${failed} fixture(s) pulled in code they don't use.`);
  process.exit(1);
}
