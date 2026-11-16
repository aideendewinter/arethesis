/**
 * Design tokens: load, validate, resolve and turn into CSS.
 *
 * The theme is defined in `src/kit/tokens/` in the W3C Design Tokens format
 * (Design Tokens Format Module 2025.10), with a resolver document (Design
 * Tokens Resolver Module 2025.10) that combines the base set with one of four
 * theme contexts. Everything the theme needs in CSS is generated from them:
 * the custom properties in theme.css and the flash-free boot snippet.
 *
 * Used by scripts/build-tokens.mjs, the build, the examples' Vite config and
 * the tests.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOKENS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/kit/tokens');
export const RESOLVER_FILE = 'arethesis.resolver.json';
export const RESOLVER_VERSION = '2025-10-01';
/** Theme contexts, in the order their CSS is emitted. */
export const CONTEXTS = ['light', 'dark', 'light-high-contrast', 'dark-high-contrast'];
/** localStorage keys the boot script shares with `setTheme()` and `setContrast()`. */
export const THEME_STORAGE_KEY = 'ar-theme';
export const CONTRAST_STORAGE_KEY = 'ar-contrast';

const TYPES = new Set(['color', 'dimension', 'fontFamily', 'fontWeight', 'duration', 'cubicBezier', 'number', 'shadow']);
const COLOR_SPACES = new Set(['srgb', 'srgb-linear', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'xyz-d65', 'xyz-d50']);
const GROUP_PROPS = new Set(['$type', '$description', '$extensions', '$deprecated', '$extends']);
const TOKEN_PROPS = new Set(['$value', '$type', '$description', '$extensions', '$deprecated']);
/** Font family keywords that must not be quoted in CSS. */
const FONT_KEYWORDS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'BlinkMacSystemFont']);

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isReference = v => typeof v === 'string' && /^\{[^{}]+\}$/.test(v);

// ── Validation ─────────────────────────────────────────────────────────────

/** Validate a color `$value` (Color Module 2025.10). Returns problems. */
export function colorProblems(value) {
  if (!isObject(value)) return ['color must be an object with colorSpace and components'];
  const problems = [];
  if (!COLOR_SPACES.has(value.colorSpace)) problems.push(`unknown colorSpace "${value.colorSpace}"`);
  if (!Array.isArray(value.components) || value.components.length !== 3) {
    problems.push('components must be an array of three values');
  } else if (value.components.some(c => c !== 'none' && typeof c !== 'number')) {
    problems.push('components must be numbers or "none"');
  } else if (value.colorSpace === 'srgb' && value.components.some(c => typeof c === 'number' && (c < 0 || c > 1))) {
    problems.push('srgb components must be between 0 and 1');
  }
  if (value.alpha !== undefined && (typeof value.alpha !== 'number' || value.alpha < 0 || value.alpha > 1)) problems.push('alpha must be a number between 0 and 1');
  if (value.hex !== undefined) {
    if (typeof value.hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.hex)) {
      problems.push('hex must be a 6-digit CSS hex color');
    } else if (value.colorSpace === 'srgb' && Array.isArray(value.components) && value.components.every(c => typeof c === 'number')) {
      // Our own rule: the fallback must be the same color.
      if (value.hex.toLowerCase() !== srgbToHex(value.components)) problems.push(`hex ${value.hex} doesn't match components (${srgbToHex(value.components)})`);
    }
  }
  for (const key of Object.keys(value)) if (!['colorSpace', 'components', 'alpha', 'hex'].includes(key)) problems.push(`unknown color property "${key}"`);
  return problems;
}

function dimensionProblems(value) {
  if (!isObject(value) || typeof value.value !== 'number' || !['px', 'rem'].includes(value.unit)) return ['dimension must be { value: number, unit: "px" | "rem" }'];
  return [];
}

function valueProblems(type, value) {
  if (isReference(value)) return [];
  switch (type) {
    case 'color':
      return colorProblems(value);
    case 'dimension':
      return dimensionProblems(value);
    case 'fontFamily':
      return typeof value === 'string' || (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string')) ? [] : ['fontFamily must be a string or an array of strings'];
    case 'fontWeight':
      return (typeof value === 'number' && value >= 1 && value <= 1000) || typeof value === 'string' ? [] : ['fontWeight must be 1–1000 or a keyword'];
    case 'duration':
      return isObject(value) && typeof value.value === 'number' && ['ms', 's'].includes(value.unit) ? [] : ['duration must be { value: number, unit: "ms" | "s" }'];
    case 'cubicBezier':
      return Array.isArray(value) && value.length === 4 && value.every(n => typeof n === 'number') && value[0] >= 0 && value[0] <= 1 && value[2] >= 0 && value[2] <= 1 ? [] : ['cubicBezier must be [x1, y1, x2, y2] with x in 0–1'];
    case 'number':
      return typeof value === 'number' ? [] : ['number must be a number'];
    case 'shadow': {
      const shadows = Array.isArray(value) ? value : [value];
      if (!shadows.length) return ['shadow must not be empty'];
      return shadows.flatMap(s => {
        if (isReference(s)) return [];
        if (!isObject(s)) return ['each shadow must be an object'];
        const missing = ['color', 'offsetX', 'offsetY', 'blur', 'spread'].filter(k => !(k in s)).map(k => `shadow is missing ${k}`);
        return [
          ...missing,
          ...(s.color === undefined ? [] : valueProblems('color', s.color)),
          ...['offsetX', 'offsetY', 'blur', 'spread'].filter(k => k in s).flatMap(k => valueProblems('dimension', s[k])),
          ...(s.inset === undefined || typeof s.inset === 'boolean' ? [] : ['inset must be a boolean']),
        ];
      });
    }
    default:
      return [];
  }
}

function nameProblems(name) {
  if (name.startsWith('$')) return name === '$root' ? [] : [`"${name}" is not a token or group property`];
  return /[{}.]/.test(name) ? [`name "${name}" must not contain {, } or .`] : [];
}

/**
 * Validate a token document (Format Module 2025.10). Returns a list of
 * problems, each prefixed with the token path; empty means valid.
 */
export function validateTokens(doc, file = 'tokens') {
  const problems = [];
  const walk = (node, path, inheritedType) => {
    if (!isObject(node)) {
      problems.push(`${file}: ${path.join('.') || '(root)'} must be an object`);
      return;
    }
    const at = `${file}: ${path.join('.') || '(root)'}`;
    if ('$value' in node) {
      for (const key of Object.keys(node)) if (!TOKEN_PROPS.has(key)) problems.push(`${at}: unexpected "${key}" in a token`);
      const type = node.$type ?? inheritedType;
      if (!type) problems.push(`${at}: no $type (set it on the token or a parent group)`);
      else if (!TYPES.has(type)) problems.push(`${at}: unknown $type "${type}"`);
      else problems.push(...valueProblems(type, node.$value).map(p => `${at}: ${p}`));
      if (node.$description !== undefined && typeof node.$description !== 'string') problems.push(`${at}: $description must be a string`);
      return;
    }
    if (node.$type !== undefined && !TYPES.has(node.$type)) problems.push(`${at}: unknown $type "${node.$type}"`);
    if (node.$description !== undefined && typeof node.$description !== 'string') problems.push(`${at}: $description must be a string`);
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$') && key !== '$root') {
        if (!GROUP_PROPS.has(key)) problems.push(`${at}: unexpected "${key}" in a group`);
        continue;
      }
      problems.push(...nameProblems(key).map(p => `${at}: ${p}`));
      walk(child, [...path, key], node.$type ?? inheritedType);
    }
  };
  walk(doc, [], undefined);
  return problems;
}

/** Validate a resolver document (Resolver Module 2025.10). */
export function validateResolver(doc, exists = () => true) {
  const problems = [];
  if (!isObject(doc)) return ['resolver must be an object'];
  if (doc.version !== RESOLVER_VERSION) problems.push(`version must be "${RESOLVER_VERSION}"`);
  if (!Array.isArray(doc.resolutionOrder) || !doc.resolutionOrder.length) problems.push('resolutionOrder must be a non-empty array');
  const checkSources = (sources, where) => {
    if (!Array.isArray(sources)) return problems.push(`${where} must be an array of sources`);
    for (const source of sources) {
      if (isObject(source) && typeof source.$ref === 'string') {
        if (!source.$ref.startsWith('#') && !exists(source.$ref)) problems.push(`${where}: ${source.$ref} not found`);
      } else if (!isObject(source)) {
        problems.push(`${where}: each source must be a { $ref } or an inline token object`);
      }
    }
  };
  for (const [name, set] of Object.entries(doc.sets ?? {})) checkSources(set?.sources, `sets.${name}.sources`);
  for (const [name, modifier] of Object.entries(doc.modifiers ?? {})) {
    const contexts = Object.keys(modifier?.contexts ?? {});
    if (contexts.length === 0) problems.push(`modifiers.${name} has no contexts`);
    for (const context of contexts) checkSources(modifier.contexts[context], `modifiers.${name}.contexts.${context}`);
    if (modifier?.default !== undefined && !contexts.includes(modifier.default)) problems.push(`modifiers.${name}.default "${modifier.default}" is not a context`);
  }
  for (const item of doc.resolutionOrder ?? []) {
    const ref = item?.$ref;
    const match = typeof ref === 'string' ? /^#\/(sets|modifiers)\/([^/]+)$/.exec(ref) : null;
    if (!match || !doc[match[1]]?.[match[2]]) problems.push(`resolutionOrder: ${JSON.stringify(item)} doesn't point at a set or modifier`);
  }
  return problems;
}

// ── Loading and resolving ──────────────────────────────────────────────────

/** Read and validate every token file and the resolver. Throws on problems. */
export function loadTokens(dir = TOKENS_DIR) {
  const read = file => JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
  const resolver = read(RESOLVER_FILE);
  const files = new Map();
  const exists = file => {
    try {
      readFileSync(resolve(dir, file));
      return true;
    } catch {
      return false;
    }
  };
  const problems = validateResolver(resolver, exists);
  const refs = [
    ...Object.values(resolver.sets ?? {}).flatMap(s => s.sources ?? []),
    ...Object.values(resolver.modifiers ?? {}).flatMap(m => Object.values(m.contexts ?? {}).flat()),
  ].map(s => s.$ref).filter(ref => typeof ref === 'string' && !ref.startsWith('#'));
  for (const file of new Set(refs)) {
    if (!exists(file)) continue;
    const doc = read(file);
    files.set(file, doc);
    problems.push(...validateTokens(doc, file));
  }
  if (problems.length) throw new Error(`Invalid design tokens:\n  ${problems.join('\n  ')}`);
  return { resolver, files };
}

/** Flatten a token document into path → { type, value }. `$root` names its group. */
export function flatten(doc, into = new Map()) {
  const walk = (node, path, inheritedType) => {
    if ('$value' in node) {
      into.set(path.join('.'), { type: node.$type ?? inheritedType, value: node.$value, description: node.$description });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$') && key !== '$root') continue;
      walk(child, key === '$root' ? path : [...path, key], node.$type ?? inheritedType);
    }
  };
  walk(doc, [], undefined);
  return into;
}

/**
 * Resolve the tokens for one input (e.g. `{ theme: 'dark' }`), following the
 * resolver's resolutionOrder: later sets and modifiers override earlier ones.
 */
export function resolveTokens({ resolver, files }, input = {}) {
  const tokens = new Map();
  const apply = sources => {
    for (const source of sources) flatten(source.$ref ? files.get(source.$ref) : source, tokens);
  };
  for (const { $ref } of resolver.resolutionOrder) {
    const [, kind, name] = /^#\/(sets|modifiers)\/(.+)$/.exec($ref);
    if (kind === 'sets') {
      apply(resolver.sets[name].sources);
    } else {
      const modifier = resolver.modifiers[name];
      const key = Object.keys(input).find(k => k.toLowerCase() === name.toLowerCase());
      const context = key ? input[key] : modifier.default;
      if (!modifier.contexts[context]) throw new Error(`Unknown ${name} "${context}"`);
      apply(modifier.contexts[context]);
    }
  }
  // Resolve {references} to the referenced token's value.
  const deref = (value, seen = []) => {
    if (isReference(value)) {
      const path = value.slice(1, -1);
      if (seen.includes(path)) throw new Error(`Circular reference: ${[...seen, path].join(' → ')}`);
      const target = tokens.get(path);
      if (!target) throw new Error(`Unknown reference ${value}`);
      return deref(target.value, [...seen, path]);
    }
    if (Array.isArray(value)) return value.map(v => deref(v, seen));
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deref(v, seen)]));
    return value;
  };
  for (const token of tokens.values()) token.value = deref(token.value);
  return tokens;
}

// ── CSS ────────────────────────────────────────────────────────────────────

/** `color.text.muted` → `--ar-text-muted` (the `color` group is implied). */
export function cssVariable(path) {
  const parts = path.split('.');
  if (parts[0] === 'color') parts.shift();
  return `--ar-${parts.join('-')}`;
}

export function srgbToHex(components) {
  return `#${components.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function colorToCss(value) {
  if (value.colorSpace !== 'srgb') {
    const space = { 'srgb-linear': 'srgb-linear', 'display-p3': 'display-p3', 'a98-rgb': 'a98-rgb', 'prophoto-rgb': 'prophoto-rgb', rec2020: 'rec2020', 'xyz-d65': 'xyz-d65', 'xyz-d50': 'xyz-d50' }[value.colorSpace];
    const comps = value.components.join(' ');
    const alpha = value.alpha !== undefined && value.alpha < 1 ? ` / ${value.alpha}` : '';
    return space ? `color(${space} ${comps}${alpha})` : `${value.colorSpace}(${comps}${alpha})`;
  }
  if (value.alpha === undefined || value.alpha >= 1) return value.hex?.toLowerCase() ?? srgbToHex(value.components);
  return `rgb(${value.components.map(c => Math.round(c * 255)).join(' ')} / ${value.alpha})`;
}

const dimensionToCss = d => (d.value === 0 ? '0' : `${d.value}${d.unit}`);

export function tokenToCss({ type, value }) {
  switch (type) {
    case 'color':
      return colorToCss(value);
    case 'dimension':
      return dimensionToCss(value);
    case 'fontFamily':
      return (Array.isArray(value) ? value : [value]).map(f => (FONT_KEYWORDS.has(f) ? f : `'${f.replace(/'/g, "\\'")}'`)).join(', ');
    case 'fontWeight':
    case 'number':
      return String(value);
    case 'duration':
      return `${value.value}${value.unit}`;
    case 'cubicBezier':
      return `cubic-bezier(${value.join(', ')})`;
    case 'shadow':
      return (Array.isArray(value) ? value : [value])
        .map(s => [s.inset ? 'inset' : '', dimensionToCss(s.offsetX), dimensionToCss(s.offsetY), dimensionToCss(s.blur), dimensionToCss(s.spread), colorToCss(s.color)].filter(Boolean).join(' '))
        .join(', ');
    default:
      throw new Error(`No CSS for $type ${type}`);
  }
}

const DARK_AUTO = ":not([data-theme='light'])";
const MORE_AUTO = ":not([data-contrast='standard'])";

/**
 * Which context applies where:
 * - light by default;
 * - dark under `prefers-color-scheme: dark` or `data-theme="dark"` on <html>
 *   (`data-theme="light"` opts out);
 * - high contrast under `prefers-contrast: more` or `data-contrast="more"`
 *   (`data-contrast="standard"` opts out), for either theme.
 * Later rules are at least as specific as earlier ones, so they win.
 */
export const THEME_RULES = [
  { context: 'light', scheme: 'light', selector: ':root' },
  { context: 'dark', scheme: 'dark', media: '(prefers-color-scheme: dark)', selector: `:root${DARK_AUTO}` },
  { context: 'dark', scheme: 'dark', selector: ":root[data-theme='dark']" },
  { context: 'light-high-contrast', scheme: 'light', media: '(prefers-contrast: more)', selector: `:root${MORE_AUTO}` },
  { context: 'light-high-contrast', scheme: 'light', selector: ":root[data-contrast='more']" },
  { context: 'dark-high-contrast', scheme: 'dark', media: '(prefers-contrast: more) and (prefers-color-scheme: dark)', selector: `:root${MORE_AUTO}${DARK_AUTO}` },
  { context: 'dark-high-contrast', scheme: 'dark', media: '(prefers-contrast: more)', selector: `:root[data-theme='dark']${MORE_AUTO}` },
  { context: 'dark-high-contrast', scheme: 'dark', media: '(prefers-color-scheme: dark)', selector: `:root[data-contrast='more']${DARK_AUTO}` },
  { context: 'dark-high-contrast', scheme: 'dark', selector: ":root[data-theme='dark'][data-contrast='more']" },
];

function rules(contexts, body, { pretty }) {
  return THEME_RULES.map(({ context, scheme, media, selector }) => {
    if (!pretty) {
      const rule = `${selector}{${body(contexts[context], scheme, '')}}`;
      return media ? `@media ${media}{${rule}}` : rule;
    }
    const indent = media ? '    ' : '  ';
    const rule = `${selector} {\n${body(contexts[context], scheme, indent)}\n${indent.slice(2)}}`;
    return media ? `@media ${media} {\n  ${rule}\n}` : rule;
  });
}

/** The custom properties for every theme context, with the selectors from THEME_RULES. */
export function themeCss(loaded = loadTokens()) {
  const all = Object.fromEntries(CONTEXTS.map(c => [c, resolveTokens(loaded, { theme: c })]));
  // Tokens that vary between contexts; the rest are only emitted once, in :root.
  const varying = new Set([...all.light.keys()].filter(path => new Set(CONTEXTS.map(c => tokenToCss(all[c].get(path)))).size > 1));
  const t = Object.fromEntries(CONTEXTS.map(c => [c, c === 'light' ? all.light : new Map([...all[c]].filter(([path]) => varying.has(path)))]));
  const body = (tokens, scheme, indent) => [...[...tokens].map(([path, token]) => `${indent}${cssVariable(path)}: ${tokenToCss(token)};`), `${indent}color-scheme: ${scheme};`].join('\n');
  return rules(t, body, { pretty: true }).join('\n\n');
}

export const CSS_START = '/* ── Design tokens (generated from src/kit/tokens by `npm run tokens`; do not edit by hand) ── */';
export const CSS_END = '/* ── End of generated design tokens ── */';

/** Replace the generated region of theme.css. */
export function withThemeCss(css, loaded) {
  const start = css.indexOf(CSS_START);
  const end = css.indexOf(CSS_END);
  if (start === -1 || end === -1) throw new Error('theme.css is missing the generated design token markers');
  return `${css.slice(0, start)}${CSS_START}\n\n${themeCss(loaded)}\n\n${css.slice(end)}`;
}

// ── Flash-free boot ────────────────────────────────────────────────────────

/**
 * The few rules a page needs before its stylesheet arrives: background, text
 * color and color-scheme for each theme, so the first paint is never wrong.
 */
export function criticalCss(loaded = loadTokens()) {
  const t = Object.fromEntries(CONTEXTS.map(c => [c, resolveTokens(loaded, { theme: c })]));
  const body = (tokens, scheme) => `background:${tokenToCss(tokens.get('color.bg'))};color:${tokenToCss(tokens.get('color.text'))};color-scheme:${scheme}`;
  return rules(t, body, { pretty: false }).join('');
}

/** Applies the saved theme and contrast to <html> before first paint. */
export function bootScript({ themeKey = THEME_STORAGE_KEY, contrastKey = CONTRAST_STORAGE_KEY } = {}) {
  return `try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(themeKey)}),c=localStorage.getItem(${JSON.stringify(contrastKey)});if(t==='light'||t==='dark')d.setAttribute('data-theme',t);if(c==='more'||c==='standard')d.setAttribute('data-contrast',c)}catch(e){}`;
}

/**
 * A classic script for `<script src>` in <head>: applies the saved theme and
 * contrast and adds the critical styles, before the page paints. The
 * `data-theme-key` and `data-contrast-key` attributes override the
 * localStorage keys.
 */
export function bootFile(loaded = loadTokens()) {
  return `/* Arethesis theme boot: load in <head> with a plain <script src> (not a module) so it runs before the first paint. */
(function () {
  var script = document.currentScript;
  var themeKey = (script && script.getAttribute('data-theme-key')) || ${JSON.stringify(THEME_STORAGE_KEY)};
  var contrastKey = (script && script.getAttribute('data-contrast-key')) || ${JSON.stringify(CONTRAST_STORAGE_KEY)};
  try {
    var root = document.documentElement;
    var theme = localStorage.getItem(themeKey);
    var contrast = localStorage.getItem(contrastKey);
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    if (contrast === 'more' || contrast === 'standard') root.setAttribute('data-contrast', contrast);
  } catch (e) {}
  var style = document.createElement('style');
  style.setAttribute('data-arethesis-boot', '');
  style.textContent = ${JSON.stringify(criticalCss(loaded))};
  document.head.appendChild(style);
})();
`;
}
