/**
 * `sortable`: reorder items by dragging or with the keyboard, within one
 * container or across containers that share a `group` (a kanban board).
 *
 * Keyboard: focus an item, press Space or Enter to pick it up, use the arrow
 * keys to move it (Left/Right switch containers in a group), Space/Enter to
 * drop, Escape to cancel. Every step is announced to screen readers.
 *
 * Events on the source container: `sortable:start`, and `sortable:end`
 * (cancelable; detail {@link SortDetail}). If a listener calls preventDefault,
 * the move is reverted.
 *
 * @module mixins/sortable
 */

import type { MixinInstance, SortableOptions, SortDetail } from './types';
import { mixinRegistry } from './registry';
import { announce, emit } from './utils';

const groups = new Map<string, Set<HTMLElement>>();
/** Only one keyboard drag can be active at a time, across all containers. */
let keyboardDragActive = false;

interface ActiveDrag {
  item: HTMLElement;
  from: HTMLElement;
  oldIndex: number;
  placeholder: HTMLElement;
  pointerId?: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  started: boolean;
  keyboard: boolean;
  nextSibling: Node | null;
}

export function sortableMixin(element: HTMLElement, options: SortableOptions = {}): MixinInstance {
  const controller = new AbortController();
  const { signal } = controller;
  const draggingClass = options.draggingClass ?? 'is-sorting';
  const placeholderClass = options.placeholderClass ?? 'sortable-placeholder';
  const group = options.group;
  let active: ActiveDrag | null = null;

  if (group) {
    if (!groups.has(group)) groups.set(group, new Set());
    groups.get(group)!.add(element);
  }
  element.classList.add('is-sortable');
  if (!element.hasAttribute('role')) element.setAttribute('role', 'list');

  const isItem = (el: Element, container: HTMLElement): boolean =>
    el.parentElement === container && !el.classList.contains(placeholderClass) &&
    (!options.items || el.matches(options.items));
  const itemsOf = (container: HTMLElement): HTMLElement[] =>
    Array.from(container.children).filter((c): c is HTMLElement => c instanceof HTMLElement && isItem(c, container));
  const containers = (): HTMLElement[] => (group ? Array.from(groups.get(group) ?? []) : [element]).filter(c => c.isConnected);

  function prepareItems(): void {
    for (const item of itemsOf(element)) {
      if (!item.hasAttribute('tabindex')) item.tabIndex = 0;
      if (!item.hasAttribute('role')) item.setAttribute('role', 'listitem');
      item.setAttribute('aria-roledescription', 'sortable item');
    }
  }
  prepareItems();
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(prepareItems) : null;
  mo?.observe(element, { childList: true });

  function direction(container: HTMLElement): 'vertical' | 'horizontal' {
    if (options.direction) return options.direction;
    const style = getComputedStyle(container);
    return style.display.includes('flex') && !style.flexDirection.startsWith('column') ? 'horizontal' : 'vertical';
  }

  function label(item: HTMLElement): string {
    return item.getAttribute('aria-label') ?? item.textContent?.trim().slice(0, 60) ?? 'item';
  }

  function makePlaceholder(item: HTMLElement): HTMLElement {
    const ph = document.createElement(item.tagName === 'LI' ? 'li' : 'div');
    ph.className = placeholderClass;
    ph.setAttribute('aria-hidden', 'true');
    const rect = item.getBoundingClientRect();
    ph.style.height = `${rect.height}px`;
    if (direction(item.parentElement as HTMLElement) === 'horizontal') ph.style.width = `${rect.width}px`;
    return ph;
  }

  function begin(item: HTMLElement, keyboard: boolean, e?: PointerEvent): void {
    const rect = item.getBoundingClientRect();
    active = {
      item,
      from: item.parentElement as HTMLElement,
      oldIndex: itemsOf(item.parentElement as HTMLElement).indexOf(item),
      placeholder: makePlaceholder(item),
      pointerId: e?.pointerId,
      offsetX: e ? e.clientX - rect.left : 0,
      offsetY: e ? e.clientY - rect.top : 0,
      startX: e?.clientX ?? 0,
      startY: e?.clientY ?? 0,
      started: keyboard,
      keyboard,
      nextSibling: item.nextSibling,
    };
    if (keyboard) {
      keyboardDragActive = true;
      // Listen on the item itself: it may move into another container of the group.
      item.addEventListener('keydown', onDragKey, { signal });
      item.classList.add(draggingClass);
      item.setAttribute('aria-grabbed', 'true');
      emit(element, 'sortable:start', { item, from: active.from, oldIndex: active.oldIndex });
      announce(`Picked up ${label(item)}. Position ${active.oldIndex + 1} of ${itemsOf(active.from).length}. Use arrow keys to move, Space to drop, Escape to cancel.`);
    }
  }

  function liftForPointer(): void {
    if (!active) return;
    const { item } = active;
    const rect = item.getBoundingClientRect();
    item.parentElement!.insertBefore(active.placeholder, item);
    item.classList.add(draggingClass);
    Object.assign(item.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
      height: `${rect.height}px`, zIndex: '9999', pointerEvents: 'none', margin: '0',
    });
    document.body.appendChild(item);
    active.started = true;
    emit(element, 'sortable:start', { item, from: active.from, oldIndex: active.oldIndex });
  }

  function dropTarget(x: number, y: number): HTMLElement | null {
    const hit = document.elementFromPoint?.(x, y);
    for (const c of containers()) if (hit && (c === hit || c.contains(hit))) return c;
    return null;
  }

  function placeAt(container: HTMLElement, x: number, y: number): void {
    if (!active) return;
    const horizontal = direction(container) === 'horizontal';
    const items = itemsOf(container).filter(i => i !== active!.item);
    let before: HTMLElement | null = null;
    for (const item of items) {
      const r = item.getBoundingClientRect();
      const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      if ((horizontal ? x : y) < mid) {
        before = item;
        break;
      }
    }
    if (before) {
      if (active.placeholder.nextSibling !== before) container.insertBefore(active.placeholder, before);
    } else if (container.lastElementChild !== active.placeholder) {
      container.appendChild(active.placeholder);
    }
  }

  function finish(commit: boolean): void {
    if (!active) return;
    const drag = active;
    active = null;
    const { item, placeholder } = drag;
    if (drag.keyboard) {
      keyboardDragActive = false;
      item.removeEventListener('keydown', onDragKey);
    }
    item.classList.remove(draggingClass);
    item.removeAttribute('aria-grabbed');
    item.style.cssText = item.style.cssText.replace(/(position|left|top|width|height|z-index|pointer-events|margin):[^;]+;?/g, '');

    if (!drag.keyboard) {
      if (placeholder.parentElement) placeholder.replaceWith(item);
      else drag.from.insertBefore(item, drag.nextSibling);
    }
    placeholder.remove();

    const to = item.parentElement as HTMLElement;
    const newIndex = itemsOf(to).indexOf(item);
    const detail: SortDetail = { item, id: item.getAttribute('data-id'), from: drag.from, to, oldIndex: drag.oldIndex, newIndex };
    const moved = to !== drag.from || newIndex !== drag.oldIndex;

    if (!commit || (moved && !emit(element, 'sortable:end', detail))) {
      // Revert.
      const siblings = itemsOf(drag.from).filter(i => i !== item);
      drag.from.insertBefore(item, siblings[drag.oldIndex] ?? null);
      if (drag.keyboard) announce(`${label(item)} returned to position ${drag.oldIndex + 1}.`);
    } else if (moved) {
      options.onEnd?.(detail);
      if (drag.keyboard) announce(`${label(item)} dropped at position ${newIndex + 1} of ${itemsOf(to).length}.`);
    } else if (drag.keyboard) {
      announce(`${label(item)} dropped.`);
    }
    if (drag.keyboard) item.focus();
  }

  element.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || active) return;
    const target = e.target as HTMLElement;
    const item = Array.from(element.children).find(c => c instanceof HTMLElement && c.contains(target) && isItem(c, element)) as HTMLElement | undefined;
    if (!item) return;
    if (options.handle && !target.closest(options.handle)) return;
    if (target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
    begin(item, false, e);
  }, { signal });

  const onMove = (e: PointerEvent): void => {
    if (!active || active.keyboard || e.pointerId !== active.pointerId) return;
    if (!active.started) {
      if (Math.hypot(e.clientX - active.startX, e.clientY - active.startY) < 4) return;
      liftForPointer();
    }
    e.preventDefault();
    active.item.style.left = `${e.clientX - active.offsetX}px`;
    active.item.style.top = `${e.clientY - active.offsetY}px`;
    const container = dropTarget(e.clientX, e.clientY);
    if (container) placeAt(container, e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent): void => {
    if (!active || active.keyboard || e.pointerId !== active.pointerId) return;
    if (!active.started) {
      active = null;
      return;
    }
    finish(e.type === 'pointerup');
  };
  document.addEventListener('pointermove', onMove, { signal, passive: false });
  document.addEventListener('pointerup', onUp, { signal });
  document.addEventListener('pointercancel', onUp, { signal });

  element.addEventListener('keydown', (e: KeyboardEvent) => {
    const item = e.target as HTMLElement;
    if (keyboardDragActive || active) return;
    if (!isItem(item, item.parentElement as HTMLElement) || item.parentElement !== element) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      begin(item, true);
    }
  }, { signal });

  function onDragKey(e: KeyboardEvent): void {
    if (!active || !active.keyboard || e.target !== active.item) return;
    e.stopPropagation();
    const item = active.item;
    const container = item.parentElement as HTMLElement;
    const items = itemsOf(container);
    const index = items.indexOf(item);
    const horizontal = direction(container) === 'horizontal';
    const prevKey = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const nextKey = horizontal ? 'ArrowRight' : 'ArrowDown';
    const all = containers();
    const ci = all.indexOf(container);

    switch (e.key) {
      case prevKey:
        if (index > 0) container.insertBefore(item, items[index - 1]);
        break;
      case nextKey:
        if (index < items.length - 1) container.insertBefore(item, items[index + 1].nextSibling);
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const other = all[ci + (e.key === 'ArrowLeft' ? -1 : 1)];
        if (!other) break;
        const otherItems = itemsOf(other);
        other.insertBefore(item, otherItems[Math.min(index, otherItems.length)] ?? null);
        break;
      }
      case ' ':
      case 'Enter':
        e.preventDefault();
        finish(true);
        return;
      case 'Escape':
        e.preventDefault();
        finish(false);
        return;
      default:
        return;
    }
    e.preventDefault();
    item.focus();
    const now = item.parentElement as HTMLElement;
    announce(`Position ${itemsOf(now).indexOf(item) + 1} of ${itemsOf(now).length}${now !== container ? `, in ${now.getAttribute('aria-label') ?? 'next list'}` : ''}.`);
  }

  return {
    name: 'sortable',
    element,
    options: options as Record<string, unknown>,
    /** Ids (`data-id`) of the items in order. */
    toArray: () => itemsOf(element).map(i => i.getAttribute('data-id') ?? ''),
    destroy: () => {
      if (active) finish(false);
      controller.abort();
      mo?.disconnect();
      if (group) groups.get(group)?.delete(element);
      element.classList.remove('is-sortable');
    },
  };
}

mixinRegistry.register('sortable', sortableMixin);
