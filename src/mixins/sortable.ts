/**
 * `sortable`: reorder items by dragging or with the keyboard, within one
 * container or across containers that share a `group` (a kanban board).
 *
 * Pointer dragging:
 * - A drag starts once the pointer moves a few pixels (mouse, pen), or after a
 *   short press on touch screens, so taps, clicks and scrolling still work.
 * - The item stays in its container (it is never re-parented while dragging,
 *   so components inside it keep their state) and follows the pointer above
 *   the page. A placeholder marks where it will land.
 * - The drop position is the closest item in two dimensions, so lists, grids
 *   and wrapping rows all work, and the closest container wins even when the
 *   pointer is over the gap between containers.
 * - Other items slide out of the way, and the item glides into place on drop
 *   (no animation when the user prefers reduced motion).
 * - Scroll containers and the page auto-scroll near their edges.
 *
 * Keyboard: focus an item, press Space or Enter to pick it up, use the arrow
 * keys to move it (Left/Right switch containers in a group), Space/Enter to
 * drop, Escape to cancel. Every step is announced to screen readers.
 *
 * Events on the source container: `sortable:start`, `sortable:move` (the drop
 * position changed; detail `{ item, to, index }`), and `sortable:end`
 * (cancelable; detail {@link SortDetail}). If a listener calls preventDefault
 * on `sortable:end`, the move is reverted.
 *
 * @module mixins/sortable
 */

import type { MixinInstance, SortableOptions, SortDetail } from './types';
import { mixinRegistry } from './registry';
import { announce, emit } from './utils';

const groups = new Map<string, Set<HTMLElement>>();
/** Only one keyboard drag can be active at a time, across all containers. */
let keyboardDragActive = false;

/** Pixels from a scroll container's edge where auto-scroll starts. */
const SCROLL_EDGE = 48;
/** Fastest auto-scroll, in pixels per frame. */
const SCROLL_SPEED = 18;
/** How far the pointer must travel after a reorder before the next one (stops flicker at boundaries). */
const REORDER_HYSTERESIS = 6;
/** Containers this close to the pointer (px) still accept the drop when the pointer is between them. */
const CONTAINER_REACH = 64;

interface PendingDrag {
  item: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  touch: boolean;
  /** Touch press timer; the drag starts when it fires. */
  timer?: ReturnType<typeof setTimeout>;
  ready: boolean;
}

interface ActiveDrag {
  item: HTMLElement;
  from: HTMLElement;
  oldIndex: number;
  nextSibling: Node | null;
  keyboard: boolean;
  placeholder?: HTMLElement;
  pointerId?: number;
  /** Pointer offset within the item. */
  offsetX: number;
  offsetY: number;
  /** Correction for a containing block that isn't the viewport. */
  fixX: number;
  fixY: number;
  /** Item styles to restore. */
  style: string;
  /** Latest pointer position; processed once per frame. */
  x: number;
  y: number;
  /** Pointer position at the last reorder (hysteresis). */
  lastX: number;
  lastY: number;
  frame?: number;
  container: HTMLElement;
  index: number;
}

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Animate a layout change (FLIP): measure, change, then play each element
 * from its old position to its new one.
 */
function flip(elements: HTMLElement[], change: () => void, duration: number): void {
  if (duration <= 0 || reducedMotion() || typeof Element.prototype.animate !== 'function') {
    change();
    return;
  }
  const before = new Map(elements.map(el => [el, el.getBoundingClientRect()]));
  change();
  for (const [el, first] of before) {
    if (!el.isConnected) continue;
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    el.getAnimations?.().forEach(a => a.cancel());
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  }
}

/** Nearest scrollable ancestors (and the page) of an element. */
function scrollParents(el: HTMLElement | null): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const scrollY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    const scrollX = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    if (scrollX || scrollY) found.push(node);
  }
  const page = document.scrollingElement as HTMLElement | null;
  if (page) found.push(page);
  return found;
}

/** Distance from a point to a rectangle (0 inside it). */
function distanceTo(rect: DOMRect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

export function sortableMixin(element: HTMLElement, options: SortableOptions = {}): MixinInstance {
  const controller = new AbortController();
  const { signal } = controller;
  const draggingClass = options.draggingClass ?? 'is-sorting';
  const placeholderClass = options.placeholderClass ?? 'sortable-placeholder';
  const duration = options.animation ?? 180;
  const activationDistance = options.activationDistance ?? 5;
  const touchDelay = options.touchDelay ?? 200;
  const touchTolerance = 8;
  const group = options.group;
  let pending: PendingDrag | null = null;
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

  /** Everything that can move when the placeholder does. */
  function animated(): HTMLElement[] {
    return containers().flatMap(c => [...itemsOf(c), ...Array.from(c.querySelectorAll<HTMLElement>(`:scope > .${CSS.escape(placeholderClass)}`))]).filter(el => el !== active?.item);
  }

  // ── Starting ─────────────────────────────────────────────────────────────

  function begin(item: HTMLElement, keyboard: boolean): ActiveDrag {
    const from = item.parentElement as HTMLElement;
    const oldIndex = itemsOf(from).indexOf(item);
    active = {
      item, from, oldIndex, keyboard,
      nextSibling: item.nextSibling,
      offsetX: 0, offsetY: 0, fixX: 0, fixY: 0, x: 0, y: 0, lastX: 0, lastY: 0,
      style: item.getAttribute('style') ?? '',
      container: from,
      index: oldIndex,
    };
    return active;
  }

  /** Lift the item for a pointer drag: a placeholder holds its slot and the item follows the pointer. */
  function lift(p: PendingDrag, x: number, y: number): void {
    const drag = begin(p.item, false);
    const { item } = drag;
    const rect = item.getBoundingClientRect();
    drag.pointerId = p.pointerId;
    drag.offsetX = p.startX - rect.left;
    drag.offsetY = p.startY - rect.top;

    const placeholder = document.createElement(item.tagName === 'LI' ? 'li' : 'div');
    placeholder.className = placeholderClass;
    placeholder.setAttribute('aria-hidden', 'true');
    const style = getComputedStyle(item);
    Object.assign(placeholder.style, {
      height: `${rect.height}px`,
      width: direction(drag.from) === 'horizontal' ? `${rect.width}px` : '',
      flex: style.flex, minWidth: style.minWidth, maxWidth: style.maxWidth, margin: style.margin,
    });
    item.before(placeholder);
    drag.placeholder = placeholder;

    // Lift without re-parenting, so components inside keep their state.
    item.classList.add(draggingClass);
    Object.assign(item.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
      margin: '0', zIndex: '9999', pointerEvents: 'none', boxSizing: 'border-box',
    });
    // A transformed or filtered ancestor makes `fixed` relative to it: measure and correct.
    const placed = item.getBoundingClientRect();
    drag.fixX = rect.left - placed.left;
    drag.fixY = rect.top - placed.top;
    document.documentElement.classList.add('is-sorting-active');
    emit(element, 'sortable:start', { item, from: drag.from, oldIndex: drag.oldIndex });
    move(x, y);
  }

  // ── Dragging ─────────────────────────────────────────────────────────────

  function move(x: number, y: number): void {
    if (!active || active.keyboard) return;
    active.x = x;
    active.y = y;
    active.item.style.left = `${x - active.offsetX + active.fixX}px`;
    active.item.style.top = `${y - active.offsetY + active.fixY}px`;
    if (active.frame === undefined) active.frame = requestAnimationFrame(tick);
  }

  /** Once per frame: auto-scroll and update the drop position. */
  function tick(): void {
    if (!active || active.keyboard) return;
    active.frame = undefined;
    const scrolled = options.autoScroll === false ? false : autoScroll(active.x, active.y);
    place(active.x, active.y);
    if (scrolled) active.frame = requestAnimationFrame(tick);
  }

  function autoScroll(x: number, y: number): boolean {
    if (!active) return false;
    let scrolled = false;
    for (const el of scrollParents(active.container)) {
      const page = el === document.scrollingElement;
      const r = page ? new DOMRect(0, 0, innerWidth, innerHeight) : el.getBoundingClientRect();
      if (!page && distanceTo(r, x, y) > 0) continue;
      const speed = (edge: number) => Math.ceil(SCROLL_SPEED * Math.min(1, (SCROLL_EDGE - edge) / SCROLL_EDGE));
      const dy = y - r.top < SCROLL_EDGE ? -speed(y - r.top) : r.bottom - y < SCROLL_EDGE ? speed(r.bottom - y) : 0;
      const dx = x - r.left < SCROLL_EDGE ? -speed(x - r.left) : r.right - x < SCROLL_EDGE ? speed(r.right - x) : 0;
      if (!dx && !dy) continue;
      const beforeTop = el.scrollTop;
      const beforeLeft = el.scrollLeft;
      el.scrollBy?.(dx, dy);
      if (el.scrollTop !== beforeTop || el.scrollLeft !== beforeLeft) scrolled = true;
    }
    return scrolled;
  }

  /** The container the pointer is over, or the closest one within reach. */
  function containerAt(x: number, y: number): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestDistance = CONTAINER_REACH;
    for (const c of containers()) {
      const d = distanceTo(c.getBoundingClientRect(), x, y);
      if (d < bestDistance || (d === 0 && bestDistance === 0)) {
        best = c;
        bestDistance = d;
      }
    }
    return best;
  }

  /** Where in `container` the item would land for a pointer at (x, y). */
  function indexAt(container: HTMLElement, x: number, y: number): number {
    const items = itemsOf(container).filter(i => i !== active?.item);
    if (!items.length) return 0;
    const horizontal = direction(container) === 'horizontal';
    let closest = 0;
    let closestDistance = Infinity;
    const rects = items.map(i => i.getBoundingClientRect());
    rects.forEach((r, i) => {
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < closestDistance) {
        closest = i;
        closestDistance = d;
      }
    });
    const r = rects[closest];
    let after: boolean;
    if (!horizontal) after = y > r.top + r.height / 2;
    // In a row (or a wrapping row): across within the item's row, otherwise above or below that row.
    else if (y >= r.top && y <= r.bottom) after = x > r.left + r.width / 2;
    else after = y > r.bottom;
    return closest + (after ? 1 : 0);
  }

  function place(x: number, y: number): void {
    if (!active?.placeholder) return;
    if (Math.hypot(x - active.lastX, y - active.lastY) < REORDER_HYSTERESIS) return;
    const container = containerAt(x, y);
    if (!container) return;
    const index = indexAt(container, x, y);
    if (container === active.container && index === active.index) return;
    const drag = active;
    const items = itemsOf(container).filter(i => i !== drag.item);
    flip(animated(), () => container.insertBefore(drag.placeholder!, items[index] ?? null), duration);
    drag.container = container;
    drag.index = index;
    drag.lastX = x;
    drag.lastY = y;
    emit(element, 'sortable:move', { item: drag.item, to: container, index });
  }

  // ── Dropping ─────────────────────────────────────────────────────────────

  function cleanup(drag: ActiveDrag): void {
    if (drag.frame !== undefined) cancelAnimationFrame(drag.frame);
    drag.item.classList.remove(draggingClass);
    drag.item.removeAttribute('aria-grabbed');
    if (drag.style) drag.item.setAttribute('style', drag.style);
    else drag.item.removeAttribute('style');
    document.documentElement.classList.remove('is-sorting-active');
  }

  /** End a drag; `commit` false cancels it. */
  function finish(commit: boolean): void {
    if (!active) return;
    const drag = active;
    active = null;
    if (drag.keyboard) {
      keyboardDragActive = false;
      drag.item.removeEventListener('keydown', onDragKey);
    }
    const { item, placeholder } = drag;

    const settle = (): void => {
      cleanup(drag);
      if (placeholder) {
        if (commit && placeholder.parentElement) placeholder.replaceWith(item);
        placeholder.remove();
      }
      report(drag, commit);
    };

    if (!placeholder || !commit || duration <= 0 || reducedMotion() || typeof item.animate !== 'function') {
      if (placeholder && !commit) {
        // Cancelled: the item never left its slot; slide the others back.
        cleanup(drag);
        flip(animated(), () => placeholder.remove(), duration);
        report(drag, false);
        return;
      }
      settle();
      return;
    }
    // Glide into the placeholder's slot, then settle.
    const from = item.getBoundingClientRect();
    const to = placeholder.getBoundingClientRect();
    item.style.transition = 'none';
    const animation = item.animate(
      [{ transform: 'translate(0, 0)' }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)` }],
      { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' },
    );
    animation.finished.then(settle, settle).finally(() => animation.cancel());
  }

  /** Emit `sortable:end` (reverting if it's cancelled) and announce the result. */
  function report(drag: ActiveDrag, commit: boolean): void {
    const { item } = drag;
    const to = item.parentElement as HTMLElement;
    const newIndex = itemsOf(to).indexOf(item);
    const detail: SortDetail = { item, id: item.getAttribute('data-id'), from: drag.from, to, oldIndex: drag.oldIndex, newIndex };
    const moved = to !== drag.from || newIndex !== drag.oldIndex;
    if (!commit || (moved && !emit(element, 'sortable:end', detail))) {
      if (moved) {
        const siblings = itemsOf(drag.from).filter(i => i !== item);
        flip(animated(), () => drag.from.insertBefore(item, siblings[drag.oldIndex] ?? null), duration);
      }
      if (drag.keyboard) announce(`${label(item)} returned to position ${drag.oldIndex + 1}.`);
    } else if (moved) {
      options.onEnd?.(detail);
      if (drag.keyboard) announce(`${label(item)} dropped at position ${newIndex + 1} of ${itemsOf(to).length}.`);
    } else if (drag.keyboard) {
      announce(`${label(item)} dropped.`);
    }
    if (drag.keyboard) item.focus();
  }

  // ── Pointer events ───────────────────────────────────────────────────────

  function cancelPending(): void {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
  }

  element.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || active || pending) return;
    const target = e.target as HTMLElement;
    const item = Array.from(element.children).find(c => c instanceof HTMLElement && c.contains(target) && isItem(c, element)) as HTMLElement | undefined;
    if (!item) return;
    if (options.handle && !target.closest(options.handle)) return;
    if (target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
    const touch = e.pointerType === 'touch';
    pending = { item, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, touch, ready: !touch || touchDelay <= 0 };
    if (!pending.ready) {
      // Touch: a press-and-hold starts the drag; moving first means the user is scrolling.
      const p = pending;
      p.timer = setTimeout(() => {
        if (pending !== p) return;
        pending = null;
        lift(p, p.startX, p.startY);
      }, touchDelay);
    }
  }, { signal });

  const onMove = (e: PointerEvent): void => {
    if (pending && e.pointerId === pending.pointerId) {
      const distance = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
      if (!pending.ready) {
        if (distance > touchTolerance) cancelPending();
        return;
      }
      if (distance < activationDistance) return;
      const p = pending;
      pending = null;
      lift(p, e.clientX, e.clientY);
      e.preventDefault();
      return;
    }
    if (!active || active.keyboard || e.pointerId !== active.pointerId) return;
    e.preventDefault();
    move(e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent): void => {
    if (pending && e.pointerId === pending.pointerId) {
      cancelPending();
      return;
    }
    if (!active || active.keyboard || e.pointerId !== active.pointerId) return;
    if (e.type === 'pointerup') place(e.clientX, e.clientY);
    finish(e.type === 'pointerup');
  };
  document.addEventListener('pointermove', onMove, { signal, passive: false });
  document.addEventListener('pointerup', onUp, { signal });
  document.addEventListener('pointercancel', onUp, { signal });
  // Once a touch drag has started, stop the page from scrolling under it.
  document.addEventListener('touchmove', (e: TouchEvent) => {
    if (active && !active.keyboard && e.cancelable) e.preventDefault();
  }, { signal, passive: false });
  // A drag in progress shouldn't also select text or start native drag and drop.
  element.addEventListener('dragstart', e => {
    if (active || pending) e.preventDefault();
  }, { signal });

  // ── Keyboard ─────────────────────────────────────────────────────────────

  element.addEventListener('keydown', (e: KeyboardEvent) => {
    const item = e.target as HTMLElement;
    if (keyboardDragActive || active) return;
    if (!isItem(item, item.parentElement as HTMLElement) || item.parentElement !== element) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const drag = begin(item, true);
      keyboardDragActive = true;
      // Listen on the item itself: it may move into another container of the group.
      item.addEventListener('keydown', onDragKey, { signal });
      item.classList.add(draggingClass);
      item.setAttribute('aria-grabbed', 'true');
      emit(element, 'sortable:start', { item, from: drag.from, oldIndex: drag.oldIndex });
      announce(`Picked up ${label(item)}. Position ${drag.oldIndex + 1} of ${itemsOf(drag.from).length}. Use arrow keys to move, Space to drop, Escape to cancel.`);
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
    let change: (() => void) | null = null;

    switch (e.key) {
      case prevKey:
        if (index > 0) change = () => container.insertBefore(item, items[index - 1]);
        break;
      case nextKey:
        if (index < items.length - 1) change = () => container.insertBefore(item, items[index + 1].nextSibling);
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const other = all[ci + (e.key === 'ArrowLeft' ? -1 : 1)];
        if (!other) break;
        const otherItems = itemsOf(other);
        change = () => other.insertBefore(item, otherItems[Math.min(index, otherItems.length)] ?? null);
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
    if (change) {
      flip([...animated(), item], change, duration);
      const now = item.parentElement as HTMLElement;
      active.container = now;
      active.index = itemsOf(now).indexOf(item);
      emit(element, 'sortable:move', { item, to: now, index: active.index });
    }
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
      cancelPending();
      if (active) finish(false);
      controller.abort();
      mo?.disconnect();
      if (group) groups.get(group)?.delete(element);
      element.classList.remove('is-sortable');
    },
  };
}

mixinRegistry.register('sortable', sortableMixin);
