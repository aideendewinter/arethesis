import { describe, expect, it, vi } from 'vitest';
import { ObjectStore } from '../object-store';
import { ListViewRegistry } from '../list-view-registry';
import { OptimisticUpdateManager } from '../optimistic-updates';

function setup() {
  const store = new ObjectStore();
  const views = new ListViewRegistry();
  const opt = new OptimisticUpdateManager(store, views);
  return { store, views, opt };
}

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('OptimisticUpdateManager', () => {
  it('applies updates immediately and commits the server result', async () => {
    const { store, opt } = setup();
    store.upsert('T', '1', { title: 'a', done: false });
    const d = deferred<{ title: string; done: boolean; v: number }>();
    const events = vi.fn();
    opt.on('commit', events);
    const p = opt.update('T', '1', { done: true }, () => d.promise);
    expect(store.getData('T', '1')).toEqual({ title: 'a', done: true });
    expect(opt.isPending('T', '1')).toBe(true);
    expect(opt.pendingCount).toBe(1);
    d.resolve({ title: 'a', done: true, v: 2 });
    await p;
    expect(store.getData('T', '1')).toEqual({ title: 'a', done: true, v: 2 });
    expect(opt.hasPending()).toBe(false);
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ kind: 'update', type: 'T', objectId: '1' }));
  });

  it('keeps the optimistic value when the API returns nothing', async () => {
    const { store, opt } = setup();
    store.upsert('T', '1', { a: 1 });
    await opt.update('T', '1', { a: 2 }, async () => undefined);
    expect(store.getData('T', '1')).toEqual({ a: 2 });
    expect([...store.get('T', '1')!.sources]).toContain('api');
  });

  it('rolls back only its own fields', async () => {
    const { store, opt } = setup();
    store.upsert('T', '1', { title: 'a', done: false });
    const a = deferred<Record<string, unknown>>();
    const b = deferred<Record<string, unknown>>();
    const rollback = vi.fn();
    opt.on('rollback', rollback);
    const pa = opt.update<Record<string, unknown>>('T', '1', { done: true, extra: 1 }, () => a.promise);
    const pb = opt.update<Record<string, unknown>>('T', '1', { title: 'b' }, () => b.promise);
    b.resolve({ title: 'b', done: true });
    await pb;
    a.reject(new Error('nope'));
    await expect(pa).rejects.toThrow('nope');
    // `title` (from b) survives; `done` and `extra` (from a) are rolled back.
    expect(store.getData('T', '1')).toEqual({ title: 'b', done: false });
    expect(rollback).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(Error) }));
  });

  it('does not clobber a field changed by someone else meanwhile', async () => {
    const { store, opt } = setup();
    store.upsert('T', '1', { title: 'a' });
    const d = deferred<Record<string, unknown>>();
    const p = opt.update<Record<string, unknown>>('T', '1', { title: 'mine' }, () => d.promise);
    store.upsert('T', '1', { title: 'theirs' }, { source: 'sse' });
    d.reject(new Error('x'));
    await expect(p).rejects.toThrow();
    expect(store.getData('T', '1')).toEqual({ title: 'theirs' });
  });

  it('rejects updates to missing objects', async () => {
    const { opt } = setup();
    await expect(opt.update('T', 'x', {}, async () => ({}))).rejects.toThrow(/not in the store/);
    await expect(opt.delete('T', 'x', async () => {})).rejects.toThrow(/not in the store/);
  });

  it('creates with a temp id and swaps in the real id', async () => {
    const { store, views, opt } = setup();
    const view = views.getOrCreate({ id: 'v', type: 'T' });
    views.populate('v', ['a']);
    const d = deferred<Record<string, unknown>>();
    const commits = vi.fn();
    opt.on('commit', commits);
    const p = opt.create<Record<string, unknown>>('T', { title: 'new' }, () => d.promise, { views: ['v'], tempId: 'tmp' });
    expect(view.ids).toEqual(['tmp', 'a']);
    expect(store.getData('T', 'tmp')).toEqual({ title: 'new', id: 'tmp' });
    d.resolve({ id: '42', title: 'new' });
    await p;
    expect(view.ids).toEqual(['42', 'a']);
    expect(commits).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', objectId: 'tmp', resultId: '42' }));
    expect(store.has('T', 'tmp')).toBe(false);
    expect(store.getData('T', '42')).toEqual({ id: '42', title: 'new' });
  });

  it('keeps the temp id if the server returns none', async () => {
    const { store, opt } = setup();
    await opt.create('T', { title: 'x' }, async () => ({ title: 'y' }), { tempId: 't' });
    expect(store.getData('T', 't')).toEqual({ title: 'y' });
    expect(opt.generateTempId()).toMatch(/^temp_/);
  });

  it('rolls back failed creates', async () => {
    const { store, views, opt } = setup();
    const view = views.getOrCreate({ id: 'v', type: 'T' });
    await expect(opt.create('T', { a: 1 }, async () => {
      throw new Error('x');
    }, { views: ['v'], tempId: 't', position: 'end' })).rejects.toThrow();
    expect(view.ids).toEqual([]);
    expect(store.has('T', 't')).toBe(false);
  });

  it('deletes optimistically and restores positions on failure', async () => {
    const { store, views, opt } = setup();
    store.upsert('T', 'b', { n: 'b' });
    const v1 = views.getOrCreate({ id: 'v1', type: 'T' });
    const v2 = views.getOrCreate({ id: 'v2', type: 'T' });
    views.populate('v1', ['a', 'b', 'c']);
    views.populate('v2', ['b']);
    const d = deferred<void>();
    const p = opt.delete('T', 'b', () => d.promise);
    expect(store.has('T', 'b')).toBe(false);
    expect(v1.ids).toEqual(['a', 'c']);
    d.reject(new Error('x'));
    await expect(p).rejects.toThrow();
    expect(store.getData('T', 'b')).toEqual({ n: 'b' });
    expect(v1.ids).toEqual(['a', 'b', 'c']);
    expect(v2.ids).toEqual(['b']);
    await opt.delete('T', 'b', async () => {});
    expect(store.has('T', 'b')).toBe(false);
  });
});
