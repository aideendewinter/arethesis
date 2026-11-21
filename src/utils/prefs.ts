/**
 * `definePrefs`: typed settings that survive reloads and follow other tabs.
 *
 * ```ts
 * const prefs = definePrefs({
 *   key: 'reader',
 *   version: 2,
 *   defaults: { fontSize: 18, hints: true, voice: '' },
 *   validate: { fontSize: v => v >= 10 && v <= 40 },
 *   migrate: (old, from) => (from < 2 ? { ...old, fontSize: old.size } : old),
 * });
 * prefs.get('fontSize');        // 18
 * prefs.set('fontSize', 20);
 * prefs.on('fontSize', size => document.body.style.fontSize = `${size}px`);
 * ```
 *
 * - Everything is one JSON entry, `{ v, data }`. Only values that differ
 *   from their default are stored, so changing a default reaches everyone
 *   who never changed it.
 * - A stored value of the wrong type (or one `validate` rejects) reads as
 *   the default, and unknown keys are dropped.
 * - When the stored version is older, `migrate` runs once and the result is
 *   saved.
 * - A change made in another tab updates this one and fires the listeners.
 * - Storage that throws (private windows, blocked cookies) falls back to
 *   memory.
 *
 * @module utils/prefs
 */

import { deepEqual, isPlainObject } from './path';
import { safeStorage, watchStorage, type StorageKind } from './storage';

export interface PrefsOptions<D extends Record<string, unknown>> {
  /** The storage key. */
  key: string;
  defaults: D;
  /** Bump it when the shape changes, and handle the old shape in `migrate`. @default 1 */
  version?: number;
  /** Turn data stored under an older version into the current shape. */
  migrate?: (old: Record<string, unknown>, fromVersion: number) => Record<string, unknown>;
  /** Extra checks per key; a value that fails reads as the default. */
  validate?: { [K in keyof D]?: (value: D[K]) => boolean };
  /** @default 'local' */
  storage?: StorageKind | Storage;
}

export interface Prefs<D extends Record<string, unknown>> {
  get<K extends keyof D>(key: K): D[K];
  set<K extends keyof D>(key: K, value: D[K]): void;
  /** Set several at once (listeners fire once per changed key, then `'*'` once). */
  update(values: Partial<D>): void;
  /** Back to the default: one key, or all of them. */
  reset(key?: keyof D): void;
  /** Every value, defaults filled in. */
  all(): D;
  /** Listen to one key (`(value, previous)`) or to `'*'` (`(all)`). Returns a function that stops listening. */
  on<K extends keyof D>(key: K, listener: (value: D[K], previous: D[K]) => void): () => void;
  on(key: '*', listener: (all: D) => void): () => void;
  /** False when storage is unavailable and values only last for this page. */
  readonly persistent: boolean;
  /** Stop following other tabs and drop listeners. */
  destroy(): void;
}

function sameType(value: unknown, fallback: unknown): boolean {
  if (fallback === null || fallback === undefined) return true;
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (isPlainObject(fallback)) return isPlainObject(value);
  if (typeof fallback === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === typeof fallback;
}

const clone = <T>(value: T): T => (typeof value === 'object' && value !== null ? structuredClone(value) : value);

export function definePrefs<D extends Record<string, unknown>>(options: PrefsOptions<D>): Prefs<D> {
  const { key, defaults, version = 1, migrate } = options;
  const validate: PrefsOptions<D>['validate'] & object = options.validate ?? {};
  const kind = options.storage ?? 'local';
  const storage = safeStorage(kind);
  const listeners = new Map<keyof D | '*', Set<(...args: never[]) => void>>();
  let values = read();

  function valid<K extends keyof D>(name: K, value: unknown): value is D[K] {
    if (!sameType(value, defaults[name])) return false;
    const check = validate[name] as ((v: unknown) => boolean) | undefined;
    try {
      return !check || check(value);
    } catch {
      return false;
    }
  }

  function parse(raw: string | null): { data: Record<string, unknown>; migrated: boolean } {
    if (!raw) return { data: {}, migrated: false };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { data: {}, migrated: false };
    }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.data)) return { data: {}, migrated: false };
    const from = typeof parsed.v === 'number' ? parsed.v : 0;
    if (from >= version || !migrate) return { data: parsed.data, migrated: from < version };
    try {
      const data = migrate(parsed.data, from);
      return { data: isPlainObject(data) ? data : {}, migrated: true };
    } catch {
      return { data: {}, migrated: true };
    }
  }

  function read(): D {
    const { data, migrated } = parse(storage.get(key));
    const out = clone(defaults);
    for (const name of Object.keys(defaults) as Array<keyof D>) {
      if (Object.hasOwn(data, name) && valid(name, data[name as string])) out[name] = data[name as string] as D[keyof D];
    }
    if (migrated) write(out);
    return out;
  }

  function write(next: D): void {
    const data: Record<string, unknown> = {};
    for (const name of Object.keys(defaults)) {
      if (!deepEqual(next[name], defaults[name])) data[name] = next[name];
    }
    storage.set(key, Object.keys(data).length ? JSON.stringify({ v: version, data }) : null);
  }

  function apply(next: D): void {
    const previous = values;
    values = next;
    let changed = false;
    for (const name of Object.keys(defaults) as Array<keyof D>) {
      if (deepEqual(previous[name], next[name])) continue;
      changed = true;
      for (const fn of listeners.get(name) ?? []) (fn as (v: unknown, p: unknown) => void)(clone(next[name]), previous[name]);
    }
    if (changed) for (const fn of listeners.get('*') ?? []) (fn as (all: D) => void)(clone(next));
  }

  function commit(next: D): void {
    write(next);
    apply(next);
  }

  const stopWatching = kind === 'session' ? () => {} : watchStorage(key, () => apply(read()), kind);

  return {
    get persistent() {
      return storage.persistent;
    },
    get: name => clone(values[name]),
    set(name, value) {
      if (!Object.hasOwn(defaults, name)) throw new Error(`prefs "${key}": unknown key "${String(name)}"`);
      if (!valid(name, value)) throw new TypeError(`prefs "${key}": invalid value for "${String(name)}"`);
      commit({ ...values, [name]: clone(value) });
    },
    update(partial) {
      const next = { ...values };
      for (const [name, value] of Object.entries(partial) as Array<[keyof D, D[keyof D]]>) {
        if (!Object.hasOwn(defaults, name)) throw new Error(`prefs "${key}": unknown key "${String(name)}"`);
        if (!valid(name, value)) throw new TypeError(`prefs "${key}": invalid value for "${String(name)}"`);
        next[name] = clone(value);
      }
      commit(next);
    },
    reset(name) {
      commit(name === undefined ? clone(defaults) : { ...values, [name]: clone(defaults[name]) });
    },
    all: () => clone(values),
    on(name: keyof D | '*', listener: (...args: never[]) => void) {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      set.add(listener);
      return () => set.delete(listener);
    },
    destroy() {
      stopWatching();
      listeners.clear();
    },
  } as Prefs<D>;
}
