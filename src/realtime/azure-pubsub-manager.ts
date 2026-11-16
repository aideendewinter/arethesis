/**
 * AzurePubSubManager: Azure Web PubSub over the `json.webpubsub.azure.v1`
 * subprotocol, with groups as channels.
 *
 * - Connects through your negotiate endpoint (which returns `{ url }` or `{ token }`).
 * - Joins, leaves and sends with acks; groups are rejoined after reconnects.
 * - Optionally applies cache invalidation messages, but **only** ones sent by
 *   the server, so other clients in a group can't tamper with your cache.
 *
 * @module realtime/azure-pubsub-manager
 */

import type {
  AzurePubSubConfig,
  AzurePubSubMessage,
  AzurePubSubNegotiateResponse,
  ChannelCallback,
  ConnectionStatus,
} from './types';
import type { ObjectStore } from '../data/object-store';
import type { ListViewRegistry } from '../data/list-view-registry';
import { ReconnectPolicy } from './reconnect';

const SUBPROTOCOL = 'json.webpubsub.azure.v1';

interface ServerMessage {
  type: 'system' | 'message' | 'ack';
  event?: 'connected' | 'disconnected';
  from?: 'server' | 'group';
  group?: string;
  fromUserId?: string;
  dataType?: 'json' | 'text' | 'binary';
  data?: unknown;
  ackId?: number;
  success?: boolean;
  error?: { name: string; message: string };
  connectionId?: string;
  userId?: string;
}

interface ClientMessage {
  type: 'joinGroup' | 'leaveGroup' | 'sendToGroup' | 'event';
  group?: string;
  dataType?: 'json' | 'text';
  data?: unknown;
  ackId?: number;
  noEcho?: boolean;
  event?: string;
}

export class AzurePubSubManager {
  readonly config: AzurePubSubConfig;
  private socket: WebSocket | null = null;
  private channels = new Map<string, Set<ChannelCallback<AzurePubSubMessage>>>();
  private joined = new Set<string>();
  private joining = new Map<string, Promise<void>>();
  private queue: ClientMessage[] = [];
  private acks = new Map<number, { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private ackId = 0;
  private store: ObjectStore | null = null;
  private listViews: ListViewRegistry | null = null;
  private getToken: (() => Promise<string | null> | string | null) | null = null;
  private policy: ReconnectPolicy;
  private generation = 0;
  private connectionId: string | null = null;
  private userId: string | null = null;

  constructor(config: AzurePubSubConfig) {
    this.config = { ackTimeout: 15000, autoJoinGroups: [], ...config };
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
    return this.socket?.readyState === 1 && this.connectionId !== null;
  }

  onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    return this.policy.on('status', handler);
  }

  getConnectionId(): string | null {
    return this.connectionId;
  }

  getUserId(): string | null {
    return this.userId;
  }

  async connect(): Promise<void> {
    if (this.socket || this.policy.status === 'connecting') return;
    const gen = ++this.generation;
    this.policy.status = 'connecting';
    let url: string;
    try {
      url = await this.negotiate();
    } catch (err) {
      if (gen !== this.generation) return;
      console.error('Azure PubSub negotiate failed:', err);
      this.policy.status = 'idle';
      this.policy.schedule(() => void this.connect());
      return;
    }
    // disconnect() was called during negotiation.
    if (gen !== this.generation) return;

    const socket = this.config.socketFactory ? this.config.socketFactory(url, SUBPROTOCOL) : new WebSocket(url, SUBPROTOCOL);
    this.socket = socket;
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.handle(message);
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connectionId = null;
      this.failAcks('Connection closed');
      this.policy.status = 'idle';
      if (event.code !== 1000) this.policy.schedule(() => void this.connect());
      else this.policy.status = 'closed';
    };
    socket.onerror = () => {
      /* onclose follows */
    };
  }

  private async negotiate(): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.getToken ? await this.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    const fetchImpl = this.config.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await fetchImpl(this.config.negotiateUrl, { method: 'POST', headers, credentials: 'include' });
    if (!response.ok) throw new Error(`Negotiate failed: ${response.status}`);
    const data = (await response.json()) as AzurePubSubNegotiateResponse;
    if (data.url) return data.url;
    if (data.token && this.config.endpoint) {
      return `${this.config.endpoint}${this.config.endpoint.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(data.token)}`;
    }
    throw new Error('Negotiate response has no url (or token without an endpoint)');
  }

  private handle(message: ServerMessage): void {
    if (message.type === 'system' && message.event === 'connected') {
      this.connectionId = message.connectionId ?? null;
      this.userId = message.userId ?? null;
      this.policy.succeeded();
      const groups = new Set([...(this.config.autoJoinGroups ?? []), ...this.joined, ...[...this.channels.keys()].filter(c => c !== '*')]);
      this.joined.clear();
      for (const group of groups) this.joinGroup(group).catch(err => console.error('Failed to join group', group, err));
      this.flush();
      return;
    }
    if (message.type === 'ack' && message.ackId !== undefined) {
      const pending = this.acks.get(message.ackId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.acks.delete(message.ackId);
      // "Duplicate" means the operation already succeeded.
      if (message.success || message.error?.name === 'Duplicate') pending.resolve();
      else pending.reject(new Error(message.error?.message ?? 'Operation failed'));
      return;
    }
    if (message.type === 'message') {
      const from = message.from ?? 'group';
      if (this.config.enableCacheInvalidation && from === 'server') this.applyCacheMessage(message.data);
      this.dispatch({
        type: 'message',
        group: message.group,
        channel: message.group,
        from,
        fromUserId: message.fromUserId,
        dataType: message.dataType,
        payload: message.data,
      });
    }
  }

  private applyCacheMessage(data: unknown): void {
    if (!this.store || typeof data !== 'object' || data === null) return;
    const { action, type, id, data: objectData } = data as { action?: string; type?: string; id?: string | number; data?: unknown };
    if (!type) return;
    if (action === 'invalidate') {
      if (id !== undefined) this.store.invalidate(type, id);
      else this.store.invalidateByType(type);
      this.listViews?.invalidateByType(type);
    } else if (action === 'delete' && id !== undefined) {
      this.listViews?.removeFromAll(type, String(id));
      this.store.delete(type, id);
    } else if (action === 'upsert' && objectData !== undefined) {
      const objectId = id ?? this.store.getId(type, objectData);
      if (objectId !== undefined) this.store.upsert(type, objectId, objectData, { source: 'azure-pubsub' });
    }
  }

  private dispatch(message: AzurePubSubMessage): void {
    for (const set of [message.group ? this.channels.get(message.group) : undefined, this.channels.get('*')]) {
      if (!set) continue;
      for (const cb of [...set]) {
        try {
          cb(message);
        } catch (err) {
          console.error('Azure PubSub subscriber error:', err);
        }
      }
    }
  }

  /** Subscribe to a group (`'*'` for every message). Joins the group if needed. */
  subscribe(group: string, callback: ChannelCallback<AzurePubSubMessage>): () => void {
    let set = this.channels.get(group);
    if (!set) {
      set = new Set();
      this.channels.set(group, set);
    }
    set.add(callback);
    if (group !== '*' && this.isConnected) this.joinGroup(group).catch(err => console.error('Failed to join group', group, err));
    return () => {
      const s = this.channels.get(group);
      if (!s?.delete(callback) || s.size > 0) return;
      this.channels.delete(group);
      if (group !== '*' && this.joined.has(group) && this.isConnected) {
        this.leaveGroup(group).catch(err => console.error('Failed to leave group', group, err));
      }
    };
  }

  /** Join a group (deduplicated while in flight). */
  joinGroup(group: string): Promise<void> {
    if (this.joined.has(group)) return Promise.resolve();
    const existing = this.joining.get(group);
    if (existing) return existing;
    const promise = this.sendWithAck({ type: 'joinGroup', group })
      .then(() => {
        this.joined.add(group);
      })
      .finally(() => this.joining.delete(group));
    this.joining.set(group, promise);
    return promise;
  }

  async leaveGroup(group: string): Promise<void> {
    if (!this.joined.has(group)) return;
    await this.sendWithAck({ type: 'leaveGroup', group });
    this.joined.delete(group);
  }

  /** Send JSON data to a group. Resolves when acknowledged. */
  sendToGroup(group: string, data: unknown, options: { noEcho?: boolean } = {}): Promise<void> {
    return this.sendWithAck({ type: 'sendToGroup', group, dataType: 'json', data, noEcho: options.noEcho ?? false });
  }

  /** Send a custom event to the server-side handler. */
  sendEvent(event: string, data: unknown): Promise<void> {
    return this.sendWithAck({ type: 'event', event, dataType: 'json', data });
  }

  private sendWithAck(message: ClientMessage): Promise<void> {
    if (!this.isConnected) {
      // Joins are replayed from `channels`/`joined` on connect; queue the rest.
      if (message.type !== 'joinGroup' && message.type !== 'leaveGroup') this.queue.push(message);
      return Promise.resolve();
    }
    const ackId = ++this.ackId;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.acks.delete(ackId)) reject(new Error('Ack timeout'));
      }, this.config.ackTimeout);
      this.acks.set(ackId, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ ...message, ackId }));
    });
  }

  private flush(): void {
    for (const message of this.queue.splice(0)) {
      this.sendWithAck(message).catch(err => console.error('Queued message failed:', err));
    }
  }

  private failAcks(reason: string): void {
    for (const pending of this.acks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.acks.clear();
  }

  disconnect(): void {
    this.generation++;
    this.policy.cancel();
    const socket = this.socket;
    this.socket = null;
    this.connectionId = null;
    this.failAcks('Disconnected');
    if (socket) {
      socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close(1000, 'Client disconnect');
      } catch {
        /* ignore */
      }
    }
    this.policy.status = 'closed';
  }
}
