import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketManager } from '../websocket-manager';
import { CollabManager, CollabSession } from '../collab/collab-session';
import { CollabServer } from '../ot/server';
import { TextareaAdapter } from '../collab/textarea-adapter';
import { caretCoordinates, CursorOverlay } from '../collab/cursor-overlay';
import { TextOperation } from '../ot/text-operation';
import type { CollabMessage } from '../types';
import { flush } from '../../../test/helpers';

/** An in-memory WebSocket pair wired to a CollabServer. */
class Hub {
  sockets = new Map<string, LoopbackSocket>();
  server = new CollabServer((clientId, message) => {
    const s = this.sockets.get(clientId);
    if (s && s.readyState === 1 && !s.paused) s.deliver(message);
    else s?.missed.push(message);
  }, docId => (docId === 'doc1' ? 'Hello' : ''));
  counter = 0;
  factory = () => {
    const id = `client-${++this.counter}`;
    const socket = new LoopbackSocket(id, this);
    this.sockets.set(id, socket);
    return socket as unknown as WebSocket;
  };
}

class LoopbackSocket {
  readyState = 0;
  paused = false;
  missed: CollabMessage[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public id: string, private hub: Hub) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(raw: string): void {
    const msg = JSON.parse(raw);
    if (msg.type?.startsWith('collab:')) queueMicrotask(() => this.hub.server.handle(this.id, msg));
  }
  deliver(message: CollabMessage): void {
    queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) })));
  }
  close(code = 1000): void {
    this.readyState = 3;
    this.hub.server.disconnect(this.id);
    this.onclose?.({ code } as CloseEvent);
  }
}

function makeTextarea(): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  document.body.appendChild(ta);
  return ta;
}

function type(ta: HTMLTextAreaElement, value: string): void {
  ta.value = value;
  ta.dispatchEvent(new Event('input'));
}

describe('CollabSession', () => {
  let hub: Hub;
  beforeEach(() => {
    hub = new Hub();
  });

  const session = (ta: HTMLTextAreaElement, name: string) => {
    const ws = new WebSocketManager({ url: 'ws://x', socketFactory: hub.factory, pingInterval: 0, baseDelay: 5, jitter: 0 });
    return { ws, s: new CollabSession(ws, 'doc1', ta, { user: { name, color: '#f00' } }) };
  };

  it('syncs initial content and converges concurrent edits', async () => {
    const ta1 = makeTextarea();
    const ta2 = makeTextarea();
    const a = session(ta1, 'Alice');
    session(ta2, 'Bo');
    const ready = vi.fn();
    a.s.on('ready', ready);
    await flush(5);
    expect(ta1.value).toBe('Hello');
    expect(ta2.value).toBe('Hello');
    expect(a.s.status).toBe('synced');

    type(ta1, 'Hello world');
    type(ta2, 'Oh Hello');
    type(ta1, 'Hello world!');
    await flush(10);
    expect(ta1.value).toBe(ta2.value);
    expect(ta1.value).toContain('world!');
    expect(ta1.value).toContain('Oh ');
    expect(hub.server.document('doc1').document).toBe(ta1.value);
    expect(a.s.revision).toBe(3);
    expect(a.s.content).toBe(ta1.value);
  });

  it('shares presence and removes peers who leave', async () => {
    const ta1 = makeTextarea();
    const ta2 = makeTextarea();
    const a = session(ta1, 'Alice');
    const b = session(ta2, 'Bo');
    await flush(5);
    const presence = vi.fn();
    a.s.on('presence', presence);
    ta2.setSelectionRange(2, 2);
    ta2.dispatchEvent(new Event('keyup'));
    await new Promise(r => setTimeout(r, 80));
    await flush(5);
    expect(a.s.peers).toHaveLength(1);
    expect(a.s.peers[0]).toMatchObject({ user: { name: 'Bo' }, selection: { anchor: 2, head: 2 } });
    // A remote insert before the cursor moves it.
    type(ta1, 'XXHello');
    await flush(10);
    expect(a.s.peers[0].selection).toEqual({ anchor: 4, head: 4 });
    b.s.close();
    await flush(5);
    expect(a.s.peers).toHaveLength(0);
    expect(presence).toHaveBeenCalled();
  });

  it('keeps unacknowledged edits across a reconnect', async () => {
    const ta1 = makeTextarea();
    const ta2 = makeTextarea();
    const a = session(ta1, 'Alice');
    session(ta2, 'Bo');
    await flush(5);
    const socket = hub.sockets.get('client-1')!;
    socket.paused = true; // server replies are lost
    type(ta1, 'Hello there');
    await flush(5);
    socket.close(1006); // drop
    await new Promise(r => setTimeout(r, 30));
    await flush(10);
    expect(hub.server.document('doc1').document).toBe('Hello there');
    expect(ta1.value).toBe('Hello there');
    expect(ta2.value).toBe('Hello there');
    expect(a.s.status).toBe('synced');
  });

  it('reports server errors and requires a websocket through the manager', async () => {
    const ta = makeTextarea();
    const a = session(ta, 'Alice');
    await flush(5);
    const errors = vi.fn();
    a.s.on('error', errors);
    hub.server.handle('client-1', { type: 'collab:op', channel: 'doc:doc1', payload: { revision: 0, op: [99] } });
    await flush(5);
    expect(errors).toHaveBeenCalled();
    expect(() => new CollabManager(() => null).open('x', ta)).toThrow(/WebSocket/);
    const mgr = new CollabManager(() => a.ws);
    const s2 = mgr.open('doc2', makeTextarea());
    expect(s2).toBeInstanceOf(CollabSession);
    s2.close();
  });
});

/**
 * A simulated network with a virtual clock: every message is delayed by a
 * random amount, but messages in one direction of one connection stay in
 * order (as over TCP). Events run in time order; `run()` drains them.
 */
class SlowNet {
  now = 0;
  private seq = 0;
  private events: Array<{ at: number; seq: number; fn: () => void }> = [];
  private last = new Map<string, number>();
  constructor(private random: () => number, private maxDelay: number) {}
  send(lane: string, fn: () => void): void {
    const at = Math.max(this.now + 1 + this.random() * this.maxDelay, this.last.get(lane) ?? 0);
    this.last.set(lane, at);
    this.events.push({ at, seq: this.seq++, fn });
  }
  at(time: number, fn: () => void): void {
    this.events.push({ at: time, seq: this.seq++, fn });
  }
  async run(): Promise<void> {
    while (this.events.length) {
      this.events.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.events.shift()!;
      this.now = next.at;
      next.fn();
      await flush(2);
    }
  }
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('CollabSession before the document loads', () => {
  it('keeps the textarea read-only until synced, so early typing is not lost, then restores it', async () => {
    const hub = new Hub();
    const ta = makeTextarea();
    const ws = new WebSocketManager({ url: 'ws://x', socketFactory: hub.factory, pingInterval: 0, baseDelay: 5, jitter: 0 });
    const s = new CollabSession(ws, 'doc1', ta, { user: { name: 'A', color: '#f00' } });
    expect(ta.readOnly).toBe(true);
    expect(ta.getAttribute('aria-busy')).toBe('true');
    await flush(10);
    expect(ta.value).toBe('Hello');
    expect(ta.readOnly).toBe(false);
    expect(ta.hasAttribute('aria-busy')).toBe(false);
    s.close();
    // A textarea that was read-only to begin with stays read-only, also when closed before loading.
    const locked = makeTextarea();
    locked.readOnly = true;
    const ws2 = new WebSocketManager({ url: 'ws://x', socketFactory: hub.factory, pingInterval: 0, baseDelay: 5, jitter: 0 });
    const early = new CollabSession(ws2, 'doc1', locked, { user: { name: 'B', color: '#00f' } });
    early.close();
    expect(locked.readOnly).toBe(true);
    const plain = makeTextarea();
    const ws3 = new WebSocketManager({ url: 'ws://x', socketFactory: hub.factory, pingInterval: 0, baseDelay: 5, jitter: 0 });
    const closedEarly = new CollabSession(ws3, 'doc1', plain, { user: { name: 'C', color: '#0f0' } });
    closedEarly.close();
    expect(plain.readOnly).toBe(false);
    expect(plain.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('CollabSession over a slow network', () => {
  it.each(Array.from({ length: 25 }, (_, i) => i + 1))('converges with random delays and concurrent edits (seed %i)', async seed => {
    const random = seeded(seed);
    const net = new SlowNet(random, 40);
    const errors: unknown[] = [];
    const sockets = new Map<string, { onmessage: ((e: MessageEvent) => void) | null; readyState: number }>();
    const server = new CollabServer((clientId, message) => {
      const socket = sockets.get(clientId);
      net.send(`down:${clientId}`, () => socket?.readyState === 1 && socket.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) })));
    }, () => 'The quick brown fox');
    let counter = 0;
    const factory = () => {
      const id = `c${++counter}`;
      const socket = {
        readyState: 0,
        onopen: null as (() => void) | null,
        onclose: null as ((e: CloseEvent) => void) | null,
        onerror: null as (() => void) | null,
        onmessage: null as ((e: MessageEvent) => void) | null,
        send(raw: string) {
          const msg = JSON.parse(raw);
          if (msg.type?.startsWith('collab:')) net.send(`up:${id}`, () => server.handle(id, msg));
        },
        close() {
          socket.readyState = 3;
        },
      };
      sockets.set(id, socket);
      net.send(`open:${id}`, () => {
        socket.readyState = 1;
        socket.onopen?.();
      });
      return socket as unknown as WebSocket;
    };
    const editors = [makeTextarea(), makeTextarea()];
    const sessions = editors.map((ta, i) => {
      const ws = new WebSocketManager({ url: 'ws://x', socketFactory: factory, pingInterval: 0, reconnect: false });
      const s = new CollabSession(ws, 'doc', ta, { user: { name: `u${i}`, color: '#000' }, cursors: false });
      s.on('error', e => errors.push(e));
      return s;
    });
    // Random inserts and deletes from both editors, interleaved with message delivery.
    for (let step = 0; step < 30; step++) {
      const ta = editors[Math.floor(random() * 2)];
      net.at(5 + step * 7 * random(), () => {
        const v = ta.value;
        const pos = Math.floor(random() * (v.length + 1));
        if (random() < 0.7 || v.length === 0) type(ta, v.slice(0, pos) + String.fromCharCode(97 + Math.floor(random() * 26)) + v.slice(pos));
        else type(ta, v.slice(0, pos) + v.slice(pos + 1));
      });
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await net.run();
    consoleError.mockRestore();
    expect(consoleError).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    const serverText = server.document('doc').document;
    expect(editors[0].value).toBe(serverText);
    expect(editors[1].value).toBe(serverText);
    expect(sessions.map(s => s.status)).toEqual(['synced', 'synced']);
    sessions.forEach(s => s.close());
    editors.forEach(ta => ta.remove());
  });
});

describe('TextareaAdapter', () => {
  it('emits operations, waits for IME composition, and keeps the selection', () => {
    const ta = makeTextarea();
    const adapter = new TextareaAdapter(ta);
    adapter.setValue('abc');
    const ops: TextOperation[] = [];
    const selections: unknown[] = [];
    adapter.attach(op => ops.push(op), sel => selections.push(sel));
    ta.dispatchEvent(new Event('compositionstart'));
    type(ta, 'abcあ');
    expect(ops).toHaveLength(0);
    ta.dispatchEvent(new Event('compositionend'));
    expect(ops).toHaveLength(1);
    type(ta, 'abcあ'); // unchanged
    expect(ops).toHaveLength(1);
    ta.focus();
    ta.setSelectionRange(4, 4);
    adapter.applyOperation(new TextOperation().insert('>> ').retain(4));
    expect(ta.value).toBe('>> abcあ');
    expect(ta.selectionStart).toBe(7);
    ta.dispatchEvent(new Event('keyup'));
    expect(selections.at(-1)).toEqual({ anchor: 7, head: 7 });
    expect(adapter.getValue()).toBe('>> abcあ');
    adapter.destroy();
  });
});

describe('CursorOverlay', () => {
  it('renders remote carets', async () => {
    const ta = makeTextarea();
    ta.value = 'hello\nworld';
    expect(caretCoordinates(ta, 3)).toEqual(expect.objectContaining({ height: expect.any(Number) }));
    const overlay = new CursorOverlay(ta);
    overlay.update([{ clientId: 'x', user: { name: 'Alice', color: 'red' }, selection: { anchor: 2, head: 2 } }, { clientId: 'y' }]);
    await new Promise(r => setTimeout(r, 30));
    expect(document.querySelectorAll('.collab-cursor')).toHaveLength(1);
    expect(document.querySelector('.collab-cursor__label')?.textContent).toBe('Alice');
    overlay.destroy();
    expect(document.querySelector('.collab-cursors')).toBeNull();
  });
});
