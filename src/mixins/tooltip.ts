/**
 * `tooltip`: an accessible tooltip on hover, keyboard focus and touch.
 *
 * Hover, focus and taps come from {@link intentMixin}: it shows after
 * `delay` on hover, at once on focus, and on a tap (a second tap or one
 * elsewhere hides it).
 *
 * Content comes from `content`, `data-tooltip`, or `title` (which is removed
 * while the mixin is active so the browser tooltip doesn't double up).
 * Escape dismisses it. The tooltip is linked via `aria-describedby`.
 *
 * @module mixins/tooltip
 */

import type { MixinInstance, TooltipOptions } from './types';
import { attachPopup, popupHost } from './popup';
import { uniqueId } from '../utils/dom';
import { intentMixin } from './intent';

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
  // A `hint` popover: in the top layer, and it never closes open menus.
  const popup = attachPopup(tip, { anchor: () => element, placement, mode: 'hint', follow: false });
  const describedBy = element.getAttribute('aria-describedby');
  element.setAttribute('aria-describedby', [describedBy, tip.id].filter(Boolean).join(' '));

  function show(): void {
    const content = text();
    if (!content) return;
    tip.textContent = content;
    const host = popupHost(element);
    if (tip.parentElement !== host) host.appendChild(tip);
    if (popup.isOpen()) popup.reposition();
    else popup.show();
  }

  function hide(): void {
    popup.hide();
  }

  const intent = intentMixin(element, { delay, click: false, events: false, onShow: show, onCommit: show, onCancel: hide });
  window.addEventListener('scroll', () => intent.cancel(), { signal, passive: true, capture: true });

  return {
    name: 'tooltip',
    element,
    options: options as Record<string, unknown>,
    show,
    hide: () => {
      intent.cancel();
      hide();
    },
    /** Change the text. */
    setContent: (value: string) => {
      options.content = value;
      if (!tip.hidden) show();
    },
    destroy: () => {
      intent.destroy();
      hide();
      controller.abort();
      popup.destroy();
      tip.remove();
      if (describedBy) element.setAttribute('aria-describedby', describedBy);
      else element.removeAttribute('aria-describedby');
      if (originalTitle !== null) element.setAttribute('title', originalTitle);
    },
  };
}
