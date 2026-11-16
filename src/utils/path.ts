/**
 * Safe object-path helpers.
 *
 * All helpers refuse to read or write through `__proto__`, `constructor`
 * or `prototype`, so data from a server can never reach `Object.prototype`.
 *
 * @module utils/path
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Whether a key is unsafe to read/write via dynamic property access. */
export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

/** Whether a value is a plain object (not an array, Date, Map, etc.). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Read a dotted path (`'a.b.0.c'`) from a value. An empty path returns the value itself.
 */
export function getPath(obj: unknown, path: string | undefined): unknown {
  if (path === undefined || path === '') return obj;
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (isForbiddenKey(part)) return undefined;
    if (typeof current !== 'object' && typeof current !== 'function') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Write a dotted path, creating intermediate plain objects. Returns false if the
 * path contains a forbidden segment.
 */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): boolean {
  const parts = path.split('.');
  if (parts.some(isForbiddenKey)) return false;
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = current[part];
    if (typeof next !== 'object' || next === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return true;
}

/**
 * Recursively merge `source` into a copy of `target`. Plain objects merge; arrays
 * and other values replace. Forbidden keys are skipped.
 */
export function deepMerge<T>(target: T, source: unknown): T {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return source as T;
  }
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    if (isForbiddenKey(key)) continue;
    const incoming = source[key];
    const existing = result[key];
    result[key] = isPlainObject(existing) && isPlainObject(incoming)
      ? deepMerge(existing, incoming)
      : incoming;
  }
  return result as T;
}

/** Shallow copy without forbidden keys. */
export function safeAssign<T extends Record<string, unknown>>(target: T, source: unknown): T {
  if (!isPlainObject(source)) return target;
  for (const key of Object.keys(source)) {
    if (!isForbiddenKey(key)) (target as Record<string, unknown>)[key] = source[key];
  }
  return target;
}

/** Structural equality for JSON-like values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Stable JSON stringify (sorted keys) for deterministic ids. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys
    .filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
