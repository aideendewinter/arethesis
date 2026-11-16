/**
 * ListViewRegistry: ordered, paginated views over list endpoints.
 *
 * A ListView stores ids, not objects; the objects live in the ObjectStore.
 * Views are keyed deterministically by their config, so two components asking
 * for "active people sorted by name" share one view and one set of requests.
 *
 * @example
 * ```ts
 * const view = app.listViews.getOrCreate({
 *   type: 'Person', endpoint: 'listPeople', filters: { active: true }, pageSize: 25,
 * });
 * await app.listViews.load(view);     // first page
 * await app.listViews.loadMore(view); // next page (cursor-based)
 * ```
 *
 * @module data/list-view-registry
 */

import type {
  ListView,
  ListViewConfig,
  ListViewLoader,
  ListViewSubscriber,
  PageInfo,
  SortConfig,
} from './types';
import { stableStringify } from '../utils/path';

export class ListViewRegistry {
  private views = new Map<string, ListView>();
  private subscribers = new Map<string, Set<ListViewSubscriber>>();
  private loader: ListViewLoader | null = null;
  private inflight = new Map<string, { promise: Promise<void>; controller: AbortController; append: boolean }>();
  private refetchScheduled = new Set<string>();

  /** Deterministic id for a config. */
  static computeId(config: ListViewConfig): string {
    if (config.id) return config.id;
    return [
      config.type,
      config.endpoint ?? '',
      stableStringify(config.filters ?? {}),
      stableStringify(config.sort ?? []),
      config.pageSize ?? 50,
    ].join('|');
  }

  /** Set the page loader (done by `Arethesis.init()`). */
  setLoader(loader: ListViewLoader | null): void {
    this.loader = loader;
  }

  /** Get an existing view for this config, or create it. */
  getOrCreate(config: ListViewConfig): ListView {
    const id = ListViewRegistry.computeId(config);
    const existing = this.views.get(id);
    if (existing) return existing;
    const view: ListView = {
      id,
      type: config.type,
      endpoint: config.endpoint,
      filters: { ...(config.filters ?? {}) },
      sort: [...(config.sort ?? [])],
      pageSize: config.pageSize ?? 50,
      ids: [],
      nextCursor: null,
      hasMore: true,
      status: 'idle',
    };
    this.views.set(id, view);
    return view;
  }

  get(viewId: string): ListView | undefined {
    return this.views.get(viewId);
  }

  has(viewId: string): boolean {
    return this.views.has(viewId);
  }

  getAll(): ListView[] {
    return Array.from(this.views.values());
  }

  getByType(type: string): ListView[] {
    return this.getAll().filter(v => v.type === type);
  }

  private resolve(view: ListView | string): ListView | undefined {
    return typeof view === 'string' ? this.views.get(view) : this.views.get(view.id) ?? view;
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  /**
   * Load (or reload) the first page. Concurrent calls share one request.
   * Starting a fresh load aborts an in-flight `loadMore`.
   */
  load(viewRef: ListView | string): Promise<void> {
    return this.run(viewRef, false);
  }

  /** Load the next page if there is one. No-op while another page is loading. */
  loadMore(viewRef: ListView | string): Promise<void> {
    const view = this.resolve(viewRef);
    if (!view) return Promise.resolve();
    if (!this.canLoadMore(view.id)) return this.inflight.get(view.id)?.promise ?? Promise.resolve();
    return this.run(view, true);
  }

  /** Reset and reload from the first page. */
  refresh(viewRef: ListView | string): Promise<void> {
    return this.run(viewRef, false, true);
  }

  private run(viewRef: ListView | string, append: boolean, force = false): Promise<void> {
    const view = this.resolve(viewRef);
    if (!view) return Promise.resolve();
    if (!this.loader) return Promise.reject(new Error('ListViewRegistry has no loader. Call Arethesis.init() first.'));

    const current = this.inflight.get(view.id);
    if (current) {
      if (!force && current.append === append) return current.promise;
      current.controller.abort();
    }

    const controller = new AbortController();
    this.setLoading(view.id, append);
    const loader = this.loader;
    const promise = (async () => {
      try {
        const { ids, page } = await loader(view, { append, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (append) this.appendPage(view.id, ids, page);
        else this.populate(view.id, ids, page);
      } catch (err) {
        if (controller.signal.aborted) return;
        this.setError(view.id, err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        if (this.inflight.get(view.id)?.controller === controller) this.inflight.delete(view.id);
      }
    })();
    this.inflight.set(view.id, { promise, controller, append });
    return promise;
  }

  /** Whether a request is in flight for the view. */
  isLoading(viewId: string): boolean {
    return this.inflight.has(viewId);
  }

  // ── State updates ────────────────────────────────────────────────────────

  /** Replace the ids with a first page. */
  populate(viewId: string, ids: string[], page: PageInfo = {}): void {
    const view = this.views.get(viewId);
    if (!view) return;
    view.ids = dedupe(ids);
    this.applyPage(view, page);
    view.lastFetched = Date.now();
    this.notify(viewId);
  }

  /** Append a page, skipping ids already present. */
  appendPage(viewId: string, ids: string[], page: PageInfo = {}): void {
    const view = this.views.get(viewId);
    if (!view) return;
    const seen = new Set(view.ids);
    view.ids = [...view.ids, ...ids.filter(id => !seen.has(id) && (seen.add(id), true))];
    this.applyPage(view, page);
    this.notify(viewId);
  }

  private applyPage(view: ListView, page: PageInfo): void {
    view.nextCursor = page.nextCursor ?? null;
    view.hasMore = page.hasMore ?? view.nextCursor !== null;
    if (page.totalCount !== undefined) view.totalCount = page.totalCount;
    view.status = 'loaded';
    view.error = undefined;
  }

  setLoading(viewId: string, isLoadingMore = false): void {
    const view = this.views.get(viewId);
    if (!view) return;
    view.status = isLoadingMore ? 'loading-more' : 'loading';
    this.notify(viewId);
  }

  setError(viewId: string, error: Error): void {
    const view = this.views.get(viewId);
    if (!view) return;
    view.status = 'error';
    view.error = error;
    this.notify(viewId);
  }

  /** Whether `loadMore` would fetch: there are more pages and nothing is loading. */
  canLoadMore(viewId: string): boolean {
    const view = this.views.get(viewId);
    if (!view) return false;
    return view.hasMore && view.status !== 'loading' && view.status !== 'loading-more' && view.status !== 'idle';
  }

  getNextCursor(viewId: string): string | null {
    return this.views.get(viewId)?.nextCursor ?? null;
  }

  /** Change filters or sort; resets the view and reloads it if it was loaded. */
  update(viewId: string, changes: { filters?: Record<string, unknown>; sort?: SortConfig[] }): Promise<void> {
    const view = this.views.get(viewId);
    if (!view) return Promise.resolve();
    if (changes.filters) view.filters = { ...changes.filters };
    if (changes.sort) view.sort = [...changes.sort];
    view.ids = [];
    view.nextCursor = null;
    view.hasMore = true;
    return this.loader ? this.refresh(viewId) : (this.notify(viewId), Promise.resolve());
  }

  // ── Optimistic edits ─────────────────────────────────────────────────────

  /** Insert an id at `'start'`, `'end'` or an index. Returns false for duplicates. */
  optimisticAdd(viewId: string, id: string, position: 'start' | 'end' | number = 'start'): boolean {
    const view = this.views.get(viewId);
    if (!view || view.ids.includes(id)) return false;
    const index = position === 'start' ? 0 : position === 'end' ? view.ids.length : Math.max(0, Math.min(position, view.ids.length));
    view.ids = [...view.ids.slice(0, index), id, ...view.ids.slice(index)];
    if (view.totalCount !== undefined) view.totalCount++;
    this.notify(viewId);
    return true;
  }

  /** Remove an id. Returns its former index, or -1. */
  optimisticRemove(viewId: string, id: string): number {
    const view = this.views.get(viewId);
    if (!view) return -1;
    const index = view.ids.indexOf(id);
    if (index === -1) return -1;
    view.ids = view.ids.filter(x => x !== id);
    if (view.totalCount !== undefined) view.totalCount = Math.max(0, view.totalCount - 1);
    this.notify(viewId);
    return index;
  }

  /** Move an id to a new index (for drag-and-drop reordering). */
  move(viewId: string, id: string, toIndex: number): void {
    const view = this.views.get(viewId);
    if (!view) return;
    const from = view.ids.indexOf(id);
    if (from === -1) return;
    const ids = view.ids.filter(x => x !== id);
    ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, id);
    view.ids = ids;
    this.notify(viewId);
  }

  /** Replace a temporary id with a server id in every view of a type. */
  replaceId(type: string, tempId: string, realId: string): void {
    for (const view of this.views.values()) {
      if (view.type !== type) continue;
      const index = view.ids.indexOf(tempId);
      if (index === -1) continue;
      const ids = view.ids.filter(x => x !== realId);
      ids[ids.indexOf(tempId)] = realId;
      view.ids = ids;
      this.notify(view.id);
    }
  }

  /** Remove an id from every view of a type. Returns the former positions by view id. */
  removeFromAll(type: string, id: string): Map<string, number> {
    const positions = new Map<string, number>();
    for (const view of this.views.values()) {
      if (view.type !== type) continue;
      const index = this.optimisticRemove(view.id, id);
      if (index !== -1) positions.set(view.id, index);
    }
    return positions;
  }

  // ── Invalidation ─────────────────────────────────────────────────────────

  /** Mark a view stale. Views with subscribers and a loader refetch automatically. */
  invalidate(viewId: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    view.status = 'stale';
    this.notify(viewId);
    this.scheduleRefetch(view);
  }

  invalidateByType(type: string): void {
    for (const view of this.getByType(type)) this.invalidate(view.id);
  }

  private scheduleRefetch(view: ListView): void {
    if (!this.loader || !this.subscribers.get(view.id)?.size || this.refetchScheduled.has(view.id)) return;
    this.refetchScheduled.add(view.id);
    queueMicrotask(() => {
      this.refetchScheduled.delete(view.id);
      if (this.views.get(view.id)?.status === 'stale') {
        this.refresh(view.id).catch(err => console.error('ListView refetch failed:', err));
      }
    });
  }

  /** Clear a view's ids and pagination. */
  reset(viewId: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.inflight.get(viewId)?.controller.abort();
    this.inflight.delete(viewId);
    view.ids = [];
    view.nextCursor = null;
    view.hasMore = true;
    view.totalCount = undefined;
    view.status = 'idle';
    view.error = undefined;
    this.notify(viewId);
  }

  /** Remove a view and its subscribers. */
  delete(viewId: string): void {
    this.inflight.get(viewId)?.controller.abort();
    this.inflight.delete(viewId);
    this.views.delete(viewId);
    this.subscribers.delete(viewId);
  }

  /** Reset every view (keeps subscriptions). */
  clear(): void {
    for (const id of this.views.keys()) this.reset(id);
  }

  // ── Subscriptions ────────────────────────────────────────────────────────

  subscribe(viewId: string, callback: ListViewSubscriber): () => void {
    let set = this.subscribers.get(viewId);
    if (!set) {
      set = new Set();
      this.subscribers.set(viewId, set);
    }
    set.add(callback);
    return () => this.subscribers.get(viewId)?.delete(callback);
  }

  private notify(viewId: string): void {
    const view = this.views.get(viewId);
    const subs = this.subscribers.get(viewId);
    if (!view || !subs) return;
    for (const cb of [...subs]) {
      try {
        cb(view);
      } catch (err) {
        console.error('ListView subscriber error:', err);
      }
    }
  }
}

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids));
}
