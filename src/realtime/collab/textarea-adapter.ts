/**
 * Connects a `<textarea>` or text `<input>` to a collaboration session.
 *
 * Local edits become operations (computed from a diff, after IME composition
 * finishes); remote operations are applied while keeping the user's selection
 * where it belongs.
 *
 * Whenever it changes the value itself (the initial sync, a remote edit), it
 * fires a `collab:apply` event on the element, with `{ op, remote }` (`op` is
 * null for the initial sync). Code that decorates the textarea, such as a
 * syntax highlighter, can listen for it as well as `input`.
 *
 * @module realtime/collab/textarea-adapter
 */

import { TextOperation } from '../ot/text-operation';
import type { CollabSelection } from '../types';

export interface EditorAdapter {
  getValue(): string;
  /** Replace the content (initial sync). */
  setValue(value: string): void;
  /** Apply a remote operation. */
  applyOperation(op: TextOperation): void;
  getSelection(): CollabSelection;
  /** Register the local-edit and selection-change callbacks. */
  attach(onEdit: (op: TextOperation) => void, onSelect: (selection: CollabSelection) => void): void;
  /** Optional: route the editor's undo and redo commands (keys, menus) to these. */
  attachHistory?(undo: () => void, redo: () => void): void;
  /** Optional: apply an operation made locally (an undo or redo) and put the caret at `caret`. */
  applyLocal?(op: TextOperation, caret: number): void;
  destroy(): void;
}

/** Detail of the `collab:apply` event. */
export interface CollabApplyDetail {
  /** The operation applied, or null when the whole value was replaced. */
  op: TextOperation | null;
  remote: boolean;
}

export class TextareaAdapter implements EditorAdapter {
  private previous: string;
  private composing = false;
  private controller = new AbortController();

  constructor(readonly element: HTMLTextAreaElement | HTMLInputElement) {
    this.previous = element.value;
  }

  getValue(): string {
    return this.element.value;
  }

  setValue(value: string): void {
    this.element.value = value;
    this.previous = value;
    this.announce(null, true);
  }

  private announce(op: TextOperation | null, remote: boolean): void {
    this.element.dispatchEvent(new CustomEvent<CollabApplyDetail>('collab:apply', { detail: { op, remote } }));
  }

  applyOperation(op: TextOperation): void {
    const el = this.element;
    const focused = document.activeElement === el;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const direction = el.selectionDirection;
    const next = op.apply(this.previous);
    const scrollTop = (el as HTMLTextAreaElement).scrollTop;
    el.value = next;
    this.previous = next;
    if (focused) {
      el.setSelectionRange(op.transformIndex(start, true), op.transformIndex(end, true), direction ?? undefined);
    }
    (el as HTMLTextAreaElement).scrollTop = scrollTop;
    this.announce(op, true);
  }

  applyLocal(op: TextOperation, caret: number): void {
    const el = this.element;
    const next = op.apply(this.previous);
    el.value = next;
    this.previous = next;
    el.setSelectionRange(caret, caret);
    this.announce(op, false);
  }

  attachHistory(undo: () => void, redo: () => void): void {
    const { signal } = this.controller;
    this.element.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.defaultPrevented || !(ke.ctrlKey || ke.metaKey) || ke.altKey) return;
      const key = ke.key.toLowerCase();
      if (key === 'z' && !ke.shiftKey) undo();
      else if ((key === 'z' && ke.shiftKey) || (key === 'y' && !ke.shiftKey)) redo();
      else return;
      ke.preventDefault();
    }, { signal });
    // Undo and redo from the browser's own menus.
    this.element.addEventListener('beforeinput', (e: Event) => {
      const type = (e as InputEvent).inputType;
      if (type !== 'historyUndo' && type !== 'historyRedo') return;
      e.preventDefault();
      if (type === 'historyUndo') undo();
      else redo();
    }, { signal });
  }

  getSelection(): CollabSelection {
    const start = this.element.selectionStart ?? 0;
    const end = this.element.selectionEnd ?? 0;
    return this.element.selectionDirection === 'backward' ? { anchor: end, head: start } : { anchor: start, head: end };
  }

  attach(onEdit: (op: TextOperation) => void, onSelect: (selection: CollabSelection) => void): void {
    const { signal } = this.controller;
    const emitEdit = (): void => {
      if (this.composing) return;
      const value = this.element.value;
      if (value === this.previous) return;
      const op = TextOperation.fromDiff(this.previous, value);
      this.previous = value;
      onEdit(op);
    };
    this.element.addEventListener('input', emitEdit, { signal });
    this.element.addEventListener('compositionstart', () => (this.composing = true), { signal });
    this.element.addEventListener('compositionend', () => {
      this.composing = false;
      emitEdit();
    }, { signal });
    const select = (): void => onSelect(this.getSelection());
    for (const type of ['select', 'keyup', 'pointerup', 'focus']) this.element.addEventListener(type, select, { signal });
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === this.element) select();
    }, { signal });
  }

  destroy(): void {
    this.controller.abort();
  }
}
