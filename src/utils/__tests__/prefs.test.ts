import { afterEach, describe, expect, it, vi } from 'vitest';
import { definePrefs as define, type Prefs, type PrefsOptions } from '../prefs';
import { safeStorage, watchStorage } from '../storage';

const defaults = { fontSize: 18, hints: true, voice: '', tags: [] as string[], layout: { columns: 1 } };

function otherTab(key: string, value: string | null): void {
  localStorage.setItem(key, value ?? '');
  if (value === null) localStorage.removeItem(key);
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: value, storageArea: localStorage }));
}

const made: Array<Prefs<never>> = [];
function definePrefs<D extends Record<string, unknown>>(options: PrefsOptions<D>): Prefs<D> {
  const prefs = define(options);
  made.push(prefs as unknown as Prefs<never>);
  return prefs;
}

describe('definePrefs', () => {
  afterEach(() => {
    for (const prefs of made.splice(0)) prefs.destroy();
    localStorage.clear();
  });

  it('reads defaults, stores only what differs, and drops back on reset', () => {
    const prefs = definePrefs({ key: 'p', defaults });
    expect(prefs.persistent).toBe(true);
    expect(prefs.all()).toEqual(defaults);
    prefs.set('fontSize', 20);
    expect(JSON.parse(localStorage.getItem('p')!)).toEqual({ v: 1, data: { fontSize: 20 } });
    prefs.update({ hints: false, tags: ['a'] });
    expect(definePrefs({ key: 'p', defaults }).all()).toMatchObject({ fontSize: 20, hints: false, tags: ['a'] });
    prefs.reset('fontSize');
    expect(prefs.get('fontSize')).toBe(18);
    prefs.reset();
    expect(localStorage.getItem('p')).toBeNull();
  });

  it('hands out copies, so callers cannot change stored values', () => {
    const prefs = definePrefs({ key: 'p', defaults });
    prefs.get('tags').push('x');
    prefs.all().layout.columns = 3;
    expect(prefs.get('tags')).toEqual([]);
    expect(prefs.get('layout')).toEqual({ columns: 1 });
  });

  it('rejects unknown keys and bad values on write, and ignores them on read', () => {
    const prefs = definePrefs({ key: 'p', defaults, validate: { fontSize: v => v >= 10 && v <= 40 } });
    expect(() => prefs.set('fontSize', 99)).toThrow(TypeError);
    expect(() => prefs.set('hints', 'yes' as unknown as boolean)).toThrow(TypeError);
    expect(() => prefs.set('nope' as 'hints', true)).toThrow(/unknown key/);
    expect(() => prefs.update({ nope: 1 } as never)).toThrow(/unknown key/);
    expect(() => prefs.update({ fontSize: Number.NaN })).toThrow(TypeError);
    localStorage.setItem('p', JSON.stringify({ v: 1, data: { fontSize: 99, hints: 'no', voice: 'Alex', extra: 1, layout: [] } }));
    expect(definePrefs({ key: 'p', defaults, validate: { fontSize: v => v < 40 } }).all()).toEqual({ ...defaults, voice: 'Alex' });
    for (const bad of ['{', '[]', '{"v":1,"data":3}']) {
      localStorage.setItem('p', bad);
      expect(definePrefs({ key: 'p', defaults }).all()).toEqual(defaults);
    }
    const throwing = definePrefs({ key: 'q', defaults, validate: { voice: () => { throw new Error('x'); } } });
    expect(() => throwing.set('voice', 'a')).toThrow(TypeError);
  });

  it('migrates older data once, and saves it', () => {
    localStorage.setItem('p', JSON.stringify({ v: 1, data: { size: 22 } }));
    const migrate = vi.fn((old: Record<string, unknown>, from: number) => (from < 2 ? { fontSize: old.size } : old));
    const prefs = definePrefs({ key: 'p', version: 2, defaults, migrate });
    expect(prefs.get('fontSize')).toBe(22);
    expect(migrate).toHaveBeenCalledWith({ size: 22 }, 1);
    expect(JSON.parse(localStorage.getItem('p')!)).toEqual({ v: 2, data: { fontSize: 22 } });
    definePrefs({ key: 'p', version: 2, defaults, migrate });
    expect(migrate).toHaveBeenCalledTimes(1);
    localStorage.setItem('p', JSON.stringify({ v: 1, data: { fontSize: 30 } }));
    expect(definePrefs({ key: 'p', version: 2, defaults, migrate: () => { throw new Error('x'); } }).get('fontSize')).toBe(18);
    localStorage.setItem('p', JSON.stringify({ data: { fontSize: 30 } }));
    expect(definePrefs({ key: 'p', version: 2, defaults }).get('fontSize')).toBe(30);
  });

  it('notifies listeners, and follows changes from other tabs', () => {
    const prefs = definePrefs({ key: 'p', defaults });
    const size = vi.fn();
    const all = vi.fn();
    const off = prefs.on('fontSize', size);
    prefs.on('*', all);
    prefs.set('fontSize', 20);
    prefs.set('fontSize', 20);
    expect(size).toHaveBeenCalledTimes(1);
    expect(size).toHaveBeenCalledWith(20, 18);
    expect(all).toHaveBeenCalledTimes(1);
    otherTab('p', JSON.stringify({ v: 1, data: { fontSize: 24, hints: false } }));
    expect(prefs.get('fontSize')).toBe(24);
    expect(size).toHaveBeenLastCalledWith(24, 20);
    otherTab('p', null);
    expect(prefs.get('hints')).toBe(true);
    off();
    prefs.destroy();
    otherTab('p', JSON.stringify({ v: 1, data: { fontSize: 30 } }));
    expect(prefs.get('fontSize')).toBe(18);
    expect(size).toHaveBeenCalledTimes(3);
  });

  it('works without storage', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } } as unknown as Storage;
    const prefs = definePrefs({ key: 'p', defaults, storage: broken });
    expect(prefs.persistent).toBe(false);
    prefs.set('fontSize', 21);
    expect(prefs.get('fontSize')).toBe(21);
    const session = definePrefs({ key: 's', defaults, storage: 'session' });
    session.set('voice', 'x');
    expect(sessionStorage.getItem('s')).toContain('"voice":"x"');
  });
});

describe('safeStorage', () => {
  it('falls back to memory when writes fail', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} } as unknown as Storage;
    const storage = safeStorage(full);
    expect(storage.set('a', '1')).toBe(false);
    expect(storage.get('a')).toBe('1');
    storage.remove('a');
    expect(storage.get('a')).toBeNull();
    expect(storage.set('a', null)).toBe(false);
    expect(storage.persistent).toBe(false);
    const local = safeStorage();
    expect(local.set('b', '2')).toBe(true);
    expect(localStorage.getItem('b')).toBe('2');
    local.remove('b');
  });

  it('watches one key, in one storage area', () => {
    const fn = vi.fn();
    const stop = watchStorage('k', fn);
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '1', storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'k', newValue: '1', storageArea: sessionStorage }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'k', newValue: '2', storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
    expect(fn.mock.calls).toEqual([['2'], [null]]);
    stop();
  });
});
