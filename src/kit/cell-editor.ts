/**
 * Spreadsheet-style cell editing, shared by `<a-data-table>` and `<a-sheet>`.
 *
 * The editor floats over the cell (in a positioned container you pass), so
 * the cell keeps its content and size: nothing shifts while you type, and a
 * live update re-rendering the cell can't destroy the editor.
 *
 * Keys, following the grid editing decisions (dev-docs/grid-editing-ux.md):
 *
 * - **Mode.** Started by typing (`mode: 'enter'`), the arrow keys commit and
 *   move to the next cell. Started with Enter, F2 or a click (`'edit'`), they
 *   move the caret. F2 switches between the two.
 * - **Enter** commits and stays, or moves down with `enterMoves: 'down'`;
 *   **Shift+Enter** moves up instead.
 * - **Tab / Shift+Tab** commit and move right / left.
 * - **Escape** reverts. Leaving the editor (clicking elsewhere) commits.
 * - **Choice cells** use the `listbox` mixin: arrows move through the
 *   options without committing.
 *
 * Invalid values keep the editor open, with the message in a bubble under
 * it (`aria-invalid`, `aria-describedby`, and announced).
 *
 * @module kit/cell-editor
 */

import { listboxMixin, type ListboxOption } from '../mixins/listbox';
import type { MixinInstance } from '../mixins/types';
import { announce as liveAnnounce } from '../mixins/utils';
import { uniqueId } from '../utils/dom';

export type CellMove = 'up' | 'down' | 'left' | 'right' | 'none';
export type CellEditorType = 'text' | 'number' | 'date' | 'email' | 'url' | 'select';

export interface CellEditorOptions {
  cell: HTMLElement;
  /** A positioned element containing the cell (usually its scroll container); the editor is placed in it. */
  host: HTMLElement;
  /** The raw value to edit (not the formatted text). */
  value: string;
  type?: CellEditorType;
  choices?: Array<string | ListboxOption>;
  /** What is being edited, for the input's name and announcements (e.g. "Name"). */
  label: string;
  /** `'enter'`: started by typing; arrows commit and move. `'edit'`: arrows move the caret. @default 'edit' */
  mode?: 'enter' | 'edit';
  /** Where the caret starts: an offset, `'end'` or `'all'` (select everything). @default 'end' */
  caret?: number | 'end' | 'all';
  /** Text to start with instead of `value` (type-to-edit replaces the value). */
  initialText?: string;
  /** Where Enter goes after committing. @default 'none' */
  enterMoves?: 'down' | 'none';
  /** Return `true` or an error message. */
  validate?: (value: string) => true | string | Promise<true | string>;
  /** Save the new value. Called only when it changed and is valid. */
  commit: (value: string) => void | Promise<void>;
  /** The editor closed: whether a new value was committed, and where to move. */
  onClose?: (result: { committed: boolean; move: CellMove; reason: 'commit' | 'cancel' | 'blur' }) => void;
  /** Screen-reader announcements. @default a shared polite live region */
  announce?: (message: string) => void;
}

export interface CellEditor {
  /** The input (or, for choices, the combobox). */
  readonly input: HTMLElement;
  readonly mode: 'enter' | 'edit';
  readonly closed: boolean;
  /** Validate and commit; resolves to whether the editor closed. */
  commit(move?: CellMove): Promise<boolean>;
  cancel(): void;
  /** Re-align with the cell (after scrolling or resizing). */
  reposition(): void;
}

export function openCellEditor(o: CellEditorOptions): CellEditor {
  const announce = o.announce ?? liveAnnounce;
  const type = o.type ?? 'text';
  let mode: 'enter' | 'edit' = o.mode ?? 'edit';
  let closed = false;
  let busy = false;
  const controller = new AbortController();
  const { signal } = controller;

  const overlay = document.createElement('div');
  overlay.className = 'ar-cell-editor';
  overlay.dataset.mode = mode;
  const errorId = uniqueId('ar-cell-error');
  const error = document.createElement('div');
  error.className = 'ar-cell-editor__error';
  error.id = errorId;
  error.hidden = true;

  let input: HTMLElement;
  let listbox: MixinInstance | null = null;
  if (type === 'select') {
    input = document.createElement('div');
    input.className = 'ar-cell-editor__input';
    input.setAttribute('aria-label', o.label);
    overlay.append(input, error);
    listbox = listboxMixin(input, { options: o.choices ?? [], value: o.value, label: o.label, open: true, container: overlay });
  } else {
    const field = document.createElement('input');
    field.type = type;
    field.className = 'ar-cell-editor__input';
    field.setAttribute('aria-label', o.label);
    field.value = o.initialText ?? o.value;
    input = field;
    overlay.append(field, error);
  }
  o.host.appendChild(overlay);

  const textValue = (): string => (listbox ? (listbox.getValue as () => string)() : (input as HTMLInputElement).value);

  function reposition(): void {
    const cell = o.cell.getBoundingClientRect();
    const host = o.host.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: `${cell.top - host.top + o.host.scrollTop}px`,
      left: `${cell.left - host.left + o.host.scrollLeft}px`,
      width: `${cell.width}px`,
      height: `${cell.height}px`,
    });
  }
  reposition();

  input.focus();
  if (input instanceof HTMLInputElement) {
    const caret = o.caret ?? 'end';
    try {
      if (caret === 'all') input.select();
      else {
        const at = caret === 'end' ? input.value.length : Math.min(caret, input.value.length);
        input.setSelectionRange(at, at);
      }
    } catch {
      /* number and date inputs have no selection API */
    }
  }
  announce(`Editing ${o.label}`);

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
    error.setAttribute('role', 'alert');
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', errorId);
    overlay.classList.add('is-invalid');
    input.focus();
  }

  function close(committed: boolean, move: CellMove, reason: 'commit' | 'cancel' | 'blur'): void {
    if (closed) return;
    closed = true;
    controller.abort();
    listbox?.destroy();
    overlay.remove();
    o.onClose?.({ committed, move, reason });
  }

  async function commit(move: CellMove = 'none', reason: 'commit' | 'blur' = 'commit'): Promise<boolean> {
    if (closed || busy) return closed;
    const value = textValue();
    if (value === o.value) {
      close(false, move, reason);
      return true;
    }
    if (o.validate) {
      busy = true;
      const result = await o.validate(value);
      busy = false;
      if (closed) return true;
      if (result !== true) {
        showError(typeof result === 'string' ? result : 'Invalid value');
        announce(typeof result === 'string' ? result : 'Invalid value');
        return false;
      }
    }
    close(true, move, reason);
    announce(`${o.label} changed`);
    await o.commit(value);
    return true;
  }

  function cancel(): void {
    if (closed) return;
    close(false, 'none', 'cancel');
    announce('Edit cancelled');
  }

  const ARROWS: Record<string, CellMove> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  overlay.addEventListener('keydown', (e: KeyboardEvent) => {
    // Nothing typed here should reach the grid underneath.
    e.stopPropagation();
    if (e.isComposing) return;
    let handled = true;
    if (e.key === 'Escape') cancel();
    else if (e.key === 'Enter') void commit(o.enterMoves === 'down' ? (e.shiftKey ? 'up' : 'down') : 'none');
    else if (e.key === 'Tab') void commit(e.shiftKey ? 'left' : 'right');
    else if (e.key === 'F2') {
      mode = mode === 'enter' ? 'edit' : 'enter';
      overlay.dataset.mode = mode;
      announce(mode === 'edit' ? 'Arrow keys move the cursor' : 'Arrow keys move between cells');
    } else if (ARROWS[e.key] && mode === 'enter' && !e.shiftKey && !e.altKey) void commit(ARROWS[e.key]);
    else handled = false;
    if (handled) e.preventDefault();
  }, { signal });
  if (listbox) {
    input.addEventListener('listbox:commit', (e: Event) => {
      const { key, shiftKey } = (e as CustomEvent<{ key: string; shiftKey: boolean }>).detail;
      const move: CellMove = key === 'Tab' ? (shiftKey ? 'left' : 'right') : key === 'Enter' && o.enterMoves === 'down' ? (shiftKey ? 'up' : 'down') : 'none';
      void commit(move);
    }, { signal });
    input.addEventListener('listbox:cancel', () => cancel(), { signal });
  }
  // Leaving the editor commits; if the value is invalid, the editor stays open.
  overlay.addEventListener('focusout', (e: FocusEvent) => {
    if (overlay.contains(e.relatedTarget as Node | null)) return;
    queueMicrotask(() => {
      if (!closed && !overlay.contains(document.activeElement)) void commit('none', 'blur');
    });
  }, { signal });

  return {
    input,
    get mode() {
      return mode;
    },
    get closed() {
      return closed;
    },
    commit: (move?: CellMove) => commit(move),
    cancel,
    reposition,
  };
}
