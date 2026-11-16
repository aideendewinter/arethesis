/**
 * `tooltip`: an accessible tooltip on hover and keyboard focus.
 *
 * Content comes from `content`, `data-tooltip`, or `title` (which is removed
 * while the mixin is active so the browser tooltip doesn't double up).
 * Escape dismisses it. The tooltip is linked via `aria-describedby`.
 *
 * @module mixins/tooltip
 */

import type { MixinInstance, TooltipOptions } from './types';
import { mixinRegistry } from './registry';
import { placeFloating } from './utils';
import { uniqueId } from '../utils/dom';

export function tooltipMixin(element: HTMLElement, options: TooltipOptions = {}): MixinInstance {
  const { placement = 'top', delay = 300 } = options;
  const controller = new AbortController();
  const { signal } = controller;
  const originalTitle = element.getAttribute('title');
  const text = (): string => options.content ?? element.dataset.tooltip ?? originalTitle ?? '';
  if (originalTitle !== null) element.removeAttribute('title');

  const tip = document.createElement('div');
  tip.id = uniqueId('tooltip');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const describedBy = element.getAttribute('aria-describedby');
  element.setAttribute('aria-describedby', [describedBy, tip.id].filter(Boolean).join(' '));

  let timer: ReturnType<typeof setTimeout> | null = null;

  function show(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    const content = text();
    if (!content) return;
    tip.textContent = content;
    if (!tip.isConnected) document.body.appendChild(tip);
    tip.hidden = false;
    placeFloating(tip, element.getBoundingClientRect(), placement);
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(show, delay);
  }

  function hide(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    tip.hidden = true;
  }

  element.addEventListener('pointerenter', schedule, { signal });
  element.addEventListener('pointerleave', hide, { signal });
  element.addEventListener('focus', show, { signal });
  element.addEventListener('blur', hide, { signal });
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !tip.hidden) hide();
  }, { signal });
  window.addEventListener('scroll', hide, { signal, passive: true, capture: true });

  return {
    name: 'tooltip',
    element,
    options: options as Record<string, unknown>,
    show,
    hide,
    /** Change the text. */
    setContent: (value: string) => {
      options.content = value;
      if (!tip.hidden) show();
    },
    destroy: () => {
      hide();
      controller.abort();
      tip.remove();
      if (describedBy) element.setAttribute('aria-describedby', describedBy);
      else element.removeAttribute('aria-describedby');
      if (originalTitle !== null) element.setAttribute('title', originalTitle);
    },
  };
}

mixinRegistry.register('tooltip', tooltipMixin);
