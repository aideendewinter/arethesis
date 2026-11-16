/**
 * Data layer types: the ObjectStore, ListViews and persistence.
 *
 * @module data/types
 */

/**
 * Freshness of a stored object.
 * - `fresh`: recently fetched or written
 * - `stale`: invalidated or past its TTL; should be refetched
 * - `updating`: a refetch is in flight
 * - `error`: the last refetch failed
 */
export type ObjectStatus = 'fresh' | 'stale' | 'updating' | 'error';

/** Context passed to custom merge functions. */
export interface MergeContext {
  /** Where the incoming data came from (`'api'`, `'sse'`, `'optimistic'`, ...). */
  source: string;
  /** Version of the object currently in the store. */
  existingVersion: number;
  /** Object type. */
  type: string;
  /** Object id. */
  id: string;
}

/** Custom merge function. */
export type MergeFunction = (existing: unknown, incoming: unknown, context: MergeContext) => unknown;

/**
 * How incoming data combines with what is already stored.
 * - `replace`: incoming wins entirely
 * - `shallow`: `{ ...existing, ...incoming }` (default)
 * - `deep`: recursive merge of plain objects; arrays replace
 */
export type MergeStrategy = 'replace' | 'shallow' | 'deep' | MergeFunction;

/** An object in the store, wrapped with metadata. */
export interface StoredObject<T = unknown> {
  id: string;
  type: string;
  data: T;
  /** Incremented on every write. */
  version: number;
  /** Milliseconds since epoch of the last write. */
  lastUpdated: number;
  /** Every source that has contributed data (`'api'`, `'sse'`, `'indexeddb'`, ...). */
  sources: Set<string>;
  status: ObjectStatus;
}

/** Per-type configuration, registered with `defineType()` or `store.registerType()`. */
export interface TypeConfig {
  /** Type name, e.g. `'Person'`. */
  name: string;
  /** Field holding the unique id. @default 'id' */
  idField?: string;
  /** Default merge strategy. @default 'shallow' */
  defaultMerge?: MergeStrategy;
  /** Milliseconds after which an object is considered stale. */
  ttl?: number;
  /** Persist objects of this type to IndexedDB. @default true */
  persist?: boolean;
  /**
   * Field used for conflict detection (a number or ISO timestamp, e.g. `'updatedAt'`).
   * Incoming data with an older value than the stored object is ignored.
   */
  versionField?: string;
  /**
   * Name of a registered endpoint that fetches one object by `:id`.
   * Used to refetch automatically when a bound object is invalidated.
   */
  endpoint?: string;
}

/** Options for `store.upsert()`. */
export interface UpsertOptions {
  /** Override the type's merge strategy. */
  merge?: MergeStrategy;
  /** Source tag. @default 'api' */
  source?: string;
  /** Skip subscriber notifications. */
  silent?: boolean;
  /** Write even if `versionField` says the incoming data is older. */
  force?: boolean;
}

/** Store change event. */
export type SubscriptionEvent = 'update' | 'delete' | 'invalidate';

/** Store subscriber. `obj` is `null` for deletes. */
export type Subscriber<T = unknown> = (obj: StoredObject<T> | null, event: SubscriptionEvent) => void;

/** Reference to a single stored object. */
export interface ObjectRef {
  type: string;
  id: string | number;
}

/** Sort criterion for a ListView. */
export interface SortConfig {
  field: string;
  direction: 'asc' | 'desc';
}

/** ListView lifecycle state. */
export type ListViewStatus = 'idle' | 'loading' | 'loaded' | 'loading-more' | 'error' | 'stale';

/** Configuration for `listViews.getOrCreate()`. */
export interface ListViewConfig {
  /** Explicit id. Defaults to a deterministic id computed from the config. */
  id?: string;
  /** Object type of the items. */
  type: string;
  /** Name of the registered list endpoint that loads pages. */
  endpoint?: string;
  /** Filters sent to the endpoint as query parameters. */
  filters?: Record<string, unknown>;
  /** Sort order, sent as `sort=field:dir,field2:dir`. */
  sort?: SortConfig[];
  /** Items per page. @default 50 */
  pageSize?: number;
}

/** A thin, ordered view over a list endpoint: ids plus pagination state. */
export interface ListView {
  readonly id: string;
  type: string;
  endpoint?: string;
  filters: Record<string, unknown>;
  sort: SortConfig[];
  pageSize: number;
  /** Ordered ids of objects in the store. */
  ids: string[];
  nextCursor: string | null;
  totalCount?: number;
  hasMore: boolean;
  status: ListViewStatus;
  error?: Error;
  /** When the first page was last loaded. */
  lastFetched?: number;
}

/** Pagination details extracted from a list response. */
export interface PageInfo {
  nextCursor?: string | null;
  hasMore?: boolean;
  totalCount?: number;
}

export type ListViewSubscriber = (view: ListView) => void;

/** Function that fetches a page for a ListView. Wired up by `Arethesis.init()`. */
export type ListViewLoader = (
  view: ListView,
  options: { append: boolean; signal?: AbortSignal }
) => Promise<{ ids: string[]; page: PageInfo }>;
