/**
 * `resizable`: resize an element by dragging its edges, or with the arrow keys
 * on a focused handle. Handles are `role="separator"` elements.
 *
 * Works on flex items too: resizing along the main axis fixes the item's
 * flex basis, so the size sticks.
 *
 * Events: `resizable:start`, `resizable:resize`, `resizable:end` (detail `{ width, height }`).
 *
 * @module mixins/resizable
 */

import type { MixinInstance, ResizableOptions } from './types';
import { mixinRegistry } from './registry';
import { emit } from './utils';

type Edge = NonNullable<ResizableOptions['handles']>[number];

export function resizableMixin(element: HTMLElement, options: ResizableOptions = {}): MixinInstance {
  const handles = options.handles ?? ['e', 's', 'se'];
  const { minWidth = 40, minHeight = 24, maxWidth = Infinity, maxHeight = Infinity, keyboardStep = 10 } = options;
  const controller = new AbortController();
  const created: HTMLElement[] = [];
  if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
  element.classList.add('is-resizable');

  const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
  const size = (): { width: number; height: number } => {
    const r = element.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  };

  /**
   * A flex item ignores `width`/`height` along the main axis while it can grow
   * or shrink, so fix its basis to the size being set. In a row it also can't
   * grow wider than its container.
   */
  function flexLimits(changingWidth: boolean, changingHeight: boolean): { maxW: number } {
    const parent = element.parentElement;
    if (!parent) return { maxW: maxWidth };
    const style = getComputedStyle(parent);
    if (!style.display.includes('flex')) return { maxW: maxWidth };
    const row = !style.flexDirection.startsWith('column');
    if ((row && changingWidth) || (!row && changingHeight)) element.style.flex = '0 0 auto';
    const inner = parent.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    return { maxW: row && inner > 0 ? Math.min(maxWidth, inner) : maxWidth };
  }

  function setSize(edge: Edge, width: number, height: number): void {
    const changingWidth = edge.includes('e') || edge.includes('w');
    const changingHeight = edge.includes('n') || edge.includes('s');
    const { maxW } = flexLimits(changingWidth, changingHeight);
    if (changingWidth) element.style.width = `${clamp(width, minWidth, Math.max(minWidth, maxW))}px`;
    if (changingHeight) element.style.height = `${clamp(height, minHeight, maxHeight)}px`;
    const s = size();
    for (const h of created) {
      const e = h.dataset.edge as Edge;
      h.setAttribute('aria-valuenow', String(e === 'e' || e === 'w' ? s.width : s.height));
    }
    options.onResize?.(s);
    emit(element, 'resizable:resize', s);
  }

  for (const edge of handles) {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-handle--${edge}`;
    handle.dataset.edge = edge;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', edge === 'e' || edge === 'w' ? 'vertical' : 'horizontal');
    handle.setAttribute('aria-label', `Resize ${edge === 'e' || edge === 'w' ? 'width' : edge === 'n' || edge === 's' ? 'height' : 'size'}`);
    handle.setAttribute('aria-valuemin', String(edge === 'e' || edge === 'w' ? minWidth : minHeight));
    handle.style.touchAction = 'none';
    element.appendChild(handle);
    created.push(handle);
    const initial = size();
    handle.setAttribute('aria-valuenow', String(edge === 'e' || edge === 'w' ? initial.width : initial.height));

    let start: { x: number; y: number; width: number; height: number; pointerId: number } | null = null;
    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const s = size();
      start = { x: e.clientX, y: e.clientY, ...s, pointerId: e.pointerId };
      handle.setPointerCapture?.(e.pointerId);
      element.classList.add('is-resizing');
      emit(element, 'resizable:start', s);
    }, { signal: controller.signal });
    handle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!start || e.pointerId !== start.pointerId) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      setSize(edge,
        start.width + (edge.includes('e') ? dx : edge.includes('w') ? -dx : 0),
        start.height + (edge.includes('s') ? dy : edge.includes('n') ? -dy : 0));
    }, { signal: controller.signal });
    const end = (e: PointerEvent): void => {
      if (!start || e.pointerId !== start.pointerId) return;
      start = null;
      element.classList.remove('is-resizing');
      const s = size();
      options.onEnd?.(s);
      emit(element, 'resizable:end', s);
    };
    handle.addEventListener('pointerup', end, { signal: controller.signal });
    handle.addEventListener('pointercancel', end, { signal: controller.signal });
    handle.addEventListener('keydown', (e: KeyboardEvent) => {
      const step = e.shiftKey ? keyboardStep * 5 : keyboardStep;
      const s = size();
      const deltas: Record<string, [number, number]> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] };
      const d = deltas[e.key];
      if (!d) return;
      e.preventDefault();
      setSize(edge, s.width + d[0], s.height + d[1]);
      const after = size();
      options.onEnd?.(after);
      emit(element, 'resizable:end', after);
    }, { signal: controller.signal });
  }

  return {
    name: 'resizable',
    element,
    options: options as Record<string, unknown>,
    size,
    destroy: () => {
      controller.abort();
      created.forEach(h => h.remove());
      element.classList.remove('is-resizable', 'is-resizing');
    },
  };
}

mixinRegistry.register('resizable', resizableMixin);
