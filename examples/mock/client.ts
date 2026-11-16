/**
 * Browser-side shims that talk to the mock server: a `fetch`, an
 * `EventSource` and a `WebSocket`. Pass them to `Arethesis.init()`:
 *
 * ```ts
 * const backend = connectMockBackend();
 * await app.init({
 *   http: { baseUrl: '/api', fetch: backend.fetch },
 *   sse: { url: '/api/events', eventSourceFactory: backend.eventSource },
 *   websocket: { url: 'wss://mock/ws', socketFactory: backend.webSocket },
 * });
 * ```
 */
import { createHost } from './host';
import type { Port, ToPage, ToServer } from './protocol';

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${++counter}`;

function connectPort(): { port: Port; shared: boolean } {
  const handlers: Array<(m: ToPage) => void> = [];
  if (typeof SharedWorker !== 'undefined') {
    try {
      const worker = new SharedWorker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'arethesis-mock-server' });
      worker.port.onmessage = e => handlers.forEach(h => h(e.data));
      worker.port.start();
      addEventListener('pagehide', () => worker.port.postMessage({ kind: 'bye' } satisfies ToServer));
      return {
        shared: true,
        port: { post: m => worker.port.postMessage(m), listen: h => handlers.push(h as (m: ToPage) => void) },
      };
    } catch {
      /* fall through */
    }
  }
  // In-page fallback: the server lives in this tab only.
  const host = createHost();
  let serverHandler: ((m: ToServer | ToPage) => void) | null = null;
  host.connect({
    post: m => queueMicrotask(() => handlers.forEach(h => h(m as ToPage))),
    listen: h => (serverHandler = h),
  });
  return {
    shared: false,
    port: { post: m => queueMicrotask(() => serverHandler?.(m)), listen: h => handlers.push(h as (m: ToPage) => void) },
  };
}

export interface MockBackend {
  /** True when the server is shared across tabs (SharedWorker). */
  shared: boolean;
  fetch: typeof fetch;
  eventSource: (url: string, init?: EventSourceInit) => EventSource;
  webSocket: (url: string, protocols?: string | string[]) => WebSocket;
  control(command: { latency?: number; failureRate?: number; offline?: boolean; teammates?: boolean }): void;
}

let singleton: MockBackend | null = null;

export function connectMockBackend(): MockBackend {
  if (singleton) return singleton;
  const { port, shared } = connectPort();
  const pending = new Map<number, (m: Extract<ToPage, { kind: 'response' }>) => void>();
  const streams = new Map<string, MockEventSource>();
  const sockets = new Map<string, MockWebSocket>();
  let requestId = 0;

  port.listen(raw => {
    const m = raw as ToPage;
    switch (m.kind) {
      case 'response':
        pending.get(m.id)?.(m);
        pending.delete(m.id);
        break;
      case 'sse-open':
        streams.get(m.streamId)?._open();
        break;
      case 'sse':
        streams.get(m.streamId)?._event(m.event, m.data, m.id);
        break;
      case 'sse-error':
        streams.get(m.streamId)?._error();
        break;
      case 'ws-open':
        sockets.get(m.socketId)?._open();
        break;
      case 'ws-message':
        sockets.get(m.socketId)?._message(m.data);
        break;
      case 'ws-close':
        sockets.get(m.socketId)?._close(m.code);
        break;
    }
  });

  const mockFetch: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const id = ++requestId;
    const response = await new Promise<Extract<ToPage, { kind: 'response' }>>((resolve, reject) => {
      pending.set(id, resolve);
      init.signal?.addEventListener('abort', () => {
        pending.delete(id);
        reject(new DOMException('Aborted', 'AbortError'));
      });
      port.post({ kind: 'fetch', id, request: { method: init.method ?? 'GET', url, headers, body: typeof init.body === 'string' ? init.body : undefined } });
    });
    if (response.status === 0) throw new TypeError('Failed to fetch (the demo network is offline)');
    const body = response.body === undefined || response.status === 204 ? null : JSON.stringify(response.body);
    return new Response(body, { status: response.status, headers: { 'Content-Type': 'application/json', ...response.headers } });
  };

  class MockEventSource extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readyState = 0;
    readonly withCredentials = false;
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    private readonly id = nextId('sse');
    constructor(readonly url: string) {
      super();
      streams.set(this.id, this);
      port.post({ kind: 'sse-open', streamId: this.id });
    }
    _open(): void {
      this.readyState = 1;
      const e = new Event('open');
      this.onopen?.(e);
      this.dispatchEvent(e);
    }
    _event(event: string, data: string, lastEventId: string): void {
      if (this.readyState !== 1) return;
      const e = new MessageEvent(event, { data, lastEventId });
      if (event === 'message') this.onmessage?.(e);
      this.dispatchEvent(e);
    }
    _error(): void {
      this.readyState = 2;
      streams.delete(this.id);
      const e = new Event('error');
      this.onerror?.(e);
      this.dispatchEvent(e);
    }
    close(): void {
      this.readyState = 2;
      streams.delete(this.id);
      port.post({ kind: 'sse-close', streamId: this.id });
    }
  }

  class MockWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onclose: ((e: CloseEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    private readonly id = nextId('ws');
    constructor(readonly url: string) {
      super();
      sockets.set(this.id, this);
      port.post({ kind: 'ws-open', socketId: this.id });
    }
    _open(): void {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }
    _message(data: string): void {
      if (this.readyState === 1) this.onmessage?.(new MessageEvent('message', { data }));
    }
    _close(code: number): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      sockets.delete(this.id);
      this.onclose?.(new CloseEvent('close', { code, reason: '' }));
    }
    send(data: string): void {
      if (this.readyState !== 1) throw new Error('WebSocket is not open');
      port.post({ kind: 'ws-send', socketId: this.id, data });
    }
    close(code = 1000): void {
      if (this.readyState === 3) return;
      port.post({ kind: 'ws-close', socketId: this.id });
      this._close(code);
    }
  }

  singleton = {
    shared,
    fetch: mockFetch,
    eventSource: url => new MockEventSource(url) as unknown as EventSource,
    webSocket: url => new MockWebSocket(url) as unknown as WebSocket,
    control: command => port.post({ kind: 'control', command }),
  };
  return singleton;
}
