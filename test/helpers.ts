/** Shared test helpers. */
import { vi } from 'vitest';

/** Seeded PRNG (mulberry32) for reproducible property tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MockRoute {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Throw a TypeError like a network failure. */
  networkError?: boolean;
  delay?: number;
}

export type RouteHandler = (url: URL, init: RequestInit) => MockRoute | Promise<MockRoute>;

/** A fetch mock with a call log. */
export function mockFetch(handler: RouteHandler) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost/');
    calls.push({ url: url.toString(), init });
    const route = await handler(url, init);
    if (route.delay) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, route.delay);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (route.networkError) throw new TypeError('Failed to fetch');
    const body = route.body === undefined ? '' : typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    return new Response(route.status === 204 ? null : body, {
      status: route.status ?? 200,
      headers: { 'Content-Type': typeof route.body === 'string' ? 'text/plain' : 'application/json', ...route.headers },
    });
  });
  return Object.assign(fn as unknown as typeof fetch, { calls, spy: fn });
}

/** Wait for queued microtasks and timers of 0ms. */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise(r => setTimeout(r, 0));
}

/** Make a JWT with the given claims (unsigned; for parsing tests only). */
export function makeJwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(claims)}.sig`;
}

/** Controllable fake EventSource. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  constructor(public url: string, public init?: EventSourceInit) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  emit(type: string, data: unknown, lastEventId = ''): void {
    const e = new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId });
    if (type === 'message') this.onmessage?.(e);
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  fail(): void {
    this.readyState = 2;
    this.onerror?.(new Event('error'));
  }
  close(): void {
    this.readyState = 2;
  }
}

/** Controllable fake WebSocket. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public url: string, public protocols?: string | string[]) {
    FakeWebSocket.instances.push(this);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  receive(message: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' } as CloseEvent);
  }
  drop(code = 1006): void {
    this.close(code);
  }
}
