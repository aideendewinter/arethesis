import { describe, expect, it, vi } from 'vitest';
import { ListViewRegistry } from '../list-view-registry';
import { flush } from '../../../test/helpers';

describe('ListViewRegistry', () => {
  it('creates views with deterministic ids', () => {
    const reg = new ListViewRegistry();
    const a = reg.getOrCreate({ type: 'P', endpoint: 'list', filters: { b: 1, a: 2 } });
    const b = reg.getOrCreate({ type: 'P', endpoint: 'list', filters: { a: 2, b: 1 } });
    const c = reg.getOrCreate({ type: 'P', endpoint: 'list', filters: { a: 3 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatchObject({ type: 'P', pageSize: 50, ids: [], status: 'idle', hasMore: true });
    expect(reg.getOrCreate({ id: 'mine', type: 'P' }).id).toBe('mine');
    expect(reg.has('mine')).toBe(true);
    expect(reg.getByType('P')).toHaveLength(3);
  });

  it('populates and appends pages with dedupe', () => {
    const reg = new ListViewRegistry();
    const view = reg.getOrCreate({ id: 'v', type: 'P' });
    const cb = vi.fn();
    reg.subscribe('v', cb);
    reg.populate('v', ['1', '2', '2'], { nextCursor: 'c1', totalCount: 10 });
    expect(view).toMatchObject({ ids: ['1', '2'], nextCursor: 'c1', hasMore: true, totalCount: 10, status: 'loaded' });
    reg.appendPage('v', ['2', '3'], { nextCursor: null });
    expect(view.ids).toEqual(['1', '2', '3']);
    expect(view.hasMore).toBe(false);
    reg.appendPage('v', [], { hasMore: true });
    expect(view.hasMore).toBe(true);
    expect(cb).toHaveBeenCalledTimes(3);
    expect(reg.getNextCursor('v')).toBeNull();
  });

  it('tracks loading and errors', () => {
    const reg = new ListViewRegistry();
    reg.getOrCreate({ id: 'v', type: 'P' });
    expect(reg.canLoadMore('v')).toBe(false); // idle
    reg.populate('v', ['1'], { nextCursor: 'x' });
    expect(reg.canLoadMore('v')).toBe(true);
    reg.setLoading('v', true);
    expect(reg.get('v')!.status).toBe('loading-more');
    expect(reg.canLoadMore('v')).toBe(false);
    reg.setError('v', new Error('x'));
    expect(reg.get('v')!.status).toBe('error');
    expect(reg.canLoadMore('missing')).toBe(false);
  });

  it('loads through the loader and shares concurrent requests', async () => {
    const reg = new ListViewRegistry();
    const view = reg.getOrCreate({ id: 'v', type: 'P' });
    const loader = vi.fn(async (_v, { append }) => ({ ids: append ? ['3'] : ['1', '2'], page: { nextCursor: append ? null : 'n' } }));
    reg.setLoader(loader);
    await Promise.all([reg.load(view), reg.load('v')]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(view.ids).toEqual(['1', '2']);
    await reg.loadMore(view);
    expect(view.ids).toEqual(['1', '2', '3']);
    await reg.loadMore(view); // no more pages
    expect(loader).toHaveBeenCalledTimes(2);
    expect(reg.isLoading('v')).toBe(false);
  });

  it('reports loader errors and requires a loader', async () => {
    const reg = new ListViewRegistry();
    const view = reg.getOrCreate({ id: 'v', type: 'P' });
    await expect(reg.load(view)).rejects.toThrow(/no loader/);
    reg.setLoader(async () => {
      throw new Error('boom');
    });
    await expect(reg.load(view)).rejects.toThrow('boom');
    expect(view.status).toBe('error');
    expect(view.error?.message).toBe('boom');
    await expect(reg.load('missing')).resolves.toBeUndefined();
  });

  it('aborts a superseded load', async () => {
    const reg = new ListViewRegistry();
    const view = reg.getOrCreate({ id: 'v', type: 'P' });
    let first = true;
    reg.setLoader(async (_v, { signal }) => {
      if (first) {
        first = false;
        await new Promise(r => setTimeout(r, 20));
        expect(signal?.aborted).toBe(true);
        return { ids: ['stale'], page: {} };
      }
      return { ids: ['fresh'], page: {} };
    });
    const p1 = reg.load(view);
    const p2 = reg.refresh(view);
    await Promise.all([p1, p2]);
    expect(view.ids).toEqual(['fresh']);
  });

  it('updates filters and reloads', async () => {
    const reg = new ListViewRegistry();
    const view = reg.getOrCreate({ id: 'v', type: 'P' });
    const loader = vi.fn(async () => ({ ids: ['1'], page: {} }));
    reg.setLoader(loader);
    await reg.update('v', { filters: { q: 'a' }, sort: [{ field: 'name', direction: 'asc' }] });
    expect(view.filters).toEqual({ q: 'a' });
    expect(view.sort).toEqual([{ field: 'name', direction: 'asc' }]);
    expect(loader).toHaveBeenCalled();
  });

  it('handles optimistic edits', () => {
    const reg = new ListViewRegistry();
    const view = reg.getOrCreate({ id: 'v', type: 'P' });
    reg.populate('v', ['a', 'b'], { totalCount: 2 });
    expect(reg.optimisticAdd('v', 'c', 'end')).toBe(true);
    expect(reg.optimisticAdd('v', 'c')).toBe(false);
    reg.optimisticAdd('v', 'z', 1);
    expect(view.ids).toEqual(['a', 'z', 'b', 'c']);
    expect(view.totalCount).toBe(4);
    expect(reg.optimisticRemove('v', 'z')).toBe(1);
    expect(reg.optimisticRemove('v', 'nope')).toBe(-1);
    reg.move('v', 'c', 0);
    expect(view.ids).toEqual(['c', 'a', 'b']);
    reg.replaceId('P', 'c', 'real');
    expect(view.ids).toEqual(['real', 'a', 'b']);
    const other = reg.getOrCreate({ id: 'w', type: 'P' });
    reg.populate('w', ['a']);
    const positions = reg.removeFromAll('P', 'a');
    expect(positions.get('v')).toBe(1);
    expect(positions.get('w')).toBe(0);
    expect(other.ids).toEqual([]);
  });

  it('refetches invalidated views that have subscribers', async () => {
    const reg = new ListViewRegistry();
    const view = reg.getOrCreate({ id: 'v', type: 'P' });
    const loader = vi.fn(async () => ({ ids: ['1'], page: {} }));
    reg.setLoader(loader);
    reg.invalidate('v'); // no subscribers: just marks stale
    await flush();
    expect(view.status).toBe('stale');
    expect(loader).not.toHaveBeenCalled();
    reg.subscribe('v', () => {});
    reg.invalidateByType('P');
    reg.invalidateByType('P'); // deduped
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(view.status).toBe('loaded');
  });

  it('resets, deletes and clears', () => {
    const reg = new ListViewRegistry();
    const view = reg.getOrCreate({ id: 'v', type: 'P' });
    reg.populate('v', ['1'], { totalCount: 1 });
    reg.reset('v');
    expect(view).toMatchObject({ ids: [], status: 'idle', hasMore: true, totalCount: undefined });
    reg.populate('v', ['1']);
    reg.clear();
    expect(view.ids).toEqual([]);
    reg.delete('v');
    expect(reg.get('v')).toBeUndefined();
    expect(reg.getAll()).toEqual([]);
  });
});
