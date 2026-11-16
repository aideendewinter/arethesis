/**
 * ObjectStore: the normalized, reactive cache at the center of Arethesis.
 *
 * Every object lives under `type:id`. Components, list views and the HTTP layer
 * all read from and write to the same store, so an edit in one place shows up
 * everywhere that object is displayed.
 *
 * @example
 * ```ts
 * store.registerType({ name: 'Person', ttl: 5 * 60_000 });
 * store.upsert('Person', '1', { name: 'Alice' });
 * const off = store.subscribe('Person', '1', (obj, event) => console.log(event, obj?.data));
 * store.upsert('Person', '1', { title: 'Engineer' }); // shallow-merged
 * off();
 * ```
 *
 * @module data/object-store
 */

import type {
  StoredObject,
  TypeConfig,
  ObjectStatus,
  MergeStrategy,
  MergeContext,
  UpsertOptions,
  Subscriber,
  SubscriptionEvent,
} from './types';
import { deepMerge, getPath, isPlainObject, safeAssign } from '../utils/path';

type ResolvedTypeConfig = Required<Pick<TypeConfig, 'name' | 'idField' | 'defaultMerge' | 'persist'>> & TypeConfig;

export interface PersistenceHooks {
  save(obj: StoredObject): void;
  remove(type: string, id: string): void;
  clear(): void;
}

export class ObjectStore {
  private objects = new Map<string, StoredObject>();
  private subscribers = new Map<string, Set<Subscriber>>();
  private typeSubscribers = new Map<string, Set<Subscriber>>();
  private typeConfigs = new Map<string, TypeConfig>();
  private persistence: PersistenceHooks | null = null;
  private batchDepth = 0;
  private pending = new Map<string, { obj: StoredObject | null; event: SubscriptionEvent; type: string }>();

  private key(type: string, id: string | number): string {
    return `${type}:${String(id)}`;
  }

  // ── Types ────────────────────────────────────────────────────────────────

  /** Register (or replace) configuration for a type. */
  registerType(config: TypeConfig): void {
    this.typeConfigs.set(config.name, config);
  }

  /** Configuration for a type, with defaults applied. */
  getTypeConfig(type: string): ResolvedTypeConfig {
    const config = this.typeConfigs.get(type);
    return {
      idField: 'id',
      defaultMerge: 'shallow',
      persist: true,
      ...config,
      name: type,
    };
  }

  /** Read an object's id using its type's `idField`. */
  getId(type: string, data: unknown): string | undefined {
    const value = getPath(data, this.getTypeConfig(type).idField);
    return value === undefined || value === null ? undefined : String(value);
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Get an object with metadata. Objects past their TTL come back marked `stale`. */
  get<T = unknown>(type: string, id: string | number): StoredObject<T> | undefined {
    const obj = this.objects.get(this.key(type, id));
    if (obj) this.applyTtl(obj);
    return obj as StoredObject<T> | undefined;
  }

  /** Get just the data payload. */
  getData<T = unknown>(type: string, id: string | number): T | undefined {
    return this.get<T>(type, id)?.data;
  }

  /** Whether an object exists. */
  has(type: string, id: string | number): boolean {
    return this.objects.has(this.key(type, id));
  }

  /** Whether an object is missing, stale, or past its TTL. */
  isStale(type: string, id: string | number): boolean {
    const obj = this.get(type, id);
    return !obj || obj.status === 'stale' || obj.status === 'error';
  }

  /** All objects of a type, in insertion order. */
  getByType<T = unknown>(type: string): StoredObject<T>[] {
    const results: StoredObject<T>[] = [];
    for (const obj of this.objects.values()) {
      if (obj.type === type) {
        this.applyTtl(obj);
        results.push(obj as StoredObject<T>);
      }
    }
    return results;
  }

  /** Data of all objects of a type matching a predicate. */
  query<T = unknown>(type: string, predicate: (data: T) => boolean = () => true): T[] {
    return this.getByType<T>(type).map(o => o.data).filter(predicate);
  }

  /** Every stored object. */
  getAll(): StoredObject[] {
    return Array.from(this.objects.values());
  }

  get size(): number {
    return this.objects.size;
  }

  private applyTtl(obj: StoredObject): void {
    if (obj.status !== 'fresh') return;
    const ttl = this.typeConfigs.get(obj.type)?.ttl;
    if (ttl !== undefined && Date.now() - obj.lastUpdated > ttl) {
      obj.status = 'stale';
    }
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Create or update an object. Existing data is merged with the type's merge
   * strategy (shallow by default). If the type has a `versionField` and the
   * incoming value is older than the stored one, the write is skipped.
   */
  upsert<T = unknown>(type: string, id: string | number, data: T, options: UpsertOptions = {}): StoredObject<T> {
    const strId = String(id);
    const key = this.key(type, strId);
    const existing = this.objects.get(key) as StoredObject<T> | undefined;
    const config = this.getTypeConfig(type);
    const source = options.source ?? 'api';

    if (existing && config.versionField && !options.force &&
        this.isOlder(getPath(data, config.versionField), getPath(existing.data, config.versionField))) {
      return existing;
    }

    const strategy = options.merge ?? config.defaultMerge;
    const merged = existing
      ? this.merge(existing.data, data, strategy, { source, existingVersion: existing.version, type, id: strId })
      : this.clean(data);

    const stored: StoredObject<T> = {
      id: strId,
      type,
      data: merged as T,
      version: existing ? existing.version + 1 : 1,
      lastUpdated: Date.now(),
      sources: new Set(existing ? [...existing.sources, source] : [source]),
      status: 'fresh',
    };

    this.objects.set(key, stored as StoredObject);

    if (!options.silent) this.queue(key, type, stored as StoredObject, 'update');
    if (config.persist && source !== 'optimistic') this.persistence?.save(stored as StoredObject);

    return stored;
  }

  /**
   * Upsert many objects of one type. Ids are read from the type's `idField`.
   * Subscribers are notified once per object after all writes are applied.
   * Returns the ids in input order (items without an id are skipped).
   */
  upsertMany<T = unknown>(type: string, items: T[], options: UpsertOptions = {}): string[] {
    const ids: string[] = [];
    this.batch(() => {
      for (const item of items) {
        const id = this.getId(type, item);
        if (id === undefined) continue;
        this.upsert(type, id, item, options);
        ids.push(id);
      }
    });
    return ids;
  }

  private isOlder(incoming: unknown, existing: unknown): boolean {
    if (incoming === undefined || incoming === null || existing === undefined || existing === null) return false;
    const toNum = (v: unknown): number => (typeof v === 'number' ? v : Date.parse(String(v)));
    const a = toNum(incoming);
    const b = toNum(existing);
    if (isNaN(a) || isNaN(b)) return false;
    return a < b;
  }

  private clean<T>(data: T): T {
    // Strip prototype-polluting keys from top-level plain objects.
    return isPlainObject(data) ? (safeAssign({}, data) as T) : data;
  }

  private merge(existing: unknown, incoming: unknown, strategy: MergeStrategy, ctx: MergeContext): unknown {
    if (typeof strategy === 'function') return strategy(existing, incoming, ctx);
    switch (strategy) {
      case 'replace':
        return this.clean(incoming);
      case 'deep':
        return deepMerge(existing, incoming);
      case 'shallow':
      default:
        if (isPlainObject(existing) && isPlainObject(incoming)) {
          return safeAssign({ ...existing }, incoming);
        }
        return this.clean(incoming);
    }
  }

  /** Remove an object. Returns false if it did not exist. */
  delete(type: string, id: string | number, silent = false): boolean {
    const key = this.key(type, id);
    if (!this.objects.has(key)) return false;
    this.objects.delete(key);
    if (!silent) this.queue(key, type, null, 'delete');
    this.persistence?.remove(type, String(id));
    return true;
  }

  /** Mark an object stale and notify subscribers (`'invalidate'`). */
  invalidate(type: string, id: string | number): void {
    const key = this.key(type, id);
    const obj = this.objects.get(key);
    if (!obj) return;
    obj.status = 'stale';
    this.queue(key, type, obj, 'invalidate');
  }

  /** Mark every object of a type stale. */
  invalidateByType(type: string): void {
    this.batch(() => {
      for (const [key, obj] of this.objects) {
        if (obj.type === type) {
          obj.status = 'stale';
          this.queue(key, type, obj, 'invalidate');
        }
      }
    });
  }

  /** Set an object's status (e.g. `'updating'` while refetching). */
  setStatus(type: string, id: string | number, status: ObjectStatus): void {
    const key = this.key(type, id);
    const obj = this.objects.get(key);
    if (!obj || obj.status === status) return;
    obj.status = status;
    this.queue(key, type, obj, 'update');
  }

  /**
   * Remove every object, notifying subscribers with `'delete'`. Subscriptions
   * stay registered so mounted components keep working (e.g. after logout).
   */
  clear(): void {
    const removed = Array.from(this.objects.entries());
    this.objects.clear();
    this.batch(() => {
      for (const [key, obj] of removed) this.queue(key, obj.type, null, 'delete');
    });
    this.persistence?.clear();
  }

  /** Run several writes and deliver notifications once at the end. */
  batch(fn: () => void): void {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) this.flush();
    }
  }

  // ── Subscriptions ────────────────────────────────────────────────────────

  /** Subscribe to one object. Returns an unsubscribe function. */
  subscribe<T = unknown>(type: string, id: string | number, callback: Subscriber<T>): () => void {
    return this.addSub(this.subscribers, this.key(type, id), callback as Subscriber);
  }

  /** Subscribe to every object of a type. */
  subscribeToType<T = unknown>(type: string, callback: Subscriber<T>): () => void {
    return this.addSub(this.typeSubscribers, type, callback as Subscriber);
  }

  private addSub(map: Map<string, Set<Subscriber>>, key: string, cb: Subscriber): () => void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(cb);
    return () => {
      const s = map.get(key);
      s?.delete(cb);
      if (s?.size === 0) map.delete(key);
    };
  }

  /** Number of subscribers for an object (useful for deciding whether to refetch). */
  subscriberCount(type: string, id: string | number): number {
    return this.subscribers.get(this.key(type, id))?.size ?? 0;
  }

  private queue(key: string, type: string, obj: StoredObject | null, event: SubscriptionEvent): void {
    if (this.batchDepth > 0) {
      const prev = this.pending.get(key);
      // A delete or update supersedes an earlier invalidate.
      if (!prev || event !== 'invalidate' || prev.event === 'invalidate') {
        this.pending.set(key, { obj, event, type });
      }
      return;
    }
    this.deliver(key, type, obj, event);
  }

  private flush(): void {
    const items = Array.from(this.pending.entries());
    this.pending.clear();
    for (const [key, { obj, event, type }] of items) this.deliver(key, type, obj, event);
  }

  private deliver(key: string, type: string, obj: StoredObject | null, event: SubscriptionEvent): void {
    for (const set of [this.subscribers.get(key), this.typeSubscribers.get(type)]) {
      if (!set) continue;
      for (const cb of [...set]) {
        try {
          cb(obj, event);
        } catch (err) {
          console.error('Store subscriber error:', err);
        }
      }
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  /**
   * Restore an object (e.g. from IndexedDB) without notifying or re-persisting.
   * Existing in-memory objects win over hydrated ones.
   */
  hydrate<T>(obj: StoredObject<T>): void {
    const key = this.key(obj.type, obj.id);
    if (this.objects.has(key)) return;
    const sources = obj.sources instanceof Set ? obj.sources : new Set<string>(obj.sources as unknown as string[]);
    sources.add('indexeddb');
    const stored: StoredObject<T> = { ...obj, id: String(obj.id), data: this.clean(obj.data), sources };
    this.applyTtl(stored as StoredObject);
    this.objects.set(key, stored as StoredObject);
  }

  /** Connect a persistence backend (done by `Arethesis.init()`). */
  setPersistence(hooks: PersistenceHooks | null): void {
    this.persistence = hooks;
  }
}
