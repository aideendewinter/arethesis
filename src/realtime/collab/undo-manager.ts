/**
 * UndoManager: undo and redo for one user in a shared document.
 *
 * It keeps the inverse of each *local* operation. When someone else's
 * operation arrives, every stored inverse is transformed against it, so undo
 * reverts only your own edits, at the right place, and never someone else's.
 * Typing in quick succession is grouped into one undo step.
 *
 * ```ts
 * const history = new UndoManager();
 * history.record(op, before);        // after each local edit (`before` = text it applied to)
 * history.transform(remoteOp);       // after each remote edit
 * const op = history.undo(current);  // apply `op` as a local edit, if not null
 * ```
 *
 * `CollabSession` uses one when opened with `{ undo: true }`, and
 * `<a-markdown-editor>` keeps its own.
 *
 * @module realtime/collab/undo-manager
 */

import { TextOperation } from '../ot/text-operation';

export interface UndoManagerOptions {
  /** Edits less than this many ms apart are grouped into one step. @default 800 */
  groupInterval?: number;
  /** Maximum number of steps kept. @default 200 */
  limit?: number;
}

interface Entry {
  /** The operation that reverts this step, against the current document. */
  op: TextOperation;
  time: number;
  /** What kind of edit started the step, for grouping. */
  kind: 'insert' | 'delete' | 'other';
}

/** Classify an edit: a single insertion, a single deletion, or anything else. */
function kindOf(op: TextOperation): Entry['kind'] {
  let inserts = 0;
  let deletes = 0;
  for (const c of op.ops) {
    if (typeof c === 'string') inserts++;
    else if (c < 0) deletes++;
  }
  if (inserts === 1 && deletes === 0) return 'insert';
  if (deletes === 1 && inserts === 0) return 'delete';
  return 'other';
}

export class UndoManager {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private readonly groupInterval: number;
  private readonly limit: number;
  /** Set by `break()`: the next edit starts a new step. */
  private sealed = true;

  constructor(options: UndoManagerOptions = {}) {
    this.groupInterval = options.groupInterval ?? 800;
    this.limit = options.limit ?? 200;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * A local edit `op` was applied to `before`. Typing (single insertions or
   * single deletions in a row, close together, not starting a new line) is
   * grouped with the previous step.
   */
  record(op: TextOperation, before: string, now = Date.now()): void {
    if (op.isNoop()) return;
    const inverse = op.invert(before);
    const kind = kindOf(op);
    const last = this.undoStack[this.undoStack.length - 1];
    const newLine = op.ops.some(c => typeof c === 'string' && c.includes('\n'));
    if (last && !this.sealed && kind !== 'other' && kind === last.kind && !newLine && now - last.time < this.groupInterval) {
      // Undo the new edit first, then the earlier ones.
      last.op = inverse.compose(last.op);
      last.time = now;
    } else {
      this.undoStack.push({ op: inverse, time: now, kind });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.sealed = newLine;
    this.redoStack = [];
  }

  /** End the current group: the next edit is a separate step (call when the caret moves away). */
  break(): void {
    this.sealed = true;
  }

  /**
   * Someone else's operation was applied to the document: rebase both stacks
   * onto it. Each stack entry applies to the document left by undoing the
   * ones above it, so the remote operation is transformed down the stack too.
   */
  transform(remote: TextOperation): void {
    this.undoStack = UndoManager.rebase(this.undoStack, remote);
    this.redoStack = UndoManager.rebase(this.redoStack, remote);
    this.sealed = true;
  }

  private static rebase(stack: Entry[], remote: TextOperation): Entry[] {
    let op = remote;
    const result: Entry[] = [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const [entry, next] = TextOperation.transform(stack[i].op, op);
      op = next;
      // An undo that no longer does anything (its text was deleted by someone else) is dropped.
      if (!entry.isNoop()) result.unshift({ ...stack[i], op: entry });
    }
    return result;
  }

  /** The operation that undoes the last step of `current`, or null. Apply it as a local edit. */
  undo(current: string): TextOperation | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ op: entry.op.invert(current), time: 0, kind: 'other' });
    this.sealed = true;
    return entry.op;
  }

  /** The operation that redoes the last undone step, or null. Apply it as a local edit. */
  redo(current: string): TextOperation | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ op: entry.op.invert(current), time: 0, kind: 'other' });
    this.sealed = true;
    return entry.op;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.sealed = true;
  }
}

/**
 * Where to put the caret after applying an undo or redo operation: at the
 * end of its last insertion, or where its last deletion was.
 */
export function caretAfter(op: TextOperation): number {
  let pos = 0;
  let caret = -1;
  for (const c of op.ops) {
    if (typeof c === 'string') {
      pos += c.length;
      caret = pos;
    } else if (c > 0) {
      pos += c;
    } else {
      caret = pos;
    }
  }
  return caret === -1 ? 0 : caret;
}
