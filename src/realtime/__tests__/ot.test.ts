import { describe, expect, it } from 'vitest';
import { TextOperation } from '../ot/text-operation';
import { OTClient } from '../ot/client';
import { OTDocumentServer } from '../ot/server';
import { rng } from '../../../test/helpers';

const ALPHABET = 'abcdefghij XYZ\n';

function randomString(r: () => number, max = 6): string {
  const len = Math.floor(r() * max);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
  return s;
}

/** A random operation applicable to `doc`. */
function randomOp(doc: string, r: () => number): TextOperation {
  const op = new TextOperation();
  let left = doc.length;
  while (left > 0) {
    const n = Math.min(left, 1 + Math.floor(r() * Math.min(left, 10)));
    const p = r();
    if (p < 0.2) op.insert(randomString(r));
    else if (p < 0.4) {
      op.delete(n);
      left -= n;
    } else {
      op.retain(n);
      left -= n;
    }
  }
  if (r() < 0.3) op.insert(randomString(r, 3) || 'q');
  return op;
}

describe('TextOperation', () => {
  it('builds and applies operations', () => {
    const op = new TextOperation().retain(5).insert(', world').delete(1).retain(0);
    expect(op.baseLength).toBe(6);
    expect(op.targetLength).toBe(12);
    expect(op.apply('hello!')).toBe('hello, world');
    expect(() => op.apply('short')).toThrow(/base length/);
    expect(() => new TextOperation().retain(-1)).toThrow();
  });

  it('merges adjacent components and orders insert before delete', () => {
    const op = new TextOperation().retain(1).retain(2).delete(1).insert('a').insert('b').delete(-2);
    expect(op.ops).toEqual([3, 'ab', -3]);
    expect(new TextOperation().delete(1).insert('x').ops).toEqual(['x', -1]);
    expect(new TextOperation().insert('').delete(0).isNoop()).toBe(true);
    expect(new TextOperation().retain(3).isNoop()).toBe(true);
  });

  it('round-trips JSON and validates input', () => {
    const op = new TextOperation().retain(2).insert('x').delete(3);
    expect(TextOperation.fromJSON(op.toJSON()).equals(op)).toBe(true);
    expect(() => TextOperation.fromJSON('nope')).toThrow();
    expect(() => TextOperation.fromJSON([1.5])).toThrow();
    expect(op.toString()).toBe('retain 2, insert "x", delete 3');
  });

  it('builds operations from a diff', () => {
    const pairs: Array<[string, string]> = [['abc', 'abXc'], ['hello', 'help'], ['', 'new'], ['gone', ''], ['same', 'same'], ['aaa', 'aa']];
    for (const [a, b] of pairs) expect(TextOperation.fromDiff(a, b).apply(a)).toBe(b);
  });

  it('inverts', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const doc = randomString(r, 20);
      const op = randomOp(doc, r);
      expect(op.invert(doc).apply(op.apply(doc))).toBe(doc);
    }
  });

  it('composes (property test)', () => {
    const r = rng(42);
    for (let i = 0; i < 500; i++) {
      const doc = randomString(r, 30);
      const a = randomOp(doc, r);
      const afterA = a.apply(doc);
      const b = randomOp(afterA, r);
      expect(a.compose(b).apply(doc)).toBe(b.apply(afterA));
    }
    expect(() => new TextOperation().retain(1).compose(new TextOperation().retain(2))).toThrow();
  });

  it('transforms concurrent operations so they converge (property test)', () => {
    const r = rng(1234);
    for (let i = 0; i < 2000; i++) {
      const doc = randomString(r, 30);
      const a = randomOp(doc, r);
      const b = randomOp(doc, r);
      const [aPrime, bPrime] = TextOperation.transform(a, b);
      expect(bPrime.apply(a.apply(doc))).toBe(aPrime.apply(b.apply(doc)));
    }
    expect(() => TextOperation.transform(new TextOperation().retain(1), new TextOperation().retain(2))).toThrow();
  });

  it('breaks insert ties in favour of the first operation', () => {
    const a = new TextOperation().retain(1).insert('A').retain(1);
    const b = new TextOperation().retain(1).insert('B').retain(1);
    const [aP, bP] = TextOperation.transform(a, b);
    expect(bP.apply(a.apply('xy'))).toBe('xABy');
    expect(aP.apply(b.apply('xy'))).toBe('xABy');
  });

  it('transforms overlapping deletes and inserts inside deletes', () => {
    const doc = 'abcdefgh';
    const a = new TextOperation().retain(1).delete(4).retain(3); // remove bcde
    const b = new TextOperation().retain(3).delete(3).retain(2); // remove def
    const [aP, bP] = TextOperation.transform(a, b);
    expect(bP.apply(a.apply(doc))).toBe('agh');
    expect(aP.apply(b.apply(doc))).toBe('agh');
    // An insert inside a deleted range survives (the old engine dropped half the delete).
    const del = new TextOperation().retain(1).delete(6).retain(1);
    const ins = new TextOperation().retain(4).insert('!').retain(4);
    const [dP, iP] = TextOperation.transform(del, ins);
    expect(iP.apply(del.apply(doc))).toBe('a!h');
    expect(dP.apply(ins.apply(doc))).toBe('a!h');
  });

  it('transforms cursor indices', () => {
    const op = new TextOperation().retain(2).insert('XX').retain(3).delete(2).retain(1);
    expect(op.transformIndex(0)).toBe(0);
    expect(op.transformIndex(2)).toBe(4);
    expect(op.transformIndex(2, true)).toBe(2);
    expect(op.transformIndex(5)).toBe(7);
    expect(op.transformIndex(6)).toBe(7); // inside the deleted range
    expect(op.transformIndex(8)).toBe(8);
  });
});

describe('OTClient + OTDocumentServer', () => {
  /** Simulate N clients editing concurrently through a server with random delivery order. */
  function simulate(seed: number, clients: number, steps: number): void {
    const r = rng(seed);
    const initial = 'The quick brown fox';
    const server = new OTDocumentServer(initial);
    interface Sim {
      doc: string;
      client: OTClient;
      inbox: Array<{ kind: 'op'; op: TextOperation } | { kind: 'ack' }>;
      outbox: Array<{ revision: number; op: TextOperation }>;
    }
    const sims: Sim[] = [];
    for (let i = 0; i < clients; i++) {
      const sim = { doc: initial, inbox: [], outbox: [] } as unknown as Sim;
      sim.client = new OTClient(0, {
        send: (revision, op) => sim.outbox.push({ revision, op }),
        apply: op => {
          sim.doc = op.apply(sim.doc);
        },
      });
      sims.push(sim);
    }

    const deliverToServer = (index: number): void => {
      const sim = sims[index];
      const msg = sim.outbox.shift();
      if (!msg) return;
      const applied = server.receive(msg.revision, msg.op);
      sims.forEach((s, j) => s.inbox.push(j === index ? { kind: 'ack' } : { kind: 'op', op: applied }));
    };
    const deliverToClient = (index: number): void => {
      const sim = sims[index];
      const msg = sim.inbox.shift();
      if (!msg) return;
      if (msg.kind === 'ack') sim.client.serverAck();
      else sim.client.applyServer(msg.op);
    };

    for (let step = 0; step < steps; step++) {
      const i = Math.floor(r() * clients);
      const action = r();
      if (action < 0.4) {
        const op = randomOp(sims[i].doc, r);
        sims[i].doc = op.apply(sims[i].doc);
        sims[i].client.applyClient(op);
      } else if (action < 0.7) {
        deliverToServer(i);
      } else {
        deliverToClient(i);
      }
    }
    // Drain everything.
    for (let guard = 0; guard < 10_000; guard++) {
      const pending = sims.findIndex(s => s.outbox.length || s.inbox.length);
      if (pending === -1) break;
      deliverToServer(pending);
      deliverToClient(pending);
    }
    for (const sim of sims) {
      expect(sim.client.state).toBe('synchronized');
      expect(sim.doc).toBe(server.document);
    }
  }

  it('converges with many concurrent clients', () => {
    for (let seed = 1; seed <= 40; seed++) simulate(seed, 3, 120);
  });

  it('tracks client state transitions', () => {
    const sent: number[] = [];
    const client = new OTClient(0, { send: rev => sent.push(rev), apply: () => {} });
    expect(client.state).toBe('synchronized');
    client.applyClient(new TextOperation().insert('a'));
    expect(client.state).toBe('awaiting');
    client.applyClient(new TextOperation().retain(1).insert('b'));
    client.applyClient(new TextOperation().retain(2).insert('c'));
    expect(client.state).toBe('buffering');
    client.resend();
    client.serverAck();
    expect(client.state).toBe('awaiting');
    expect(sent).toEqual([0, 0, 1]);
    client.serverAck();
    expect(client.state).toBe('synchronized');
    expect(() => client.serverAck()).toThrow();
    client.applyClient(new TextOperation().retain(3)); // noop ignored
    expect(client.state).toBe('synchronized');
    expect(client.transformIndex(2)).toBe(2);
  });

  it('rejects bad revisions on the server', () => {
    const server = new OTDocumentServer('abc');
    expect(() => server.receive(5, new TextOperation().retain(3))).toThrow(/revision/);
  });
});
