/**
 * SSEManager: Server-Sent Events for cache invalidation and live data.
 *
 * Built-in events (named SSE events, or a generic message whose `action` field
 * names the event):
 * - `invalidate` `{ type, id? , ids? }`: mark objects stale (bound components refetch)
 * - `delete` `{ type, id }`: remove an object and drop it from list views
 * - `upsert` `{ type, id?, data }`: write fresh data into the store
 *
 * Any other event is available through `on(name, handler)`.
 *
 * Reconnects are handled here, not by EventSource itself, so each attempt
 * uses a freshly refreshed access token.
 *
 * @module realtime/sse-manager
 */

import type { ConnectionStatus, DeletePayload, InvalidatePayload, SSEConfig, UpsertPayload } from './types';
import type { ObjectStore } from '../data/object-store';
import type { ListViewRegistry } from '../data/list-view-registry';
import { ReconnectPolicy } from './reconnect';
import { Emitter } from '../utils/emitter';

type Handler = (data: unknown, event: MessageEvent) => void;

export class SSEManager {
  readonly config: SSEConfig;
  private source: EventSource | null = null;
  private store: ObjectStore | null = null;
  private listViews: ListViewRegistry | null = null;
  private getToken: (() => Promise<string | null> | string | null) | null = null;
  private policy: ReconnectPolicy;
  private generation = 0;
  private lastEventId: string | null = null;
  private handlers = new Emitter<Record<string, { data: unknown; event: MessageEvent }>>();
  private customEvents = new Set<string>();

  constructor(config: SSEConfig) {
    this.config = config;
    this.policy = new ReconnectPolicy(config);
  }

  connectStore(store: ObjectStore, listViews?: ListViewRegistry): void {
    this.store = store;
    this.listViews = listViews ?? null;
  }

  setTokenProvider(getter: () => Promise<string | null> | string | null): void {
    this.getToken = getter;
  }

  get status(): ConnectionStatus {
    return this.policy.status;
  }

  get isConnected(): boolean {
    return this.policy.status === 'open';
  }

  /** Listen for status changes. */
  onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    return this.policy.on('status', handler);
  }

  /** Listen for a named event (including built-ins). Returns an unsubscribe function. */
  on(event: string, handler: Handler): () => void {
    if (!['invalidate', 'delete', 'upsert', 'message', 'ping'].includes(event) && !this.customEvents.has(event)) {
      this.customEvents.add(event);
      this.source?.addEventListener(event, e => this.dispatch(event, e as MessageEvent));
    }
    return this.handlers.on(event, ({ data, event: e }) => handler(data, e));
  }

  /** Open the stream. Safe to call repeatedly. */
  async connect(): Promise<void> {
    if (this.source || this.policy.status === 'connecting') return;
    const gen = ++this.generation;
    this.policy.status = 'connecting';
    const url = await this.buildUrl();
    if (gen !== this.generation) return; // disconnected while fetching the token

    let source: EventSource;
    try {
      const init: EventSourceInit = { withCredentials: this.config.withCredentials };
      source = this.config.eventSourceFactory ? this.config.eventSourceFactory(url, init) : new EventSource(url, init);
    } catch (err) {
      console.error('SSE connection error:', err);
      this.source = null;
      this.policy.status = 'idle';
      this.policy.schedule(() => void this.connect());
      return;
    }
    this.source = source;

    source.onopen = () => {
      if (this.source === source) this.policy.succeeded();
    };
    source.onerror = () => {
      if (this.source !== source) return;
      // Take over reconnection so the next attempt gets a fresh token.
      source.close();
      this.source = null;
      this.policy.status = 'idle';
      this.policy.schedule(() => void this.connect());
    };
    source.onmessage = e => this.handleGeneric(e);
    for (const name of ['invalidate', 'delete', 'upsert', 'ping', ...this.customEvents]) {
      source.addEventListener(name, e => this.dispatch(name, e as MessageEvent));
    }
  }

  private async buildUrl(): Promise<string> {
    const params: string[] = [];
    const tokenParam = this.config.tokenParam ?? 'token';
    if (tokenParam && this.getToken) {
      const token = await this.getToken();
      if (token) params.push(`${encodeURIComponent(tokenParam)}=${encodeURIComponent(token)}`);
    }
    const idParam = this.config.lastEventIdParam ?? 'lastEventId';
    if (idParam && this.lastEventId) params.push(`${encodeURIComponent(idParam)}=${encodeURIComponent(this.lastEventId)}`);
    if (!params.length) return this.config.url;
    return `${this.config.url}${this.config.url.includes('?') ? '&' : '?'}${params.join('&')}`;
  }

  private parse(event: MessageEvent): unknown {
    if (event.lastEventId) this.lastEventId = event.lastEventId;
    if (typeof event.data !== 'string') return event.data;
    try {
      return JSON.parse(event.data);
    } catch {
      return event.data;
    }
  }

  private dispatch(name: string, event: MessageEvent): void {
    const data = this.parse(event);
    this.applyBuiltIn(name, data);
    this.handlers.emit(name, { data, event });
  }

  /** Generic `message` events: `{ action: 'invalidate' | 'delete' | 'upsert', type, ... }`. */
  private handleGeneric(event: MessageEvent): void {
    const data = this.parse(event);
    const action = typeof data === 'object' && data !== null
      ? ((data as Record<string, unknown>).action ?? (data as Record<string, unknown>).event) as string | undefined
      : undefined;
    if (action) {
      this.applyBuiltIn(action, data);
      this.handlers.emit(action, { data, event });
    }
    this.handlers.emit('message', { data, event });
  }

  private applyBuiltIn(name: string, data: unknown): void {
    if (!this.store || typeof data !== 'object' || data === null) return;
    const payload = data as Record<string, unknown>;
    if (typeof payload.type !== 'string') return;
    switch (name) {
      case 'invalidate': {
        const p = payload as unknown as InvalidatePayload;
        const ids = p.ids ?? (p.id !== undefined ? [p.id] : null);
        if (ids) this.store.batch(() => ids.forEach(id => this.store!.invalidate(p.type, id)));
        else this.store.invalidateByType(p.type);
        this.listViews?.invalidateByType(p.type);
        break;
      }
      case 'delete': {
        const p = payload as unknown as DeletePayload;
        if (p.id === undefined) return;
        this.listViews?.removeFromAll(p.type, String(p.id));
        this.store.delete(p.type, p.id);
        break;
      }
      case 'upsert': {
        const p = payload as unknown as UpsertPayload;
        const id = p.id ?? this.store.getId(p.type, p.data);
        if (id !== undefined) this.store.upsert(p.type, id, p.data, { source: 'sse' });
        break;
      }
    }
  }

  /** Close the stream and stop reconnecting. */
  disconnect(): void {
    this.generation++;
    this.policy.cancel();
    this.source?.close();
    this.source = null;
    this.policy.status = 'closed';
  }
}
