/**
 * Real-time types: SSE, WebSocket, Azure Web PubSub and collaboration.
 *
 * @module realtime/types
 */

/** Connection state shared by all real-time managers. */
export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ReconnectOptions {
  /** Reconnect automatically after an unexpected close. @default true */
  reconnect?: boolean;
  /** Give up after this many consecutive failures. @default Infinity */
  maxReconnectAttempts?: number;
  /** @default 1000 */
  baseDelay?: number;
  /** @default 30000 */
  maxDelay?: number;
  /** @default 0.3 */
  jitter?: number;
}

export interface SSEConfig extends ReconnectOptions {
  url: string;
  withCredentials?: boolean;
  /** Query parameter carrying the access token (EventSource can't send headers). @default 'token' */
  tokenParam?: string | false;
  /** Query parameter carrying the last event id on reconnect. @default 'lastEventId' */
  lastEventIdParam?: string | false;
  /** Custom EventSource constructor (tests, polyfills, mock backends). */
  eventSourceFactory?: (url: string, init: EventSourceInit) => EventSource;
}

/** `{ type, id }` invalidates one object; `{ type }` invalidates the whole type. */
export interface InvalidatePayload {
  type: string;
  id?: string | number;
  ids?: Array<string | number>;
}

export interface DeletePayload {
  type: string;
  id: string | number;
}

/** Push fresh data straight into the store. */
export interface UpsertPayload {
  type: string;
  id?: string | number;
  data: unknown;
}

export interface WebSocketConfig extends ReconnectOptions {
  url: string;
  protocols?: string | string[];
  /** Send `{ type: 'ping' }` this often (ms); 0 disables. @default 30000 */
  pingInterval?: number;
  /** Query parameter for the access token. @default 'token' */
  tokenParam?: string | false;
  /** Messages queued while disconnected (oldest dropped beyond this). @default 1000 */
  maxQueue?: number;
  socketFactory?: (url: string, protocols?: string | string[]) => WebSocket;
}

export interface WebSocketMessage {
  type: string;
  channel?: string;
  payload?: unknown;
  [key: string]: unknown;
}

export type ChannelCallback<M = WebSocketMessage> = (message: M) => void;

export interface AzurePubSubConfig extends ReconnectOptions {
  /** Your backend's negotiate endpoint; returns `{ url }` or `{ token }`. */
  negotiateUrl: string;
  /** Azure endpoint, used with a `{ token }` negotiate response. */
  endpoint?: string;
  /** Groups to join on connect. */
  autoJoinGroups?: string[];
  /**
   * Apply `{ action: 'invalidate' | 'delete' | 'upsert', type, id }` messages to
   * the store. Only messages sent by the server are honored, never ones sent
   * to a group by another client. @default false
   */
  enableCacheInvalidation?: boolean;
  /** Ack timeout in ms. @default 15000 */
  ackTimeout?: number;
  fetch?: typeof fetch;
  socketFactory?: (url: string, protocol: string) => WebSocket;
}

export interface AzurePubSubNegotiateResponse {
  url?: string;
  token?: string;
}

export interface AzurePubSubMessage {
  type: 'message';
  group?: string;
  /** Alias of `group` for `subscribe()`. */
  channel?: string;
  from: 'server' | 'group';
  fromUserId?: string;
  dataType?: 'json' | 'text' | 'binary';
  payload: unknown;
}

// ── Collaboration ──────────────────────────────────────────────────────────

export interface CollabUser {
  id?: string;
  name: string;
  /** CSS color for this user's cursor. */
  color?: string;
}

export interface CollabSelection {
  anchor: number;
  head: number;
}

export interface PresencePayload {
  clientId?: string;
  user?: CollabUser;
  selection?: CollabSelection;
  revision?: number;
}

export type CollabMessageType =
  | 'collab:join'
  | 'collab:init'
  | 'collab:op'
  | 'collab:ack'
  | 'collab:presence'
  | 'collab:leave'
  | 'collab:error';

export interface CollabMessage extends WebSocketMessage {
  type: CollabMessageType;
  channel: string;
}

export interface RemoteCursor {
  clientId: string;
  user?: CollabUser;
  selection?: CollabSelection;
}
