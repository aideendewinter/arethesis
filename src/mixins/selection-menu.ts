/**
 * `selection-menu`: a small toolbar next to selected text (Highlight, Note,
 * Copy, Define…), for anything text-heavy.
 *
 * ```ts
 * selectionMenuMixin(article, {
 *   items: [{ label: 'Highlight', action: 'highlight' }, { label: 'Note', action: 'note' }],
 * });
 * article.addEventListener('selection-menu:select', e => {
 *   const { action, range, text } = e.detail;
 * });
 * ```
 *
 * - It appears when text inside the element is selected (not in a form
 *   field), at the end of the selection where the pointer or caret is, and
 *   follows it as the selection changes. On touch screens it goes below
 *   the selection, out of the way of the system's own menu.
 * - Pressing its buttons keeps the selection, and the selection is put
 *   back before `selection-menu:select` fires.
 * - Keyboard: Shift+F10 or the Menu key moves into it while text is
 *   selected (ahead of a `context-menu` on the same element), arrow keys
 *   move between buttons, and Escape closes it and returns to the text
 *   with the selection intact. Screen readers hear that it's available.
 *
 * Events (bubbling from the element): `selection-menu:open` and
 * `selection-menu:select` (`{ action, range, text }`; `action` only on
 * select), and `selection-menu:close`.
 *
 * @module mixins/selection-menu
 */

import type { MixinInstance } from './types';
import { attachPopup, popupHost, type Popup } from './popup';
import { announce, emit } from './utils';
import { uniqueId } from '../utils/dom';

export interface SelectionMenuItem {
  label: string;
  action: string;
  /** A short glyph shown before the label (text, not HTML). */
  icon?: string;
  /** Show only the icon (the label becomes its accessible name and tooltip). */
  iconOnly?: boolean;
  disabled?: boolean;
}

export interface SelectionMenuOptions {
  /** The buttons, or a function of the selection that returns them. */
  items?: SelectionMenuItem[] | ((range: Range, text: string) => SelectionMenuItem[]);
  /** Or fill the toolbar yourself: buttons with `data-action` are its items. */
  render?: (menu: HTMLElement, range: Range, text: string) => void;
  /** @default 'top', or 'bottom' with a coarse pointer */
  placement?: 'top' | 'bottom';
  /** Fewest characters (trimmed) that open it. @default 1 */
  minLength?: number;
  /** The toolbar's accessible name. @default 'Selection actions' */
  label?: string;
  /** Tell screen readers when it appears. @default true */
  announce?: boolean;
  onSelect?: (action: string, range: Range, text: string) => void;
}

export interface SelectionMenuInstance extends MixinInstance {
  isOpen(): boolean;
  /** The selection it's open for. */
  range(): Range | null;
  close(): void;
  /** Move focus into the toolbar. */
  focus(): void;
}

const FIELD = 'input, textarea, select';

export function selectionMenuMixin(element: HTMLElement, options: SelectionMenuOptions = {}): SelectionMenuInstance {
  const { minLength = 1, label = 'Selection actions', announce: shouldAnnounce = true } = options;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const placement = options.placement ?? (coarse ? 'bottom' : 'top');
  const controller = new AbortController();
  const { signal } = controller;

  const menu = document.createElement('div');
  menu.className = 'ar-selection-menu';
  menu.id = uniqueId('selection-menu');
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', label);

  let saved: Range | null = null;
  let forward = true;
  let dismissed: Range | null = null;
  let returnFocus: HTMLElement | null = null;
  let frame = 0;
  let announced = false;

  const anchorRect = (): DOMRect => {
    if (!saved) return new DOMRect();
    const rects = Array.from(saved.getClientRects()).filter(r => r.width || r.height);
    const rect = rects.length ? rects[forward ? rects.length - 1 : 0] : saved.getBoundingClientRect();
    // At the end the selection grows from: anchored to that edge.
    return forward ? new DOMRect(rect.right, rect.top, 0, rect.height) : new DOMRect(rect.left, rect.top, 0, rect.height);
  };
  const popup: Popup = attachPopup(menu, { anchor: anchorRect, placement, gap: 8, mode: 'manual' });
  let open = false;

  const buttons = (): HTMLButtonElement[] => Array.from(menu.querySelectorAll<HTMLButtonElement>('button[data-action]:not(:disabled)'));

  const sameRange = (a: Range, b: Range): boolean => {
    try {
      return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0;
    } catch {
      return false;
    }
  };

  function build(range: Range, text: string): void {
    menu.replaceChildren();
    if (options.render) options.render(menu, range, text);
    else {
      const items = typeof options.items === 'function' ? options.items(range, text) : options.items ?? [];
      for (const item of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ar-selection-menu__item';
        btn.dataset.action = item.action;
        btn.disabled = !!item.disabled;
        if (item.icon) {
          const icon = document.createElement('span');
          icon.className = 'ar-selection-menu__icon';
          icon.setAttribute('aria-hidden', 'true');
          icon.textContent = item.icon;
          btn.append(icon);
        }
        if (item.iconOnly && item.icon) {
          btn.setAttribute('aria-label', item.label);
          btn.title = item.label;
        } else btn.append(item.label);
        menu.append(btn);
      }
    }
    menu.querySelectorAll('button').forEach(b => (b.tabIndex = -1));
    const first = buttons()[0];
    if (first) first.tabIndex = 0;
  }

  function show(range: Range, text: string): void {
    const wasOpen = open;
    saved = range.cloneRange();
    build(range, text);
    if (!buttons().length) {
      hide();
      return;
    }
    const host = popupHost(element);
    if (menu.parentElement !== host) host.append(menu);
    open = true;
    popup.show();
    popup.reposition();
    if (!wasOpen) {
      emit(element, 'selection-menu:open', { range: saved.cloneRange(), text });
      if (shouldAnnounce && !announced) {
        announced = true;
        announce(`${label} available, Shift+F10`);
      }
    }
  }

  function hide(): void {
    if (!open) {
      saved = null;
      return;
    }
    open = false;
    saved = null;
    popup.hide();
    menu.remove();
    emit(element, 'selection-menu:close', {});
  }

  function restoreSelection(range = saved): void {
    const selection = document.getSelection();
    if (!range || !selection) return;
    // (Changing the selection can update `saved` along the way: use the copy.)
    const { startContainer, startOffset, endContainer, endOffset } = range;
    const backward = !forward;
    selection.removeAllRanges();
    if (!backward || typeof selection.extend !== 'function') selection.addRange(range.cloneRange());
    else {
      selection.collapse(endContainer, endOffset);
      selection.extend(startContainer, startOffset);
    }
  }

  function update(): void {
    frame = 0;
    // Moving around the toolbar doesn't change what it's for.
    if (menu.contains(document.activeElement)) return;
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      dismissed = null;
      announced = false;
      hide();
      return;
    }
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    const anchor = selection.anchorNode;
    const anchorEl = anchor && (anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement);
    const inside = element.contains(range.startContainer) && element.contains(range.endContainer);
    if (!inside || anchorEl?.closest(FIELD) || text.trim().length < minLength || (dismissed && sameRange(dismissed, range))) {
      hide();
      return;
    }
    dismissed = null;
    forward = !(selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset);
    show(range, text);
  }

  const schedule = (): void => {
    if (frame) return;
    frame = -1;
    const id = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(update) : (setTimeout(update, 16) as unknown as number);
    if (frame === -1) frame = id;
  };

  function focusMenu(): void {
    const list = buttons();
    if (!open || !list.length) return;
    returnFocus = menu.contains(document.activeElement) ? returnFocus : (document.activeElement as HTMLElement | null);
    (list.find(b => b.tabIndex === 0) ?? list[0]).focus();
  }

  function leaveMenu(): void {
    const range = saved;
    dismissed = range?.cloneRange() ?? null;
    hide();
    restoreSelection(range);
    const target = returnFocus && returnFocus !== document.body && element.contains(returnFocus) ? returnFocus : element;
    returnFocus = null;
    if (target === element && element.tabIndex < 0 && !element.hasAttribute('tabindex')) element.tabIndex = -1;
    target.focus({ preventScroll: true });
    // Focusing can move the selection; put it back.
    restoreSelection(range);
  }

  function select(action: string): void {
    if (!saved) return;
    const range = saved.cloneRange();
    const text = range.toString();
    dismissed = range.cloneRange();
    returnFocus = null;
    hide();
    restoreSelection(range);
    options.onSelect?.(action, range, text);
    emit(element, 'selection-menu:select', { action, range, text });
  }

  document.addEventListener('selectionchange', schedule, { signal });
  // Pressing the toolbar must not take the selection away.
  menu.addEventListener('pointerdown', e => e.preventDefault(), { signal });
  menu.addEventListener('mousedown', e => e.preventDefault(), { signal });
  menu.addEventListener('click', e => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (btn && !btn.disabled) select(btn.dataset.action!);
  }, { signal });
  menu.addEventListener('keydown', e => {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number): void => {
      e.preventDefault();
      const next = list[(to + list.length) % list.length];
      list.forEach(b => (b.tabIndex = b === next ? 0 : -1));
      next.focus();
    };
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown': move(i + 1); break;
      case 'ArrowLeft':
      case 'ArrowUp': move(i - 1); break;
      case 'Home': move(0); break;
      case 'End': move(list.length - 1); break;
      case 'Escape':
        e.preventDefault();
        leaveMenu();
        break;
      case 'Tab':
        // Out of the toolbar is back to the text.
        e.preventDefault();
        leaveMenu();
        break;
    }
  }, { signal });
  // Capture, so it runs before a context menu on the same element.
  element.addEventListener('keydown', e => {
    if (!open || !(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    focusMenu();
  }, { signal, capture: true });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !open || menu.contains(e.target as Node)) return;
    dismissed = saved?.cloneRange() ?? null;
    hide();
  }, { signal });

  return {
    name: 'selection-menu',
    element,
    options: options as Record<string, unknown>,
    isOpen: () => open,
    range: () => saved?.cloneRange() ?? null,
    close: () => {
      dismissed = saved?.cloneRange() ?? null;
      hide();
    },
    focus: focusMenu,
    destroy: () => {
      hide();
      controller.abort();
      popup.destroy();
      menu.remove();
    },
  };
}
