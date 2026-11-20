/**
 * `grid-navigation`: spreadsheet-style keyboard navigation with a roving tabindex.
 *
 * Arrow keys move between cells, Home/End go to row edges (Ctrl for the grid),
 * PageUp/PageDown move by `pageSize` rows. Enter, F2 or typing a character
 * requests editing. Tab leaves the grid by default, so keyboard users never get trapped.
 *
 * Events: `grid:navigate` (detail `{ cell, row, col, direction }`), `grid:edit` (detail `{ cell, key }`).
 *
 * @module mixins/grid-navigation
 */

import type { GridNavigationOptions, MixinInstance } from './types';
import { mixinRegistry } from './registry';
import { emit } from './utils';

export function gridNavigationMixin(element: HTMLElement, options: GridNavigationOptions = {}): MixinInstance {
  const {
    cellSelector = '[data-cell], td, th[scope="col"], [role="gridcell"]',
    rowSelector = '[data-row], tr, [role="row"]',
    wrap = false,
    tabBehavior = 'exit',
    pageSize = 10,
  } = options;
  const controller = new AbortController();
  const { signal } = controller;
  let current: HTMLElement | null = null;
  const addedRole = !element.hasAttribute('role') && !(element instanceof HTMLTableElement);
  if (addedRole) element.setAttribute('role', 'grid');

  const rows = (): HTMLElement[] => Array.from(element.querySelectorAll<HTMLElement>(rowSelector)).filter(r => r.querySelector(cellSelector));
  const cellsIn = (row: HTMLElement): HTMLElement[] => Array.from(row.querySelectorAll<HTMLElement>(cellSelector)).filter(c => c.closest(rowSelector) === row);

  function position(cell: HTMLElement): { row: number; col: number } | null {
    const all = rows();
    for (let r = 0; r < all.length; r++) {
      const c = cellsIn(all[r]).indexOf(cell);
      if (c !== -1) return { row: r, col: c };
    }
    return null;
  }

  function refresh(): void {
    const all = rows().flatMap(cellsIn);
    if (current && !all.includes(current)) current = null;
    all.forEach(cell => {
      if (!cell.hasAttribute('tabindex') || cell !== current) cell.tabIndex = -1;
    });
    (current ?? all[0])?.setAttribute('tabindex', '0');
  }

  function focus(cell: HTMLElement | null, direction = 'focus'): void {
    if (!cell) return;
    if (current && current !== cell) {
      current.tabIndex = -1;
      current.classList.remove('is-focused');
    }
    current = cell;
    cell.tabIndex = 0;
    cell.classList.add('is-focused');
    cell.focus({ preventScroll: false });
    cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const pos = position(cell);
    options.onNavigate?.(cell, direction);
    emit(element, 'grid:navigate', { cell, row: pos?.row ?? -1, col: pos?.col ?? -1, direction });
  }

  function move(dRow: number, dCol: number, direction: string): boolean {
    const all = rows();
    if (!all.length) return false;
    const pos = current ? position(current) : null;
    if (!pos) {
      focus(cellsIn(all[0])[0] ?? null, direction);
      return true;
    }
    let row = pos.row + dRow;
    let col = pos.col + dCol;
    if (dCol !== 0) {
      const rowCells = cellsIn(all[pos.row]);
      if (col < 0 || col >= rowCells.length) {
        if (!wrap) return false;
        row += col < 0 ? -1 : 1;
        if (row < 0 || row >= all.length) return false;
        col = col < 0 ? cellsIn(all[row]).length - 1 : 0;
      }
    } else if (row < 0 || row >= all.length) {
      if (!wrap || Math.abs(dRow) > 1) row = Math.max(0, Math.min(row, all.length - 1));
      else row = row < 0 ? all.length - 1 : 0;
    }
    const target = cellsIn(all[row]);
    const cell = target[Math.min(col, target.length - 1)];
    if (!cell || cell === current) return false;
    focus(cell, direction);
    return true;
  }

  /** Ask to edit the current cell. Returns false if a listener prevented the event (it handled the key itself). */
  function requestEdit(key?: string): boolean {
    if (!current) return true;
    options.onEdit?.(current, key);
    return emit(element, 'grid:edit', { cell: current, key });
  }

  element.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!target.closest(cellSelector)) return;
    current = target.closest<HTMLElement>(cellSelector);
    const all = rows();
    let handled = true;
    switch (e.key) {
      case 'ArrowUp': move(-1, 0, 'up'); break;
      case 'ArrowDown': move(1, 0, 'down'); break;
      case 'ArrowLeft': move(0, -1, 'left'); break;
      case 'ArrowRight': move(0, 1, 'right'); break;
      case 'PageUp': move(-pageSize, 0, 'up'); break;
      case 'PageDown': move(pageSize, 0, 'down'); break;
      case 'Home':
        if (e.ctrlKey || e.metaKey) focus(cellsIn(all[0])[0] ?? null, 'first');
        else if (current) {
          const pos = position(current);
          if (pos) focus(cellsIn(all[pos.row])[0] ?? null, 'home');
        }
        break;
      case 'End':
        if (e.ctrlKey || e.metaKey) {
          const last = cellsIn(all[all.length - 1] ?? element);
          focus(last[last.length - 1] ?? null, 'last');
        } else if (current) {
          const pos = position(current);
          const cells = pos ? cellsIn(all[pos.row]) : [];
          focus(cells[cells.length - 1] ?? null, 'end');
        }
        break;
      case 'Tab':
        // Only intercept when configured to, and never at the grid's outer edges.
        handled = tabBehavior === 'cells' && move(0, e.shiftKey ? -1 : 1, e.shiftKey ? 'left' : 'right');
        break;
      case 'Enter':
      case 'F2':
        requestEdit(e.key);
        break;
      default:
        // A typed character starts editing. If the listener put the character in its editor, don't type it again;
        // otherwise (and for IME composition) the focused editor receives it.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) handled = !requestEdit(e.key);
        else if (e.key === 'Process' || e.isComposing) {
          requestEdit('');
          handled = false;
        } else handled = false;
    }
    if (handled) e.preventDefault();
  }, { signal });

  element.addEventListener('focusin', (e: FocusEvent) => {
    const cell = (e.target as HTMLElement).closest?.<HTMLElement>(cellSelector);
    if (cell && element.contains(cell) && cell !== current) {
      current?.classList.remove('is-focused');
      if (current) current.tabIndex = -1;
      current = cell;
      cell.tabIndex = 0;
      cell.classList.add('is-focused');
    }
  }, { signal });

  element.addEventListener('click', (e: MouseEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(cellSelector);
    if (cell && element.contains(cell) && !(e.target as HTMLElement).closest('input, textarea, select, button, a')) focus(cell, 'click');
  }, { signal });

  element.addEventListener('dblclick', (e: MouseEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(cellSelector);
    if (cell && element.contains(cell)) {
      current = cell;
      requestEdit('dblclick');
    }
  }, { signal });

  refresh();

  return {
    name: 'grid-navigation',
    element,
    options: options as Record<string, unknown>,
    /** Re-scan cells (call after rows are added or removed). */
    refresh,
    focusCell: (row: number, col: number) => {
      const cells = cellsIn(rows()[row] ?? element);
      focus(cells[Math.min(col, cells.length - 1)] ?? null, 'api');
    },
    activeCell: () => current,
    destroy: () => {
      controller.abort();
      rows().flatMap(cellsIn).forEach(c => {
        c.removeAttribute('tabindex');
        c.classList.remove('is-focused');
      });
      if (addedRole) element.removeAttribute('role');
    },
  };
}

mixinRegistry.register('grid-navigation', gridNavigationMixin);
