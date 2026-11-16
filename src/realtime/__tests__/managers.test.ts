import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SSEManager } from '../sse-manager';
import { WebSocketManager } from '../websocket-manager';
import { AzurePubSubManager } from '../azure-pubsub-manager';
import { ReconnectPolicy } from '../reconnect';
import { ObjectStore } from '../../data/object-store';
import { ListViewRegistry } from '../../data/list-view-registry';
import { FakeEventSource, FakeWebSocket, flush, mockFetch } from '../../../test/helpers';

beforeEach(() => {
  FakeEventSource.instances = [];
  FakeWebSocket.instances = [];
});
afterEach(() => vi.useRealTimers());

const sseFactory = (url: string, init: EventSourceInit) => new FakeEventSource(url, init) as unknown as EventSource;
const wsFactory = (url: string, protocols?: string | string[]) => new FakeWebSocket(url, protocols) as unknown as WebSocket;

describe('ReconnectPolicy', () => {
  it('backs off, gives up and reports status', () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const p = new ReconnectPolicy({ baseDelay: 10, jitter: 0, maxReconnectAttempts: 2 });
    p.on('status', s => statuses.push(s));
    const connect = vi.fn();
    expect(p.schedule(connect)).toBe(true);
    expect(p.schedule(connect)).toBe(true); // already scheduled
    vi.advanceTimersByTime(10);
    expect(connect).toHaveBeenCalledTimes(1);
    p.schedule(connect);
    vi.advanceTimersByTime(20);
    expect(p.attempt).toBe(2);
    expect(p.schedule(connect)).toBe(false);
    expect(statuses).toEqual(['reconnecting', 'closed']);
    p.succeeded();
    expect(p.status).toBe('open');
    expect(new ReconnectPolicy({ reconnect: false }).schedule(connect)).toBe(false);
  });
});

describe('SSEManager', () => {
  function setup() {
    const store = new ObjectStore();
    const views = new ListViewRegistry();
    const sse = new SSEManager({ url: '/events', eventSourceFactory: sseFactory, baseDelay: 10, jitter: 0 });
    sse.connectStore(store, views);
    return { store, views, sse };
  }

  it('connects with a token and applies built-in events', async () => {
    const { store, views, sse } = setup();
    sse.setTokenProvider(async () => 'tok en');
    await sse.connect();
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe('/events?token=tok%20en');
    es.open();
    expect(sse.isConnected).toBe(true);

    store.upsert('Person', '1', { name: 'a' });
    store.upsert('Person', '2', { name: 'b' });
    const view = views.getOrCreate({ id: 'v', type: 'Person' });
    views.populate('v', ['1', '2']);

    es.emit('invalidate', { type: 'Person', id: 1 });
    expect(store.get('Person', '1')?.status).toBe('stale');
    expect(store.get('Person', '2')?.status).toBe('fresh');
    es.emit('invalidate', { type: 'Person', ids: [2] });
    expect(store.get('Person', '2')?.status).toBe('stale');
    expect(view.status).toBe('stale');
    es.emit('upsert', { type: 'Person', data: { id: 3, name: 'c' } });
    expect(store.getData('Person', '3')).toEqual({ id: 3, name: 'c' });
    es.emit('delete', { type: 'Person', id: 1 });
    expect(store.has('Person', '1')).toBe(false);
    expect(view.ids).toEqual(['2']);
    es.emit('invalidate', { type: 'Person' });
    es.emit('delete', { type: 'Person' }); // no id: ignored
    es.emit('invalidate', 'not json');
  });

  it('reads the action from generic messages (type stays the object type)', async () => {
    const { store, sse } = setup();
    await sse.connect();
    const es = FakeEventSource.instances[0];
    store.upsert('Task', '9', {});
    const seen = vi.fn();
    sse.on('message', seen);
    es.emit('message', { action: 'invalidate', type: 'Task', id: '9' });
    expect(store.get('Task', '9')?.status).toBe('stale');
    expect(seen).toHaveBeenCalled();
    es.emit('message', { event: 'delete', type: 'Task', id: '9' });
    expect(store.has('Task', '9')).toBe(false);
  });

  it('supports custom events and tracks the last event id', async () => {
    const { sse } = setup();
    const handler = vi.fn();
    sse.on('notification', handler);
    await sse.connect();
    const es = FakeEventSource.instances[0];
    es.emit('notification', { text: 'hi' }, 'evt-7');
    expect(handler).toHaveBeenCalledWith({ text: 'hi' }, expect.anything());
    const late = vi.fn();
    sse.on('late', late);
    es.emit('late', 'plain');
    expect(late).toHaveBeenCalledWith('plain', expect.anything());
    es.fail();
    await new Promise(r => setTimeout(r, 30));
    expect(FakeEventSource.instances[1].url).toBe('/events?lastEventId=evt-7');
    sse.disconnect();
  });

  it('reconnects itself with a fresh token and stops on disconnect', async () => {
    vi.useFakeTimers();
    const { sse } = setup();
    let n = 0;
    sse.setTokenProvider(() => `t${++n}`);
    const statuses: string[] = [];
    sse.onStatusChange(s => statuses.push(s));
    await sse.connect();
    await sse.connect(); // idempotent
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].fail();
    expect(FakeEventSource.instances[0].readyState).toBe(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(FakeEventSource.instances[1].url).toBe('/events?token=t2');
    FakeEventSource.instances[0].fail(); // stale source: ignored
    sse.disconnect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(sse.status).toBe('closed');
    expect(statuses).toContain('reconnecting');
  });

  it('does not open a stream if disconnected while fetching the token', async () => {
    const { sse } = setup();
    let release!: (t: string) => void;
    sse.setTokenProvider(() => new Promise<string>(r => (release = r)));
    const p = sse.connect();
    sse.disconnect();
    release('x');
    await p;
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('handles factory errors', async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const sse = new SSEManager({
      url: '/e', baseDelay: 5, jitter: 0,
      eventSourceFactory: (u, i) => {
        if (fail) {
          fail = false;
          throw new Error('nope');
        }
        return sseFactory(u, i);
      },
    });
    await sse.connect();
    expect(err).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

describe('WebSocketManager', () => {
  it('subscribes, queues while offline and resubscribes after reconnects', async () => {
    vi.useFakeTimers();
    const ws = new WebSocketManager({ url: 'wss://x/ws', socketFactory: wsFactory, baseDelay: 10, jitter: 0, pingInterval: 100 });
    ws.setTokenProvider(() => 'abc');
    const onOpen = vi.fn();
    ws.onOpen(onOpen);
    const got = vi.fn();
    const all = vi.fn();
    const off = ws.subscribe('room', got);
    ws.subscribe('*', all);
    ws.send({ type: 'hello' });
    await ws.connect();
    const s1 = FakeWebSocket.instances[0];
    expect(s1.url).toBe('wss://x/ws?token=abc');
    s1.open();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(s1.sent).toEqual([{ type: 'subscribe', channel: 'room' }, { type: 'hello' }]);
    s1.receive({ type: 'chat', channel: 'room', payload: 1 });
    s1.receive({ type: 'pong' });
    s1.receive({ type: 'other', channel: 'elsewhere' });
    expect(got).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100);
    expect(s1.sent).toContainEqual({ type: 'ping' });

    s1.drop();
    expect(ws.isConnected).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    const s2 = FakeWebSocket.instances[1];
    s2.open();
    expect(s2.sent).toContainEqual({ type: 'subscribe', channel: 'room' });
    s1.close(); // late close from the old socket must not affect s2
    expect(ws.isConnected).toBe(true);
    off();
    expect(s2.sent).toContainEqual({ type: 'unsubscribe', channel: 'room' });
    ws.disconnect();
    expect(ws.status).toBe('closed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('caps the offline queue and ignores bad messages', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ws = new WebSocketManager({ url: 'ws://x', socketFactory: wsFactory, maxQueue: 2, pingInterval: 0 });
    ws.send({ type: 'a' });
    ws.send({ type: 'b' });
    ws.send({ type: 'c' });
    ws.sendPresence('room', { x: 1 });
    await ws.connect();
    const s = FakeWebSocket.instances[0];
    s.open();
    expect(s.sent).toEqual([{ type: 'c' }, { type: 'presence', channel: 'room', payload: { x: 1 } }]);
    s.onmessage?.(new MessageEvent('message', { data: 'not json' }));
    expect(err).toHaveBeenCalled();
    ws.subscribe('x', () => {
      throw new Error('boom');
    });
    s.receive({ type: 'y', channel: 'x' });
    s.close(1000);
    expect(ws.status).toBe('closed');
  });
});

describe('AzurePubSubManager', () => {
  function setup(extra: Record<string, unknown> = {}) {
    const fetch = mockFetch(() => ({ body: { url: 'wss://azure/client' } }));
    const store = new ObjectStore();
    const views = new ListViewRegistry();
    const az = new AzurePubSubManager({ negotiateUrl: '/negotiate', fetch, socketFactory: wsFactory as never, baseDelay: 10, jitter: 0, ackTimeout: 50, ...extra });
    az.connectStore(store, views);
    return { az, store, views, fetch };
  }

  const connected = (s: FakeWebSocket) => {
    s.open();
    s.receive({ type: 'system', event: 'connected', connectionId: 'c1', userId: 'u1' });
  };
  const ackAll = (s: FakeWebSocket) => {
    for (const m of s.sent as Array<{ ackId?: number }>) if (m.ackId) s.receive({ type: 'ack', ackId: m.ackId, success: true });
  };

  it('negotiates, joins groups once and dispatches messages', async () => {
    const { az, fetch } = setup({ autoJoinGroups: ['news'] });
    az.setTokenProvider(() => 'tok');
    const got = vi.fn();
    az.subscribe('news', got);
    await az.connect();
    expect(fetch.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer tok' });
    const s = FakeWebSocket.instances[0];
    expect(s.protocols).toBe('json.webpubsub.azure.v1');
    connected(s);
    expect(az.getConnectionId()).toBe('c1');
    expect(az.getUserId()).toBe('u1');
    const joins = (s.sent as Array<{ type: string; group: string }>).filter(m => m.type === 'joinGroup');
    expect(joins.map(j => j.group)).toEqual(['news']);
    ackAll(s);
    await flush();
    s.receive({ type: 'message', from: 'group', group: 'news', data: { hi: 1 }, dataType: 'json' });
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ group: 'news', from: 'group', payload: { hi: 1 } }));
    const sendP = az.sendToGroup('news', { x: 1 });
    ackAll(s);
    await sendP;
    const evP = az.sendEvent('custom', {});
    s.receive({ type: 'ack', ackId: (s.sent.at(-1) as { ackId: number }).ackId, success: false, error: { name: 'Err', message: 'denied' } });
    await expect(evP).rejects.toThrow('denied');
  });

  it('only honors cache messages from the server', async () => {
    const { az, store } = setup({ enableCacheInvalidation: true });
    await az.connect();
    const s = FakeWebSocket.instances[0];
    connected(s);
    store.upsert('Doc', '1', {});
    // A peer in a group tries to delete our cached object: ignored.
    s.receive({ type: 'message', from: 'group', group: 'g', data: { action: 'delete', type: 'Doc', id: '1' } });
    expect(store.has('Doc', '1')).toBe(true);
    s.receive({ type: 'message', from: 'server', data: { action: 'invalidate', type: 'Doc', id: '1' } });
    expect(store.get('Doc', '1')?.status).toBe('stale');
    s.receive({ type: 'message', from: 'server', data: { action: 'upsert', type: 'Doc', data: { id: '2', t: 1 } } });
    expect(store.getData('Doc', '2')).toEqual({ id: '2', t: 1 });
    s.receive({ type: 'message', from: 'server', data: { action: 'invalidate', type: 'Doc' } });
    s.receive({ type: 'message', from: 'server', data: { action: 'delete', type: 'Doc', id: '1' } });
    expect(store.has('Doc', '1')).toBe(false);
  });

  it('times out acks, rejects on close and rejoins after reconnect', async () => {
    vi.useFakeTimers();
    const { az } = setup();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    az.subscribe('g', () => {});
    await az.connect();
    const s1 = FakeWebSocket.instances[0];
    connected(s1);
    const sendP = az.sendToGroup('g', 1).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(60);
    expect(((await sendP) as Error).message).toBe('Ack timeout');
    const pending = az.sendToGroup('g', 2);
    s1.drop();
    await expect(pending).rejects.toThrow('Connection closed');
    await vi.advanceTimersByTimeAsync(10);
    const s2 = FakeWebSocket.instances[1];
    connected(s2);
    expect((s2.sent as Array<{ type: string }>).filter(m => m.type === 'joinGroup')).toHaveLength(1);
    s1.close(); // stale socket
    expect(az.isConnected).toBe(true);
    err.mockRestore();
  });

  it('does not open a socket if disconnected during negotiate', async () => {
    let release!: () => void;
    const fetch = vi.fn(() => new Promise<Response>(r => (release = () => r(new Response(JSON.stringify({ url: 'wss://a' }))))));
    const az = new AzurePubSubManager({ negotiateUrl: '/n', fetch: fetch as unknown as typeof globalThis.fetch, socketFactory: wsFactory as never });
    const p = az.connect();
    az.disconnect();
    release();
    await p;
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('builds the URL from a token, queues offline sends and handles failures', async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const fetch = mockFetch(() => (fail ? { status: 500 } : { body: { token: 'abc' } }));
    const az = new AzurePubSubManager({ negotiateUrl: '/n', endpoint: 'wss://hub/client?hub=h', fetch, socketFactory: wsFactory as never, baseDelay: 10, jitter: 0 });
    await az.sendToGroup('g', 'queued');
    await az.connect();
    expect(err).toHaveBeenCalled();
    fail = false;
    await vi.advanceTimersByTimeAsync(10);
    const s = FakeWebSocket.instances[0];
    expect(s.url).toBe('wss://hub/client?hub=h&access_token=abc');
    connected(s);
    expect((s.sent as Array<{ type: string }>).some(m => m.type === 'sendToGroup')).toBe(true);
    await az.leaveGroup('never-joined');
    az.disconnect();
    expect(az.status).toBe('closed');
    const bad = new AzurePubSubManager({ negotiateUrl: '/n', fetch: mockFetch(() => ({ body: {} })), socketFactory: wsFactory as never, reconnect: false });
    await bad.connect();
    expect(bad.status).toBe('closed');
  });
});
