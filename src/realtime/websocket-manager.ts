/**
 * WebSocketManager: channels, presence and edits over one WebSocket.
 *
 * Messages are JSON `{ type, channel?, payload? }`. Subscribing to a channel
 * sends `{ type: 'subscribe', channel }`; channels are re-subscribed after a
 * reconnect, and messages sent while offline are queued. Subscribe to `'*'`
 * to receive everything.
 *
 * @module realtime/websocket-manager
 */

import type { ChannelCallback, ConnectionStatus, WebSocketConfig, WebSocketMessage } from './types';
import { ReconnectPolicy } from './reconnect';

const SYSTEM_TYPES = new Set(['ping', 'pong']);

export class WebSocketManager {
  readonly config: WebSocketConfig;
  private socket: WebSocket | null = null;
  private channels = new Map<string, Set<ChannelCallback>>();
  private queue: WebSocketMessage[] = [];
  private getToken: (() => Promise<string | null> | string | null) | null = null;
  private policy: ReconnectPolicy;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private openListeners = new Set<() => void>();

  constructor(config: WebSocketConfig) {
    this.config = { pingInterval: 30000, maxQueue: 1000, ...config };
    this.policy = new ReconnectPolicy(config);
  }

  setTokenProvider(getter: () => Promise<string | null> | string | null): void {
    this.getToken = getter;
  }

  get status(): ConnectionStatus {
    return this.policy.status;
  }

  get isConnected(): boolean {
    return this.socket?.readyState === 1;
  }

  onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    return this.policy.on('status', handler);
  }

  /** Called every time the connection opens (initially and after reconnects). */
  onOpen(handler: () => void): () => void {
    this.openListeners.add(handler);
    return () => this.openListeners.delete(handler);
  }

  async connect(): Promise<void> {
    if (this.socket || this.policy.status === 'connecting') return;
    const gen = ++this.generation;
    this.policy.status = 'connecting';

    let url = this.config.url;
    const tokenParam = this.config.tokenParam ?? 'token';
    if (tokenParam && this.getToken) {
      const token = await this.getToken();
      if (token) url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(tokenParam)}=${encodeURIComponent(token)}`;
    }
    if (gen !== this.generation) return;

    let socket: WebSocket;
    try {
      socket = this.config.socketFactory ? this.config.socketFactory(url, this.config.protocols) : new WebSocket(url, this.config.protocols);
    } catch (err) {
      console.error('WebSocket connection error:', err);
      this.policy.status = 'idle';
      this.policy.schedule(() => void this.connect());
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.policy.succeeded();
      this.startPing();
      for (const channel of this.channels.keys()) if (channel !== '*') this.rawSend({ type: 'subscribe', channel });
      this.flush();
      for (const fn of [...this.openListeners]) fn();
    };
    socket.onclose = (event: CloseEvent) => {
      // Ignore late events from a socket we already replaced.
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPing();
      this.policy.status = 'idle';
      if (event.code !== 1000) this.policy.schedule(() => void this.connect());
      else this.policy.status = 'closed';
    };
    socket.onerror = () => {
      /* onclose follows and handles reconnection */
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket) return;
      let message: WebSocketMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        console.error('WebSocket: ignoring non-JSON message');
        return;
      }
      if (!message || typeof message.type !== 'string' || SYSTEM_TYPES.has(message.type)) return;
      this.dispatch(message);
    };
  }

  private dispatch(message: WebSocketMessage): void {
    const targets = [message.channel ? this.channels.get(message.channel) : undefined, this.channels.get('*')];
    for (const set of targets) {
      if (!set) continue;
      for (const cb of [...set]) {
        try {
          cb(message);
        } catch (err) {
          console.error('WebSocket subscriber error:', err);
        }
      }
    }
  }

  /** Subscribe to a channel. The first subscriber sends `subscribe`; the last unsubscribe sends `unsubscribe`. */
  subscribe<M extends WebSocketMessage = WebSocketMessage>(channel: string, callback: ChannelCallback<M>): () => void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
      if (channel !== '*' && this.isConnected) this.rawSend({ type: 'subscribe', channel });
    }
    set.add(callback as ChannelCallback);
    return () => {
      const s = this.channels.get(channel);
      if (!s?.delete(callback as ChannelCallback) || s.size > 0) return;
      this.channels.delete(channel);
      if (channel !== '*' && this.isConnected) this.rawSend({ type: 'unsubscribe', channel });
    };
  }

  /** Send a message, or queue it until connected. */
  send(message: WebSocketMessage): void {
    if (this.isConnected) {
      this.rawSend(message);
      return;
    }
    this.queue.push(message);
    const max = this.config.maxQueue ?? 1000;
    if (this.queue.length > max) this.queue.splice(0, this.queue.length - max);
  }

  /** Broadcast presence data on a channel. */
  sendPresence(channel: string, payload: Record<string, unknown>): void {
    this.send({ type: 'presence', channel, payload });
  }

  private rawSend(message: WebSocketMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  private flush(): void {
    const queued = this.queue.splice(0);
    for (const m of queued) this.rawSend(m);
  }

  private startPing(): void {
    this.stopPing();
    if (!this.config.pingInterval) return;
    this.pingTimer = setInterval(() => {
      if (this.isConnected) this.rawSend({ type: 'ping' });
    }, this.config.pingInterval);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** Close the connection and stop reconnecting. */
  disconnect(): void {
    this.generation++;
    this.policy.cancel();
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try {
        socket.close(1000, 'Client disconnect');
      } catch {
        /* ignore */
      }
    }
    this.policy.status = 'closed';
  }
}
