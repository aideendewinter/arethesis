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
