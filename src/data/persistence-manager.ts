/**
 * PersistenceManager: IndexedDB storage so the store survives page loads.
 *
 * Writes are batched into one transaction per tick. If IndexedDB is unavailable
 * (some private-browsing modes, sandboxed iframes), every method becomes a
 * no-op instead of failing.
 *
 * @module data/persistence-manager
 */

import type { StoredObject } from './types';

const STORE_NAME = 'objects';
const DB_VERSION = 1;

export interface PersistenceOptions {
  /** Database name. @default 'arethesis' */
  dbName?: string;
  /** Drop persisted objects older than this many ms when loading. */
  maxAge?: number;
  /** Delay before flushing batched writes. @default 50 */
  flushDelay?: number;
  /**
   * Give up opening the database after this many ms (some browsers and
   * sandboxes never answer). Persistence is then disabled. @default 5000
   */
  openTimeout?: number;
}

interface StorableObject extends Omit<StoredObject, 'sources'> {
  sources: string[];
}

type Write = { op: 'put'; value: StorableObject } | { op: 'delete'; key: [string, string] };

export class PersistenceManager {
  readonly dbName: string;
  private readonly maxAge?: number;
  private readonly flushDelay: number;
  private readonly openTimeout: number;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private queue = new Map<string, Write>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private _available = true;

  constructor(options: PersistenceOptions = {}) {
    this.dbName = options.dbName ?? 'arethesis';
    this.maxAge = options.maxAge;
    this.flushDelay = options.flushDelay ?? 50;
    this.openTimeout = options.openTimeout ?? 5000;
  }

  /** Whether IndexedDB exists in this environment. */
  static isSupported(): boolean {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
      return false;
    }
  }

  /** False once opening the database has failed. */
  get available(): boolean {
    return this._available;
  }

  /** Open the database. Resolves to null (and disables persistence) on failure. */
  open(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase | null>(done => {
      let settled = false;
      const resolve = (db: IDBDatabase | null): void => {
        if (settled) {
          db?.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        done(db);
      };
      const timer = setTimeout(() => {
        console.warn('Arethesis: IndexedDB did not open in time, persistence disabled.');
        this._available = false;
        resolve(null);
      }, this.openTimeout);
      if (!PersistenceManager.isSupported()) {
        this._available = false;
        resolve(null);
        return;
      }
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(this.dbName, DB_VERSION);
      } catch (err) {
        console.warn('Arethesis: IndexedDB unavailable, persistence disabled.', err);
        this._available = false;
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: ['type', 'id'] });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => {
        console.warn('Arethesis: IndexedDB open failed, persistence disabled.', request.error);
        this._available = false;
        resolve(null);
      };
      request.onblocked = () => {
        console.warn('Arethesis: IndexedDB open blocked by another tab.');
      };
    });
    return this.dbPromise;
  }

  // ── Writes (batched) ─────────────────────────────────────────────────────

  /** Queue an object to be written. */
  save(obj: StoredObject): void {
    if (!this._available) return;
    const value: StorableObject = { ...obj, sources: Array.from(obj.sources) };
    this.queue.set(`${obj.type}:${obj.id}`, { op: 'put', value });
    this.scheduleFlush();
  }

  /** Queue an object to be removed. */
  delete(type: string, id: string): void {
    if (!this._available) return;
    this.queue.set(`${type}:${id}`, { op: 'delete', key: [type, id] });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushDelay);
  }

  /** Write everything queued now. Resolves when the transaction completes. */
  flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const writes = Array.from(this.queue.values());
    this.queue.clear();
    if (writes.length === 0) return this.flushing;
    this.flushing = this.flushing.then(async () => {
      const db = await this.open();
      if (!db) return;
      await new Promise<void>(resolve => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(STORE_NAME, 'readwrite');
        } catch (err) {
          console.warn('Arethesis: persistence write failed.', err);
          resolve();
          return;
        }
        const store = tx.objectStore(STORE_NAME);
        for (const write of writes) {
          try {
            if (write.op === 'put') store.put(write.value);
            else store.delete(write.key);
          } catch (err) {
            // e.g. DataCloneError for non-cloneable data; skip that object.
            console.warn('Arethesis: could not persist object.', err);
          }
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          console.warn('Arethesis: persistence transaction failed.', tx.error);
          resolve();
        };
        tx.onabort = () => resolve();
      });
    });
    return this.flushing;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  private async request<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    const db = await this.open();
    if (!db) return undefined;
    return new Promise<T | undefined>(resolve => {
      try {
        const req = fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  private revive<T>(raw: StorableObject): StoredObject<T> {
    return { ...raw, sources: new Set(raw.sources) } as StoredObject<T>;
  }

  private isExpired(raw: StorableObject): boolean {
    return this.maxAge !== undefined && Date.now() - raw.lastUpdated > this.maxAge;
  }

  /** Load one object (null if missing or expired). */
  async load<T = unknown>(type: string, id: string): Promise<StoredObject<T> | null> {
    await this.flush();
    const raw = await this.request<StorableObject>('readonly', s => s.get([type, id]));
    if (!raw || this.isExpired(raw)) return null;
    return this.revive<T>(raw);
  }

  /** Load every object, evicting expired ones. */
  async loadAll(): Promise<StoredObject[]> {
    await this.flush();
    const all = (await this.request<StorableObject[]>('readonly', s => s.getAll())) ?? [];
    const expired = all.filter(r => this.isExpired(r));
    for (const r of expired) this.delete(r.type, r.id);
    if (expired.length) await this.flush();
    return all.filter(r => !this.isExpired(r)).map(r => this.revive(r));
  }

  /** Load objects of one type. */
  async loadByType<T = unknown>(type: string): Promise<StoredObject<T>[]> {
    await this.flush();
    const all = (await this.request<StorableObject[]>('readonly', s => s.index('type').getAll(type))) ?? [];
    return all.filter(r => !this.isExpired(r)).map(r => this.revive<T>(r));
  }

  async count(): Promise<number> {
    await this.flush();
    return (await this.request<number>('readonly', s => s.count())) ?? 0;
  }

  /** Remove every persisted object (pending writes are discarded). */
  async clear(): Promise<void> {
    this.queue.clear();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushing;
    await this.request('readwrite', s => s.clear());
  }

  /** Close the connection. */
  async close(): Promise<void> {
    await this.flush();
    const db = await this.dbPromise;
    db?.close();
    this.dbPromise = null;
  }

  /** Delete the whole database. */
  async deleteDatabase(): Promise<void> {
    await this.close();
    if (!PersistenceManager.isSupported()) return;
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(this.dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
}
