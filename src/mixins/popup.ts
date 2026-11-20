/**
 * Floating UI in the browser's top layer.
 *
 * Where the Popover API is supported, the element becomes a `popover`, so it
 * renders above everything without z-index, and is never clipped by an
 * `overflow` ancestor (a scrolling table, a dialog, a card). Elsewhere it's a
 * fixed-position element, as before. Either way it's placed next to its
 * anchor by {@link placeFloating}, which flips it to stay on screen and
 * records the side it chose in `data-placement`.
 *
 * The element's `hidden` attribute always mirrors whether it's open, so
 * styles and code that check `hidden` keep working.
 *
 * @module mixins/popup
 */

import { placeFloating, type Placement } from './utils';

export interface PopupOptions {
  /** What to place it next to: an element, or a rect (such as a pointer position). */
  anchor: () => Element | DOMRect;
  placement?: Placement;
  /** Distance from the anchor, in px. */
  gap?: number;
  /**
   * `manual` (the default) stays open until hidden; the caller handles
   * dismissal. `hint` is for tooltips: it never closes other popups.
   */
  mode?: 'manual' | 'hint';
  /** Make it at least as wide as the anchor (for lists under an input). */
  matchWidth?: boolean;
  /** Keep it next to the anchor while the page scrolls or resizes. Default true. */
  follow?: boolean;
}

export interface Popup {
  show(): void;
  hide(): void;
  isOpen(): boolean;
  /** Place it again (after its content or anchor changed size). */
  reposition(): void;
  /** Hide it and remove the popover attribute and listeners. */
  destroy(): void;
}

/** Whether the browser supports the Popover API. */
export function supportsPopover(): boolean {
  return typeof HTMLElement !== 'undefined' && typeof (HTMLElement.prototype as { showPopover?: unknown }).showPopover === 'function';
}

let hintSupported: boolean | null = null;
function supportsHint(): boolean {
  if (hintSupported === null) {
    const probe = document.createElement('div');
    probe.setAttribute('popover', 'hint');
    hintSupported = probe.popover === 'hint';
  }
  return hintSupported;
}

/**
 * The element a popup should live in: inside an open modal `<dialog>` if the
 * anchor is in one (everything outside it is inert), otherwise `<body>`.
 */
export function popupHost(anchor: Element | null): HTMLElement {
  return anchor?.closest<HTMLElement>('dialog[open]') ?? document.body;
}

/** Turn `el` into a popup. It should already be in the document when shown. */
export function attachPopup(el: HTMLElement, options: PopupOptions): Popup {
  const { placement = 'bottom', gap = 8, mode = 'manual', matchWidth = false, follow = true } = options;
  const native = supportsPopover();
  let open = false;
  let frame = 0;
  let listeners: AbortController | null = null;

  el.classList.add('ar-popup');
  el.hidden = true;
  if (native) el.popover = mode === 'hint' && supportsHint() ? 'hint' : 'manual';

  function reposition(): void {
    if (!open) return;
    const anchor = options.anchor();
    const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
    // The UA stylesheet centers popovers with `inset: 0; margin: auto`.
    el.style.inset = 'auto';
    el.style.margin = '0';
    if (matchWidth) el.style.minWidth = `${rect.width}px`;
    placeFloating(el, rect, placement, gap);
  }

  const schedule = (): void => {
    if (frame) return;
    // Mark as scheduled before asking for the frame, in case it runs at once.
    frame = -1;
    const id = requestAnimationFrame(() => {
      frame = 0;
      reposition();
    });
    if (frame === -1) frame = id;
  };

  function show(): void {
    if (open) {
      reposition();
      return;
    }
    open = true;
    el.hidden = false;
    if (native && el.isConnected) {
      try {
        el.showPopover();
      } catch {
        /* already open, or not in the document */
      }
    }
    reposition();
    if (follow) {
      listeners = new AbortController();
      window.addEventListener('scroll', schedule, { signal: listeners.signal, capture: true, passive: true });
      window.addEventListener('resize', schedule, { signal: listeners.signal });
    }
  }

  function hide(): void {
    if (!open) return;
    open = false;
    listeners?.abort();
    listeners = null;
    if (frame > 0) cancelAnimationFrame(frame);
    frame = 0;
    if (native) {
      try {
        el.hidePopover();
      } catch {
        /* not open */
      }
    }
    el.hidden = true;
  }

  return {
    show,
    hide,
    isOpen: () => open,
    reposition,
    destroy: () => {
      hide();
      if (native) el.removeAttribute('popover');
      el.classList.remove('ar-popup');
    },
  };
}
