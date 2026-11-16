/**
 * OptimisticUpdateManager: apply a change to the store immediately, then
 * confirm or roll back when the server answers.
 *
 * Rollbacks are field-level: only fields this operation changed are restored,
 * and only if nothing else has changed them since. Two overlapping edits to
 * different fields of the same object can't undo each other.
 *
 * @example
 * ```ts
 * await app.optimistic.update('Task', '7', { done: true }, () =>
 *   app.http.request({ url: '/tasks/7', method: 'PATCH', body: { done: true } }));
 * ```
 *
 * @module data/optimistic-updates
 */

import type { ObjectStore } from './object-store';
import type { ListViewRegistry } from './list-view-registry';
import { Emitter } from '../utils/emitter';
import { deepEqual, isPlainObject } from '../utils/path';

export type OptimisticKind = 'update' | 'create' | 'delete';

export interface OptimisticEvent {
  id: string;
  kind: OptimisticKind;
  type: string;
  objectId: string;
  error?: unknown;
  /** For creates: the id the server assigned (replacing the temporary `objectId`). */
  resultId?: string;
}

export interface OptimisticEvents extends Record<string, unknown> {
  start: OptimisticEvent;
  commit: OptimisticEvent;
  rollback: OptimisticEvent;
}

export interface CreateOptions {
  /** Temporary id to use until the server responds. Generated if omitted. */
  tempId?: string;
  /** ListView ids to insert into. */
  views?: string[];
  /** Where to insert. @default 'start' */
  position?: 'start' | 'end' | number;
}

const ABSENT = Symbol('absent');

export class OptimisticUpdateManager extends Emitter<OptimisticEvents> {
  private pending = new Map<string, OptimisticEvent>();
  private counter = 0;

  constructor(private store: ObjectStore, private listViews: ListViewRegistry) {
    super();
  }

  /**
   * Optimistically merge `changes` into an object, then run `apiCall`.
   * If it resolves with an object, that becomes the stored value; if it throws,
   * the changed fields are restored and the error is rethrown.
   */
  async update<T extends Record<string, unknown>>(
    type: string,
    id: string | number,
    changes: Partial<T>,
    apiCall: () => Promise<T | void>
  ): Promise<T | void> {
    const objectId = String(id);
    const existing = this.store.get<T>(type, objectId);
    if (!existing) throw new Error(`Cannot update ${type}:${objectId}: not in the store`);

    const before = existing.data as Record<string, unknown>;
    const previous = new Map<string, unknown>();
    for (const key of Object.keys(changes)) {
      previous.set(key, Object.prototype.hasOwnProperty.call(before, key) ? before[key] : ABSENT);
    }

    const op = this.begin('update', type, objectId);
    this.store.upsert(type, objectId, { ...before, ...changes }, { source: 'optimistic', merge: 'replace' });

    try {
      const result = await apiCall();
      if (isPlainObject(result)) this.store.upsert(type, objectId, result, { source: 'api' });
      else {
        const current = this.store.get(type, objectId);
        if (current) this.store.upsert(type, objectId, current.data, { source: 'api', merge: 'replace', silent: true });
      }
      this.end(op, 'commit');
      return result;
    } catch (err) {
      const current = this.store.get<Record<string, unknown>>(type, objectId);
      if (current) {
        const restored: Record<string, unknown> = { ...current.data };
        for (const [key, prev] of previous) {
          if (!deepEqual(current.data[key], (changes as Record<string, unknown>)[key])) continue;
          if (prev === ABSENT) delete restored[key];
          else restored[key] = prev;
        }
        this.store.upsert(type, objectId, restored, { source: 'rollback', merge: 'replace' });
      }
      this.end(op, 'rollback', err);
      throw err;
    }
  }

  /**
   * Optimistically create an object under a temporary id, optionally adding it
   * to list views. When the server responds, the temporary id is swapped for
   * the real one everywhere.
   */
  async create<T extends Record<string, unknown>>(
    type: string,
    data: T,
    apiCall: () => Promise<T>,
    options: CreateOptions = {}
  ): Promise<T> {
    const tempId = options.tempId ?? this.generateTempId();
    const idField = this.store.getTypeConfig(type).idField;
    const op = this.begin('create', type, tempId);

    this.store.upsert(type, tempId, { ...data, [idField]: tempId }, { source: 'optimistic' });
    for (const viewId of options.views ?? []) this.listViews.optimisticAdd(viewId, tempId, options.position ?? 'start');

    try {
      const result = await apiCall();
      const realId = this.store.getId(type, result) ?? tempId;
      if (realId !== tempId) {
        this.store.batch(() => {
          this.store.upsert(type, realId, result, { source: 'api', merge: 'replace' });
          this.listViews.replaceId(type, tempId, realId);
          this.store.delete(type, tempId);
        });
      } else {
        this.store.upsert(type, realId, result, { source: 'api', merge: 'replace' });
      }
      this.end(op, 'commit', undefined, realId);
      return result;
    } catch (err) {
      this.listViews.removeFromAll(type, tempId);
      this.store.delete(type, tempId);
      this.end(op, 'rollback', err);
      throw err;
    }
  }

  /**
   * Optimistically delete an object and remove it from every list view of its
   * type. On failure it is restored at its original positions.
   */
  async delete(type: string, id: string | number, apiCall: () => Promise<unknown>): Promise<void> {
    const objectId = String(id);
    const existing = this.store.get(type, objectId);
    if (!existing) throw new Error(`Cannot delete ${type}:${objectId}: not in the store`);

    const snapshot = existing.data;
    const op = this.begin('delete', type, objectId);
    const positions = this.listViews.removeFromAll(type, objectId);
    this.store.delete(type, objectId);

    try {
      await apiCall();
      this.end(op, 'commit');
    } catch (err) {
      this.store.upsert(type, objectId, snapshot, { source: 'rollback', merge: 'replace' });
      for (const [viewId, index] of positions) this.listViews.optimisticAdd(viewId, objectId, index);
      this.end(op, 'rollback', err);
      throw err;
    }
  }

  private begin(kind: OptimisticKind, type: string, objectId: string): OptimisticEvent {
    const op: OptimisticEvent = { id: `op_${++this.counter}`, kind, type, objectId };
    this.pending.set(op.id, op);
    this.emit('start', op);
    return op;
  }

  private end(op: OptimisticEvent, outcome: 'commit' | 'rollback', error?: unknown, resultId?: string): void {
    this.pending.delete(op.id);
    this.emit(outcome, { ...op, ...(error === undefined ? {} : { error }), ...(resultId === undefined ? {} : { resultId }) });
  }

  /** A temporary id (`temp_…`). */
  generateTempId(): string {
    const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    return `temp_${Date.now().toString(36)}_${rand}`;
  }

  /** Whether an object has an operation in flight. */
  isPending(type: string, id: string | number): boolean {
    const objectId = String(id);
    for (const op of this.pending.values()) if (op.type === type && op.objectId === objectId) return true;
    return false;
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
