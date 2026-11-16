/**
 * TextOperation: a convergent operational-transform type for plain text.
 *
 * An operation is a list of components that walks the whole document:
 * - a positive integer **retains** that many characters
 * - a string **inserts** it
 * - a negative integer **deletes** that many characters
 *
 * `transform(a, b)` returns `[a', b']` such that `apply(apply(doc, a), b') ===
 * apply(apply(doc, b), a')`, which is what makes concurrent editing converge.
 * Positions count UTF-16 code units, like JavaScript strings.
 *
 * @module realtime/ot/text-operation
 */

export type OpComponent = number | string;

const isRetain = (c: OpComponent): c is number => typeof c === 'number' && c > 0;
const isDelete = (c: OpComponent): c is number => typeof c === 'number' && c < 0;
const isInsert = (c: OpComponent): c is string => typeof c === 'string';

function kind(c: OpComponent | undefined): 'retain' | 'insert' | 'delete' | 'none' {
  if (c === undefined) return 'none';
  if (typeof c === 'string') return 'insert';
  return c > 0 ? 'retain' : 'delete';
}

export class TextOperation {
  /** Components; adjacent components of the same kind are always merged. */
  readonly ops: OpComponent[] = [];
  /** Length of the document this operation applies to. */
  baseLength = 0;
  /** Length of the document after applying it. */
  targetLength = 0;

  /** Skip over `n` characters. */
  retain(n: number): this {
    if (n < 0) throw new Error('retain expects a non-negative integer');
    if (n === 0) return this;
    this.baseLength += n;
    this.targetLength += n;
    const last = this.ops[this.ops.length - 1];
    if (last !== undefined && isRetain(last)) this.ops[this.ops.length - 1] = last + n;
    else this.ops.push(n);
    return this;
  }

  /** Insert text at the current position. */
  insert(text: string): this {
    if (text === '') return this;
    this.targetLength += text.length;
    const ops = this.ops;
    const last = ops[ops.length - 1];
    if (last !== undefined && isInsert(last)) {
      ops[ops.length - 1] = last + text;
    } else if (last !== undefined && isDelete(last)) {
      // Keep inserts before deletes so equivalent operations look the same.
      const prev = ops[ops.length - 2];
      if (prev !== undefined && isInsert(prev)) ops[ops.length - 2] = prev + text;
      else {
        ops[ops.length] = last;
        ops[ops.length - 2] = text;
      }
    } else {
      ops.push(text);
    }
    return this;
  }

  /** Delete `n` characters. */
  delete(n: number): this {
    const count = Math.abs(n);
    if (count === 0) return this;
    this.baseLength += count;
    const last = this.ops[this.ops.length - 1];
    if (last !== undefined && isDelete(last)) this.ops[this.ops.length - 1] = last - count;
    else this.ops.push(-count);
    return this;
  }

  /** Whether the operation changes nothing. */
  isNoop(): boolean {
    return this.ops.length === 0 || (this.ops.length === 1 && isRetain(this.ops[0]));
  }

  /** Apply to a string. Throws if the lengths don't match. */
  apply(doc: string): string {
    if (doc.length !== this.baseLength) {
      throw new Error(`Operation base length ${this.baseLength} does not match document length ${doc.length}`);
    }
    const out: string[] = [];
    let index = 0;
    for (const op of this.ops) {
      if (isRetain(op)) {
        out.push(doc.slice(index, index + op));
        index += op;
      } else if (isInsert(op)) {
        out.push(op);
      } else {
        index -= op;
      }
    }
    return out.join('');
  }

  /** The operation that undoes this one on `doc` (the pre-image). */
  invert(doc: string): TextOperation {
    const inverse = new TextOperation();
    let index = 0;
    for (const op of this.ops) {
      if (isRetain(op)) {
        inverse.retain(op);
        index += op;
      } else if (isInsert(op)) {
        inverse.delete(op.length);
      } else {
        inverse.insert(doc.slice(index, index - op));
        index -= op;
      }
    }
    return inverse;
  }

  /** Combine with an operation that follows this one: `apply(apply(d, a), b) === apply(d, a.compose(b))`. */
  compose(next: TextOperation): TextOperation {
    if (this.targetLength !== next.baseLength) throw new Error('compose: length mismatch');
    const result = new TextOperation();
    const a = this.ops;
    const b = next.ops;
    let i = 0;
    let j = 0;
    let opA: OpComponent | undefined = a[i++];
    let opB: OpComponent | undefined = b[j++];
    for (;;) {
      const ka = kind(opA);
      const kb = kind(opB);
      if (ka === 'none' && kb === 'none') break;
      if (ka === 'delete') {
        result.delete(opA as number);
        opA = a[i++];
        continue;
      }
      if (kb === 'insert') {
        result.insert(opB as string);
        opB = b[j++];
        continue;
      }
      if (ka === 'none' || kb === 'none') throw new Error('compose: operations do not line up');

      if (ka === 'retain' && kb === 'retain') {
        const x = opA as number;
        const y = opB as number;
        if (x > y) {
          result.retain(y);
          opA = x - y;
          opB = b[j++];
        } else if (x === y) {
          result.retain(x);
          opA = a[i++];
          opB = b[j++];
        } else {
          result.retain(x);
          opB = y - x;
          opA = a[i++];
        }
      } else if (ka === 'insert' && kb === 'delete') {
        const x = opA as string;
        const y: number = -(opB as number);
        if (x.length > y) {
          opA = x.slice(y);
          opB = b[j++];
        } else if (x.length === y) {
          opA = a[i++];
          opB = b[j++];
        } else {
          opB = -(y - x.length);
          opA = a[i++];
        }
      } else if (ka === 'insert' && kb === 'retain') {
        const x = opA as string;
        const y = opB as number;
        if (x.length > y) {
          result.insert(x.slice(0, y));
          opA = x.slice(y);
          opB = b[j++];
        } else if (x.length === y) {
          result.insert(x);
          opA = a[i++];
          opB = b[j++];
        } else {
          result.insert(x);
          opB = y - x.length;
          opA = a[i++];
        }
      } else if (ka === 'retain' && kb === 'delete') {
        const x = opA as number;
        const y: number = -(opB as number);
        if (x > y) {
          result.delete(y);
          opA = x - y;
          opB = b[j++];
        } else if (x === y) {
          result.delete(y);
          opA = a[i++];
          opB = b[j++];
        } else {
          result.delete(x);
          opB = -(y - x);
          opA = a[i++];
        }
      } else {
        throw new Error('compose: unexpected components');
      }
    }
    return result;
  }

  /**
   * Transform two concurrent operations. When both insert at the same position,
   * `a`'s text goes first. The client and server both pass the *client's*
   * operation as `a`, so every replica breaks ties the same way.
   */
  static transform(a: TextOperation, b: TextOperation): [TextOperation, TextOperation] {
    if (a.baseLength !== b.baseLength) throw new Error('transform: operations must share a base');
    const aPrime = new TextOperation();
    const bPrime = new TextOperation();
    const opsA = a.ops;
    const opsB = b.ops;
    let i = 0;
    let j = 0;
    let opA: OpComponent | undefined = opsA[i++];
    let opB: OpComponent | undefined = opsB[j++];
    for (;;) {
      const ka = kind(opA);
      const kb = kind(opB);
      if (ka === 'none' && kb === 'none') break;
      if (ka === 'insert') {
        aPrime.insert(opA as string);
        bPrime.retain((opA as string).length);
        opA = opsA[i++];
        continue;
      }
      if (kb === 'insert') {
        aPrime.retain((opB as string).length);
        bPrime.insert(opB as string);
        opB = opsB[j++];
        continue;
      }
      if (ka === 'none' || kb === 'none') throw new Error('transform: operations do not line up');

      // Both components now consume base characters; work with lengths.
      const x = Math.abs(opA as number);
      const y = Math.abs(opB as number);
      const min = Math.min(x, y);
      if (ka === 'retain' && kb === 'retain') {
        aPrime.retain(min);
        bPrime.retain(min);
      } else if (ka === 'delete' && kb === 'retain') {
        aPrime.delete(min);
      } else if (ka === 'retain' && kb === 'delete') {
        bPrime.delete(min);
      }
      // delete/delete: both removed the same text; neither side needs to.
      if (x > y) {
        opA = ka === 'retain' ? x - y : -(x - y);
        opB = opsB[j++];
      } else if (x === y) {
        opA = opsA[i++];
        opB = opsB[j++];
      } else {
        opB = kb === 'retain' ? y - x : -(y - x);
        opA = opsA[i++];
      }
    }
    return [aPrime, bPrime];
  }

  /**
   * Map a cursor position through this operation. Inserts exactly at the cursor
   * push it forward unless `stickLeft` is true (use that for your own cursor).
   */
  transformIndex(index: number, stickLeft = false): number {
    let newIndex = index;
    let pos = 0;
    for (const op of this.ops) {
      if (pos > index) break;
      if (isRetain(op)) {
        pos += op;
      } else if (isInsert(op)) {
        if (pos < index || (pos === index && !stickLeft)) newIndex += op.length;
      } else {
        newIndex -= Math.min(-op, Math.max(0, index - pos));
        pos -= op;
      }
    }
    return newIndex;
  }

  /** Operation that turns `before` into `after` (one changed region). */
  static fromDiff(before: string, after: string): TextOperation {
    let start = 0;
    const minLen = Math.min(before.length, after.length);
    while (start < minLen && before[start] === after[start]) start++;
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
      endBefore--;
      endAfter--;
    }
    return new TextOperation()
      .retain(start)
      .delete(endBefore - start)
      .insert(after.slice(start, endAfter))
      .retain(before.length - endBefore);
  }

  equals(other: TextOperation): boolean {
    return this.baseLength === other.baseLength && this.targetLength === other.targetLength &&
      this.ops.length === other.ops.length && this.ops.every((op, i) => op === other.ops[i]);
  }

  toJSON(): OpComponent[] {
    return [...this.ops];
  }

  static fromJSON(ops: unknown): TextOperation {
    if (!Array.isArray(ops)) throw new Error('Invalid operation');
    const op = new TextOperation();
    for (const c of ops) {
      if (typeof c === 'string') op.insert(c);
      else if (typeof c === 'number' && Number.isInteger(c)) {
        if (c > 0) op.retain(c);
        else op.delete(c);
      } else throw new Error('Invalid operation component');
    }
    return op;
  }

  toString(): string {
    return this.ops.map(op => (isRetain(op) ? `retain ${op}` : isInsert(op) ? `insert ${JSON.stringify(op)}` : `delete ${-op}`)).join(', ');
  }
}
