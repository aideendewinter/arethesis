import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TextOperation } from '../ot/text-operation';
import { caretAfter, UndoManager } from '../collab/undo-manager';
import { mapRange, transformRange } from '../collab/anchors';
import { OTDocumentServer, CollabServer } from '../ot/server';
import { WebSocketManager } from '../websocket-manager';
import { CollabSession } from '../collab/collab-session';
import type { CollabAnnotation, CollabMessage } from '../types';
import { flush } from '../../../test/helpers';

const insertAt = (doc: string, at: number, text: string) => new TextOperation().retain(at).insert(text).retain(doc.length - at);
const deleteAt = (doc: string, at: number, n: number) => new TextOperation().retain(at).delete(n).retain(doc.length - at - n);

/** Seeded random numbers, so failures reproduce. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('UndoManager', () => {
  it('undoes and redoes local edits, grouping fast typing', () => {
    const h = new UndoManager({ groupInterval: 500 });
    let doc = 'Hello';
    const edit = (op: TextOperation, t: number) => {
      h.record(op, doc, t);
      doc = op.apply(doc);
    };
    edit(insertAt(doc, 5, ' '), 0);
    edit(insertAt(doc, 6, 'w'), 100);
    edit(insertAt(doc, 7, 'o'), 200);
    edit(insertAt(doc, 8, 'rld'), 1000); // a pause: a new step
    expect(doc).toBe('Hello world');
    let op = h.undo(doc)!;
    doc = op.apply(doc);
    expect(doc).toBe('Hello wo');
    expect(caretAfter(op)).toBe(8);
    op = h.undo(doc)!;
    doc = op.apply(doc);
    expect(doc).toBe('Hello');
    expect(h.undo(doc)).toBeNull();
    doc = h.redo(doc)!.apply(doc);
    expect(doc).toBe('Hello wo');
    doc = h.redo(doc)!.apply(doc);
    expect(doc).toBe('Hello world');
    expect(h.canRedo).toBe(false);
  });

  it('starts a new step at a new line, a deletion after typing, or after break()', () => {
    const h = new UndoManager();
    let doc = '';
    const edit = (op: TextOperation) => {
      h.record(op, doc, 0);
      doc = op.apply(doc);
    };
    edit(insertAt(doc, 0, 'a'));
    edit(insertAt(doc, 1, 'b'));
    edit(insertAt(doc, 2, '\n'));
    edit(insertAt(doc, 3, 'c'));
    edit(deleteAt(doc, 3, 1));
    h.break();
    edit(insertAt(doc, 3, 'd'));
    const steps: string[] = [];
    let op: TextOperation | null;
    while ((op = h.undo(doc))) steps.push((doc = op.apply(doc)));
    expect(steps).toEqual(['ab\n', 'ab\nc', 'ab\n', 'ab', '']);
  });

  it('a new edit clears redo', () => {
    const h = new UndoManager();
    let doc = 'x';
    h.record(insertAt(doc, 1, 'y'), doc, 0);
    doc = 'xy';
    doc = h.undo(doc)!.apply(doc);
    expect(h.canRedo).toBe(true);
    h.record(insertAt(doc, 1, 'z'), doc, 5000);
    expect(h.canRedo).toBe(false);
  });

  it('reverts only its own edits after remote ones, at the right place', () => {
    const h = new UndoManager();
    let doc = 'The cat';
    const local = insertAt(doc, 7, ' sat');
    h.record(local, doc);
    doc = local.apply(doc);
    // Someone else inserts at the start and deletes "The ".
    for (const remote of [insertAt(doc, 0, 'Look: '), deleteAt('Look: The cat sat', 6, 4)]) {
      doc = remote.apply(doc);
      h.transform(remote);
    }
    expect(doc).toBe('Look: cat sat');
    doc = h.undo(doc)!.apply(doc);
    expect(doc).toBe('Look: cat');
    doc = h.redo(doc)!.apply(doc);
    expect(doc).toBe('Look: cat sat');
  });

  it('drops a step whose text someone else deleted', () => {
    const h = new UndoManager();
    let doc = 'ab';
    h.record(insertAt(doc, 2, 'XYZ'), doc);
    doc = 'abXYZ';
    const remote = deleteAt(doc, 2, 3);
    expect(remote.apply(doc)).toBe('ab');
    h.transform(remote);
    expect(h.canUndo).toBe(false);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('undoing everything removes exactly the local text, whatever the interleaving (seed %i)', seed => {
    const random = rng(seed);
    const h = new UndoManager({ groupInterval: 0 });
    let doc = '0123456789';
    let t = 0;
    for (let step = 0; step < 40; step++) {
      const at = Math.floor(random() * (doc.length + 1));
      if (random() < 0.5) {
        // Local edits insert lowercase letters.
        const op = insertAt(doc, at, String.fromCharCode(97 + Math.floor(random() * 26)).repeat(1 + Math.floor(random() * 3)));
        h.record(op, doc, (t += 1000));
        doc = op.apply(doc);
      } else {
        // Remote edits insert uppercase letters, or delete a character.
        const op = random() < 0.7 || !doc.length
          ? insertAt(doc, at, String.fromCharCode(65 + Math.floor(random() * 26)))
          : deleteAt(doc, Math.min(at, doc.length - 1), 1);
        doc = op.apply(doc);
        h.transform(op);
      }
    }
    const others = doc.replace(/[a-z]/g, '');
    let op: TextOperation | null;
    while ((op = h.undo(doc))) doc = op.apply(doc);
    expect(doc).toBe(others);
  });
});

describe('anchored ranges', () => {
  it('move with edits; typing at either end stays outside', () => {
    const doc = 'say hello there';
    const range = { from: 4, to: 9 }; // "hello"
    expect(transformRange(range, insertAt(doc, 0, '>> '))).toEqual({ from: 7, to: 12 });
    expect(transformRange(range, insertAt(doc, 4, 'oh '))).toEqual({ from: 7, to: 12 });
    expect(transformRange(range, insertAt(doc, 9, '!'))).toEqual({ from: 4, to: 9 });
    expect(transformRange(range, insertAt(doc, 6, 'LL'))).toEqual({ from: 4, to: 11 });
  });

  it('collapse when their text is deleted, and keep other properties', () => {
    const doc = 'say hello there';
    const a = { from: 4, to: 9, id: 'x' };
    expect(transformRange(a, deleteAt(doc, 2, 10))).toEqual({ from: 2, to: 2, id: 'x' });
    expect(mapRange({ from: 3, to: 3 }, i => i + 1)).toEqual({ from: 4, to: 4 });
  });

  it('are rebased by the server from the revision they were made at', () => {
    const server = new OTDocumentServer('hello world');
    server.receive(0, insertAt('hello world', 0, 'Oh, '));
    // A client still at revision 0 comments on "world".
    const a = server.annotate({ action: 'add', annotation: { id: 'c1', from: 6, to: 11, body: 'Which world?' }, revision: 0 });
    expect(a).toMatchObject({ from: 10, to: 15 });
    expect(server.document.slice(a!.from, a!.to)).toBe('world');
    server.receive(1, deleteAt(server.document, 0, 4));
    expect(server.annotations.get('c1')).toMatchObject({ from: 6, to: 11 });
    expect(server.annotate({ action: 'add', annotation: { id: 'c1', from: 0, to: 1, body: 'dup' } })).toBeNull();
    expect(server.annotate({ action: 'add', annotation: { id: '', from: 0, to: 1, body: 'no id' } })).toBeNull();
    expect(server.annotate({ action: 'update', annotation: { id: 'c1', resolved: true } })).toMatchObject({ resolved: true, from: 6, to: 11 });
    expect(server.annotate({ action: 'remove', annotation: { id: 'c1' } })).not.toBeNull();
    expect(server.annotations.size).toBe(0);
  });
});

/** Two sessions over an in-memory socket pair, like collab.test.ts. */
class Hub {
  sockets = new Map<string, { deliver(m: CollabMessage): void }>();
  server = new CollabServer((id, message) => this.sockets.get(id)?.deliver(message), () => 'Hello');
  counter = 0;
  factory = () => {
    const id = `c${++this.counter}`;
    const server = this.server;
    const socket = {
      readyState: 0,
      onopen: null as null | (() => void),
      onmessage: null as null | ((e: MessageEvent) => void),
      onclose: null as null | ((e: CloseEvent) => void),
      onerror: null,
      send(raw: string) {
        const msg = JSON.parse(raw);
        if (msg.type?.startsWith('collab:')) queueMicrotask(() => server.handle(id, msg));
      },
      deliver(message: CollabMessage) {
        queueMicrotask(() => socket.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) })));
      },
      close() {
        socket.readyState = 3;
        server.disconnect(id);
      },
    };
    queueMicrotask(() => {
      socket.readyState = 1;
      socket.onopen?.();
    });
    this.sockets.set(id, socket);
    return socket as unknown as WebSocket;
  };
}

describe('CollabSession undo and annotations', () => {
  let hub: Hub;
  beforeEach(() => {
    hub = new Hub();
  });
  const open = (name: string, undo = true) => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const ws = new WebSocketManager({ url: 'ws://x', socketFactory: hub.factory, pingInterval: 0 });
    return { ta, s: new CollabSession(ws, 'doc', ta, { user: { name }, undo, cursors: false }) };
  };
  const type = (ta: HTMLTextAreaElement, value: string) => {
    ta.value = value;
    ta.dispatchEvent(new Event('input'));
  };

  it("undo reverts only your own edits, in every window, and Ctrl+Z triggers it", async () => {
    const a = open('Alice');
    const b = open('Bo');
    await flush(5);
    type(a.ta, 'Hello, world');
    await flush(10);
    type(b.ta, 'Oh Hello, world');
    await flush(10);
    expect(a.ta.value).toBe('Oh Hello, world');
    a.ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }));
    await flush(10);
    expect(a.ta.value).toBe('Oh Hello');
    expect(b.ta.value).toBe('Oh Hello');
    expect(a.s.canRedo).toBe(true);
    expect(a.s.redo()).toBe(true);
    await flush(10);
    expect(b.ta.value).toBe('Oh Hello, world');
    // Bo's own undo removes "Oh ".
    expect(b.s.undo()).toBe(true);
    await flush(10);
    expect(a.ta.value).toBe('Hello, world');
  });

  it('without { undo: true }, undo does nothing and the browser keeps its keys', async () => {
    const a = open('Alice', false);
    await flush(5);
    type(a.ta, 'Hello!');
    const key = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });
    a.ta.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    expect(a.s.undo()).toBe(false);
  });

  it('announces programmatic changes with collab:apply', async () => {
    const a = open('Alice');
    const b = open('Bo');
    const applied = vi.fn();
    a.ta.addEventListener('collab:apply', e => applied((e as CustomEvent).detail));
    await flush(5);
    expect(applied).toHaveBeenCalledWith({ op: null, remote: true });
    type(b.ta, 'Hello there');
    await flush(10);
    expect(applied).toHaveBeenLastCalledWith(expect.objectContaining({ remote: true, op: expect.any(TextOperation) }));
  });

  it('annotations stay on their text through concurrent edits, and sync', async () => {
    const a = open('Alice');
    const b = open('Bo');
    await flush(5);
    type(a.ta, 'Hello world');
    await flush(10);
    const seen = vi.fn();
    b.s.on('annotations', seen);
    // Bo types at the start while Alice's comment on "world" is on its way.
    const id = a.s.annotate(6, 11, 'Which one?');
    type(b.ta, 'Oh, Hello world');
    await flush(20);
    for (const { s, ta } of [a, b]) {
      expect(s.annotations).toHaveLength(1);
      const [note] = s.annotations as CollabAnnotation[];
      expect(note).toMatchObject({ id, body: 'Which one?', user: { name: 'Alice' }, resolved: false });
      expect(ta.value.slice(note.from, note.to)).toBe('world');
    }
    expect(seen).toHaveBeenCalled();
    // Typing right after the word doesn't extend it.
    type(a.ta, 'Oh, Hello world!');
    await flush(10);
    expect(b.ta.value.slice(b.s.annotations[0].from, b.s.annotations[0].to)).toBe('world');

    b.s.updateAnnotation(id, { resolved: true, replies: [{ body: 'This one.', user: { name: 'Bo' } }] });
    await flush(10);
    expect(a.s.annotations[0]).toMatchObject({ resolved: true, replies: [{ body: 'This one.' }] });

    // A late joiner gets them in the init.
    const c = open('Cy');
    await flush(10);
    expect(c.ta.value.slice(c.s.annotations[0].from, c.s.annotations[0].to)).toBe('world');

    a.s.removeAnnotation(id);
    await flush(10);
    expect(b.s.annotations).toHaveLength(0);
  });

  it('waits for in-flight edits before sending an annotation', async () => {
    const a = open('Alice');
    await flush(5);
    type(a.ta, 'Hello world');
    // Not acknowledged yet: the comment's positions are ahead of the server.
    a.s.annotate(6, 11, 'later');
    expect(hub.server.document('doc').annotations.size).toBe(0);
    await flush(20);
    const [stored] = hub.server.document('doc').annotations.values();
    expect(hub.server.document('doc').document.slice(stored.from, stored.to)).toBe('world');
  });
});
