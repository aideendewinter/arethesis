import { describe, expect, it, vi } from 'vitest';
import { PersistenceManager } from '../persistence-manager';
import type { StoredObject } from '../types';

let counter = 0;
const dbName = () => `test-db-${++counter}`;
const obj = (type: string, id: string, data: unknown, lastUpdated = Date.now()): StoredObject => ({
  type, id, data, version: 1, lastUpdated, sources: new Set(['api']), status: 'fresh',
});

describe('PersistenceManager', () => {
  it('saves, loads and deletes in batches', async () => {
    const pm = new PersistenceManager({ dbName: dbName() });
    pm.save(obj('P', '1', { a: 1 }));
    pm.save(obj('P', '2', { a: 2 }));
    pm.save(obj('Q', '1', { b: 1 }));
    await pm.flush();
    expect(await pm.count()).toBe(3);
    const loaded = await pm.load('P', '1');
    expect(loaded?.data).toEqual({ a: 1 });
    expect(loaded?.sources).toBeInstanceOf(Set);
    expect(await pm.load('P', 'nope')).toBeNull();
    expect((await pm.loadByType('P')).map(o => o.id).sort()).toEqual(['1', '2']);
    pm.delete('P', '1');
    expect((await pm.loadAll()).map(o => `${o.type}:${o.id}`).sort()).toEqual(['P:2', 'Q:1']);
    await pm.clear();
    expect(await pm.count()).toBe(0);
    await pm.deleteDatabase();
  });

  it('flushes automatically after a delay', async () => {
    const pm = new PersistenceManager({ dbName: dbName(), flushDelay: 5 });
    pm.save(obj('P', '1', {}));
    await new Promise(r => setTimeout(r, 50));
    expect(await pm.count()).toBe(1);
    await pm.close();
  });

  it('evicts objects older than maxAge', async () => {
    const name = dbName();
    const writer = new PersistenceManager({ dbName: name });
    writer.save(obj('P', 'old', {}, Date.now() - 10_000));
    writer.save(obj('P', 'new', {}));
    await writer.close();
    const reader = new PersistenceManager({ dbName: name, maxAge: 5_000 });
    expect((await reader.loadAll()).map(o => o.id)).toEqual(['new']);
    expect(await reader.load('P', 'old')).toBeNull();
    expect(await reader.count()).toBe(1);
    await reader.deleteDatabase();
  });

  it('skips non-cloneable objects without failing the batch', async () => {
    const pm = new PersistenceManager({ dbName: dbName() });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pm.save(obj('P', 'bad', { fn: () => 1 }));
    pm.save(obj('P', 'good', { a: 1 }));
    await pm.flush();
    expect((await pm.loadAll()).map(o => o.id)).toContain('good');
    warn.mockRestore();
    await pm.deleteDatabase();
  });

  it('degrades to a no-op without IndexedDB', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate missing IndexedDB
    delete globalThis.indexedDB;
    try {
      expect(PersistenceManager.isSupported()).toBe(false);
      const pm = new PersistenceManager();
      expect(await pm.open()).toBeNull();
      expect(pm.available).toBe(false);
      pm.save(obj('P', '1', {}));
      pm.delete('P', '1');
      expect(await pm.loadAll()).toEqual([]);
      expect(await pm.count()).toBe(0);
      await pm.clear();
      await pm.deleteDatabase();
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('gives up when open never answers', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => ({}) as IDBOpenDBRequest);
    const pm = new PersistenceManager({ dbName: dbName(), openTimeout: 100 });
    const opened = pm.open();
    await vi.advanceTimersByTimeAsync(100);
    expect(await opened).toBeNull();
    expect(pm.available).toBe(false);
    spy.mockRestore();
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('degrades when open fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const pm = new PersistenceManager({ dbName: dbName() });
    expect(await pm.open()).toBeNull();
    expect(pm.available).toBe(false);
    spy.mockRestore();
    warn.mockRestore();
  });
});
