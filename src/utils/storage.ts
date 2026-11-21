/**
 * Web Storage that never throws.
 *
 * Private windows, blocked cookies and full quotas make `localStorage`
 * throw, sometimes on first access. `safeStorage()` catches that and keeps
 * values in memory instead, so they last for the page.
 *
 * @module utils/storage
 */

export type StorageKind = 'local' | 'session';

export interface SafeStorage {
  get(key: string): string | null;
  /** Store a value; `null` removes it. False if it only went to memory. */
  set(key: string, value: string | null): boolean;
  remove(key: string): void;
  /** False when the real storage is unavailable and values live in memory. */
  readonly persistent: boolean;
}

function resolve(kind: StorageKind | Storage): Storage | null {
  try {
    const storage = typeof kind !== 'string' ? kind : kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
    if (!storage) return null;
    const probe = '__ar_probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

const shared = new Map<StorageKind, SafeStorage>();

/** Storage with a memory fallback. `'local'` and `'session'` share one instance (and memory) per page. */
export function safeStorage(kind: StorageKind | Storage = 'local'): SafeStorage {
  if (typeof kind === 'string') {
    let instance = shared.get(kind);
    if (!instance) shared.set(kind, (instance = create(kind)));
    return instance;
  }
  return create(kind);
}

function create(kind: StorageKind | Storage): SafeStorage {
  const memory = new Map<string, string>();
  const storage = resolve(kind);
  return {
    get persistent() {
      return storage !== null;
    },
    get(key) {
      if (memory.has(key)) return memory.get(key)!;
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      if (value === null) {
        this.remove(key);
        return storage !== null;
      }
      try {
        if (storage) {
          storage.setItem(key, value);
          memory.delete(key);
          return true;
        }
      } catch {
        // Quota or a revoked permission: keep it for this page.
      }
      memory.set(key, value);
      return false;
    },
    remove(key) {
      memory.delete(key);
      try {
        storage?.removeItem(key);
      } catch {
        /* nothing to do */
      }
    },
  };
}

/**
 * Call `listener` when another tab changes `key` in localStorage (the
 * `storage` event; it doesn't fire for this tab's own writes). `key: null`
 * means it was cleared. Returns a function that stops listening.
 */
export function watchStorage(key: string, listener: (value: string | null) => void, kind: StorageKind | Storage = 'local'): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== key) return;
    let area: Storage | undefined;
    try {
      area = typeof kind !== 'string' ? kind : kind === 'local' ? localStorage : sessionStorage;
    } catch {
      return;
    }
    if (e.storageArea && e.storageArea !== area) return;
    listener(e.key === null ? null : e.newValue);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
