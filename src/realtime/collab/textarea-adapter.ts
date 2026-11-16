/**
 * Connects a `<textarea>` or text `<input>` to a collaboration session.
 *
 * Local edits become operations (computed from a diff, after IME composition
 * finishes); remote operations are applied while keeping the user's selection
 * where it belongs.
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
  destroy(): void;
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
