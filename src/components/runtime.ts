/**
 * The services components use, provided by the Arethesis instance.
 *
 * @module components/runtime
 * @internal
 */

import type { ObjectStore } from '../data/object-store';
import type { ListViewRegistry } from '../data/list-view-registry';
import type { DataBinder } from '../binding/data-binder';
import type { HttpClient } from '../http/http-client';
import type { OptimisticUpdateManager } from '../data/optimistic-updates';

export interface ComponentRuntime {
  store: ObjectStore;
  listViews: ListViewRegistry;
  binder: DataBinder;
  http: HttpClient;
  optimistic: OptimisticUpdateManager;
}

let runtime: ComponentRuntime | null = null;

/** @internal */
export function setRuntime(next: ComponentRuntime): void {
  runtime = next;
}

/** @internal */
export function getRuntime(): ComponentRuntime {
  if (!runtime) throw new Error('Arethesis is not loaded. Import from "arethesis" and call getArethesis() first.');
  return runtime;
}

/** @internal */
export function hasRuntime(): boolean {
  return runtime !== null;
}
