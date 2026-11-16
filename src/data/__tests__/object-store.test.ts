import { describe, expect, it, vi } from 'vitest';
import { ObjectStore } from '../object-store';

describe('ObjectStore', () => {
  it('creates and reads objects with metadata', () => {
    const store = new ObjectStore();
    const obj = store.upsert('Person', 1, { name: 'Alice' });
    expect(obj).toMatchObject({ id: '1', type: 'Person', version: 1, status: 'fresh' });
    expect(store.get('Person', '1')?.data).toEqual({ name: 'Alice' });
    expect(store.getData('Person', 1)).toEqual({ name: 'Alice' });
    expect(store.has('Person', 1)).toBe(true);
    expect(store.size).toBe(1);
    expect([...obj.sources]).toEqual(['api']);
  });

  it('shallow-merges by default and bumps versions', () => {
    const store = new ObjectStore();
    store.upsert('Person', '1', { name: 'Alice', role: 'x' });
    const next = store.upsert('Person', '1', { role: 'Engineer' }, { source: 'sse' });
    expect(next.data).toEqual({ name: 'Alice', role: 'Engineer' });
    expect(next.version).toBe(2);
    expect([...next.sources]).toEqual(['api', 'sse']);
  });

  it('supports replace, deep and custom merges', () => {
    const store = new ObjectStore();
    store.upsert('T', '1', { a: { b: 1, c: 2 }, x: 1 });
    expect(store.upsert('T', '1', { a: { b: 3 } }, { merge: 'deep' }).data).toEqual({ a: { b: 3, c: 2 }, x: 1 });
    expect(store.upsert('T', '1', { y: 1 }, { merge: 'replace' }).data).toEqual({ y: 1 });
    const fn = vi.fn((existing, incoming, ctx) => ({ ...(existing as object), ...(incoming as object), by: ctx.source }));
    expect(store.upsert('T', '1', { z: 1 }, { merge: fn, source: 'ws' }).data).toEqual({ y: 1, z: 1, by: 'ws' });
    expect(fn.mock.calls[0][2]).toMatchObject({ source: 'ws', existingVersion: 3, type: 'T', id: '1' });
    store.registerType({ name: 'R', defaultMerge: 'replace' });
    store.upsert('R', '1', { a: 1 });
    expect(store.upsert('R', '1', { b: 1 }).data).toEqual({ b: 1 });
    // Non-object values replace.
    store.upsert('P', '1', 5);
    expect(store.upsert('P', '1', 6).data).toBe(6);
  });

  it('strips __proto__ from incoming data', () => {
    const store = new ObjectStore();
    const evil = JSON.parse('{"__proto__": {"polluted": 1}, "ok": 1}');
    store.upsert('T', '1', evil);
    store.upsert('T', '1', evil);
    store.upsert('T', '1', evil, { merge: 'deep' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(store.getData('T', '1'))).toBe(Object.prototype);
  });

  it('ignores older data when a versionField is configured', () => {
    const store = new ObjectStore();
    store.registerType({ name: 'Doc', versionField: 'updatedAt' });
    store.upsert('Doc', '1', { title: 'new', updatedAt: '2026-05-02T00:00:00Z' });
    store.upsert('Doc', '1', { title: 'old', updatedAt: '2026-05-01T00:00:00Z' });
    expect(store.getData('Doc', '1')).toMatchObject({ title: 'new' });
    store.upsert('Doc', '1', { title: 'forced', updatedAt: '2026-01-01' }, { force: true });
    expect(store.getData('Doc', '1')).toMatchObject({ title: 'forced' });
    store.upsert('Doc', '1', { title: 'numeric', updatedAt: 'garbage' });
    expect(store.getData('Doc', '1')).toMatchObject({ title: 'numeric' });
  });

  it('marks objects stale after their TTL', () => {
    vi.useFakeTimers();
    const store = new ObjectStore();
    store.registerType({ name: 'T', ttl: 1000 });
    store.upsert('T', '1', {});
    expect(store.isStale('T', '1')).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(store.get('T', '1')?.status).toBe('stale');
    expect(store.getByType('T')[0].status).toBe('stale');
    expect(store.isStale('T', 'missing')).toBe(true);
    vi.useRealTimers();
  });

  it('notifies object and type subscribers', () => {
    const store = new ObjectStore();
    const obj = vi.fn();
    const type = vi.fn();
    const off = store.subscribe('T', '1', obj);
    store.subscribeToType('T', type);
    store.upsert('T', '1', { a: 1 });
    store.invalidate('T', '1');
    store.setStatus('T', '1', 'updating');
    store.setStatus('T', '1', 'updating'); // no-op
    store.delete('T', '1');
    expect(obj.mock.calls.map(c => c[1])).toEqual(['update', 'invalidate', 'update', 'delete']);
    expect(type.mock.calls.map(c => c[1])).toEqual(['update', 'invalidate', 'update', 'delete']);
    expect(store.subscriberCount('T', '1')).toBe(1);
    off();
    expect(store.subscriberCount('T', '1')).toBe(0);
    expect(store.delete('T', '1')).toBe(false);
  });

  it('isolates subscriber errors', () => {
    const store = new ObjectStore();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    store.subscribe('T', '1', () => {
      throw new Error('x');
    });
    store.subscribe('T', '1', good);
    store.upsert('T', '1', {});
    expect(good).toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
  });

  it('batches notifications', () => {
    const store = new ObjectStore();
    const type = vi.fn();
    store.subscribeToType('T', type);
    store.batch(() => {
      store.upsert('T', '1', { a: 1 });
      store.upsert('T', '1', { a: 2 });
      store.upsert('T', '2', { a: 3 });
      store.invalidate('T', '2'); // superseded by the earlier update? no: update then invalidate keeps update
    });
    expect(type).toHaveBeenCalledTimes(2);
    expect(type.mock.calls[0][0].data).toEqual({ a: 2 });
  });

  it('upserts many using idField', () => {
    const store = new ObjectStore();
    store.registerType({ name: 'P', idField: 'uuid' });
    const ids = store.upsertMany('P', [{ uuid: 'a' }, { uuid: 'b' }, { nope: 1 }]);
    expect(ids).toEqual(['a', 'b']);
    expect(store.getId('P', { uuid: 7 })).toBe('7');
    expect(store.getId('P', {})).toBeUndefined();
    expect(store.query<{ uuid: string }>('P', p => p.uuid === 'b')).toEqual([{ uuid: 'b' }]);
    expect(store.getAll()).toHaveLength(2);
  });

  it('invalidates a whole type and clears while keeping subscriptions', () => {
    const store = new ObjectStore();
    const cb = vi.fn();
    store.upsert('T', '1', {});
    store.upsert('T', '2', {});
    store.upsert('U', '1', {});
    store.subscribeToType('T', cb);
    store.invalidateByType('T');
    expect(store.get('T', '1')?.status).toBe('stale');
    expect(store.get('U', '1')?.status).toBe('fresh');
    expect(cb).toHaveBeenCalledTimes(2);
    cb.mockClear();
    store.clear();
    expect(store.size).toBe(0);
    expect(cb.mock.calls.map(c => c[1])).toEqual(['delete', 'delete']);
    store.upsert('T', '3', {});
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('hydrates without notifying and never overwrites memory', () => {
    const store = new ObjectStore();
    const cb = vi.fn();
    store.subscribeToType('T', cb);
    store.hydrate({ id: '1', type: 'T', data: { a: 1 }, version: 3, lastUpdated: Date.now(), sources: ['api'] as unknown as Set<string>, status: 'fresh' });
    expect(cb).not.toHaveBeenCalled();
    expect([...store.get('T', '1')!.sources]).toEqual(['api', 'indexeddb']);
    store.upsert('T', '2', { live: true });
    store.hydrate({ id: '2', type: 'T', data: { live: false }, version: 1, lastUpdated: 0, sources: new Set(), status: 'fresh' });
    expect(store.getData('T', '2')).toEqual({ live: true });
  });

  it('calls persistence hooks for persisted types', () => {
    const store = new ObjectStore();
    const hooks = { save: vi.fn(), remove: vi.fn(), clear: vi.fn() };
    store.setPersistence(hooks);
    store.registerType({ name: 'Local', persist: false });
    store.upsert('T', '1', {});
    store.upsert('T', '1', {}, { source: 'optimistic' });
    store.upsert('Local', '1', {});
    store.delete('T', '1');
    store.clear();
    expect(hooks.save).toHaveBeenCalledTimes(1);
    expect(hooks.remove).toHaveBeenCalledWith('T', '1');
    expect(hooks.clear).toHaveBeenCalled();
  });
});
