/**
 * `draggable`: move an element with mouse, touch, pen or the keyboard.
 *
 * Events: `draggable:start`, `draggable:move`, `draggable:end` (detail: `{ x, y, dx, dy }`).
 * Offsets accumulate across drags; call `instance.reset()` to return home.
 *
 * @module mixins/draggable
 */

import type { DraggableOptions, DragDetail, MixinInstance } from './types';
import { emit, readTranslate } from './utils';

export function draggableMixin(element: HTMLElement, options: DraggableOptions = {}): MixinInstance {
  const { axis = 'both', grid, keyboardStep = 10 } = options;
  const controller = new AbortController();
  const { signal } = controller;
  const handle = (options.handle && element.querySelector<HTMLElement>(options.handle)) || element;

  let offset = readTranslate(element);
  let dragging: { pointerId: number; startX: number; startY: number; base: { x: number; y: number }; bounds: { minX: number; maxX: number; minY: number; maxY: number } | null } | null = null;

  const previousTouchAction = handle.style.touchAction;
  handle.style.touchAction = 'none';
  handle.style.cursor = 'grab';
  if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
  element.classList.add('is-draggable');
  if (!element.getAttribute('aria-roledescription')) element.setAttribute('aria-roledescription', 'draggable');

  function containerRect(): DOMRect | null {
    const c = options.containment;
    if (!c) return null;
    if (c === 'window') return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    if (c === 'parent') return element.parentElement?.getBoundingClientRect() ?? null;
    if (c instanceof HTMLElement) return c.getBoundingClientRect();
    return document.querySelector(c)?.getBoundingClientRect() ?? null;
  }

  function computeBounds(): NonNullable<typeof dragging>['bounds'] {
    const container = containerRect();
    if (!container) return null;
    const rect = element.getBoundingClientRect();
    // Bounds are expressed as allowed total offsets.
    return {
      minX: offset.x + (container.left - rect.left),
      maxX: offset.x + (container.right - rect.right),
      minY: offset.y + (container.top - rect.top),
      maxY: offset.y + (container.bottom - rect.bottom),
    };
  }

  function constrain(x: number, y: number, bounds: ReturnType<typeof computeBounds>): { x: number; y: number } {
    if (axis === 'x') y = dragging?.base.y ?? offset.y;
    if (axis === 'y') x = dragging?.base.x ?? offset.x;
    if (grid) {
      x = Math.round(x / grid[0]) * grid[0];
      y = Math.round(y / grid[1]) * grid[1];
    }
    if (bounds) {
      x = Math.min(Math.max(x, bounds.minX), Math.max(bounds.minX, bounds.maxX));
      y = Math.min(Math.max(y, bounds.minY), Math.max(bounds.minY, bounds.maxY));
    }
    return { x, y };
  }

  function apply(next: { x: number; y: number }): void {
    offset = next;
    element.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  }

  function detail(base: { x: number; y: number }): DragDetail {
    return { x: offset.x, y: offset.y, dx: offset.x - base.x, dy: offset.y - base.y };
  }

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || dragging) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, button, [contenteditable="true"]') && target !== handle) return;
    dragging = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, base: { ...offset }, bounds: computeBounds() };
    handle.setPointerCapture?.(e.pointerId);
    handle.style.cursor = 'grabbing';
    element.classList.add('is-dragging');
    const d = detail(dragging.base);
    options.onStart?.(d);
    emit(element, 'draggable:start', d);
    e.preventDefault();
  }, { signal });

  handle.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    apply(constrain(dragging.base.x + e.clientX - dragging.startX, dragging.base.y + e.clientY - dragging.startY, dragging.bounds));
    const d = detail(dragging.base);
    options.onDrag?.(d);
    emit(element, 'draggable:move', d);
  }, { signal });

  const end = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    const base = dragging.base;
    dragging = null;
    handle.releasePointerCapture?.(e.pointerId);
    handle.style.cursor = 'grab';
    element.classList.remove('is-dragging');
    const d = detail(base);
    options.onEnd?.(d);
    emit(element, 'draggable:end', d);
  };
  handle.addEventListener('pointerup', end, { signal });
  handle.addEventListener('pointercancel', end, { signal });

  element.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target !== element) return;
    const step = e.shiftKey ? keyboardStep * 5 : keyboardStep;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    const base = { ...offset };
    apply(constrain(offset.x + move[0], offset.y + move[1], computeBounds()));
    const d = detail(base);
    options.onEnd?.(d);
    emit(element, 'draggable:end', d);
  }, { signal });

  return {
    name: 'draggable',
    element,
    options: options as Record<string, unknown>,
    /** Current total offset. */
    position: () => ({ ...offset }),
    /** Move back to the original position. */
    reset: () => apply({ x: 0, y: 0 }),
    destroy: () => {
      controller.abort();
      handle.style.touchAction = previousTouchAction;
      handle.style.cursor = '';
      element.classList.remove('is-draggable', 'is-dragging');
    },
  };
}
