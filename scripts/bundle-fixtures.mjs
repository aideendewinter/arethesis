// Bundles small apps against the built package (dist/, through the package's
// `exports`), the way a consumer's bundler would. Used by check-treeshake.mjs
// and size-budget.mjs.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/** Resolve `arethesis/…` through package.json `exports`, wildcards included. */
function resolveExport(specifier) {
  const sub = '.' + specifier.slice(pkg.name.length);
  const target = (entry) => (typeof entry === 'string' ? entry : entry.import);
  if (pkg.exports[sub]) return resolve(root, target(pkg.exports[sub]));
  for (const [key, value] of Object.entries(pkg.exports)) {
    if (!key.includes('*')) continue;
    const [prefix, suffix] = key.split('*');
    if (sub.startsWith(prefix) && sub.endsWith(suffix)) {
      const star = sub.slice(prefix.length, sub.length - suffix.length);
      return resolve(root, target(value).replace('*', star));
    }
  }
  throw new Error(`${specifier} is not exported by package.json`);
}

/**
 * Each fixture is an app: `code` is its source. `mustContain` and
 * `mustNotContain` are strings that survive minification (tags, globals,
 * messages), checked against the entry chunk.
 */
export const fixtures = [
  {
    name: 'core: ObjectStore only',
    code: `import { ObjectStore } from 'arethesis/core'; globalThis.s = new ObjectStore();`,
    mustNotContain: ['customElements.define', 'EventSource', 'collab:join', 'compose: length mismatch', 'sortable:start', 'Unknown mixin'],
  },
  {
    name: 'core: app, no services configured',
    code: `import { getArethesis } from 'arethesis/core'; void getArethesis().init({ persistence: false });`,
    mustNotContain: ['customElements.define', 'EventSource', 'collab:join', 'compose: length mismatch', 'sortable:start'],
  },
  {
    name: 'core + realtime',
    code: `import { getArethesis } from 'arethesis/core'; import 'arethesis/realtime'; void getArethesis().init({ sse: { url: '/events' } });`,
    mustContain: ['EventSource'],
    mustNotContain: ['collab:join', 'compose: length mismatch', 'customElements.define'],
  },
  {
    name: 'components/list',
    code: `import 'arethesis/components/list';`,
    mustContain: ['a-list'],
    mustNotContain: ['a-data-table', '#CYCLE!', 'compose: length mismatch', 'collab:join', 'EventSource'],
  },
  {
    name: 'components/data-table',
    code: `import 'arethesis/components/data-table';`,
    mustContain: ['a-data-table'],
    mustNotContain: ['a-sheet', '#CYCLE!', 'compose: length mismatch', 'collab:join'],
  },
  {
    name: 'components (all)',
    code: `import 'arethesis/components';`,
    mustContain: ['a-data-table', 'a-flex-view', 'a-list', 'a-form', 'a-chart', 'a-command-palette', 'a-sheet', 'a-markdown-editor'],
  },
  {
    name: 'arethesis (everything)',
    code: `import { getArethesis } from 'arethesis'; void getArethesis().init({});`,
    mustContain: ['sortable:start', 'collab:join'],
  },
];

/** Bundle one fixture, minified. Returns { entry, total } source strings. */
export async function bundle(fixture) {
  const id = 'virtual:arethesis-fixture';
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root,
    plugins: [{
      name: 'fixture',
      enforce: 'pre',
      resolveId(source) {
        if (source.endsWith(id)) return '\0' + id;
        if (source === pkg.name || source.startsWith(pkg.name + '/')) return resolveExport(source);
        return null;
      },
      load(source) {
        return source === '\0' + id ? fixture.code : null;
      },
    }],
    build: {
      write: false,
      minify: true,
      lib: { entry: id, formats: ['es'], fileName: 'app' },
      rollupOptions: { output: { minify: true } },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(r => r.output).filter(o => o.type === 'chunk');
  const entry = chunks.find(c => c.isEntry)?.code ?? '';
  return { entry, total: chunks.map(c => c.code).join('\n') };
}
