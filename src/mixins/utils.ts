/**
 * Helpers shared by the mixins.
 *
 * @module mixins/utils
 * @internal
 */

/** Dispatch a bubbling, cancelable CustomEvent. Returns false if a listener called preventDefault. */
export function emit<T>(element: Element, name: string, detail: T): boolean {
  return element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, cancelable: true }));
}

let liveRegion: HTMLElement | null = null;

/** Announce a message to screen readers. */
export function announce(message: string): void {
  if (typeof document === 'undefined') return;
  if (!liveRegion || !liveRegion.isConnected) {
    liveRegion = document.createElement('div');
    liveRegion.setAttribute('aria-live', 'assertive');
    liveRegion.setAttribute('role', 'status');
    liveRegion.className = 'ar-visually-hidden';
    Object.assign(liveRegion.style, {
      position: 'absolute', width: '1px', height: '1px', overflow: 'hidden',
      clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', margin: '-1px', padding: '0', border: '0',
    });
    document.body.appendChild(liveRegion);
  }
  // Clearing first makes repeated identical messages announce again.
  liveRegion.textContent = '';
  const region = liveRegion;
  setTimeout(() => {
    region.textContent = message;
  }, 30);
}

export type Placement = 'top' | 'bottom' | 'left' | 'right';

/**
 * Position a fixed element next to an anchor rect, flipping to the opposite
 * side when it would leave the viewport, and clamping into view.
 */
export function placeFloating(floating: HTMLElement, anchor: DOMRect, placement: Placement, gap = 8): Placement {
  floating.style.position = 'fixed';
  floating.style.left = '0px';
  floating.style.top = '0px';
  const rect = floating.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits: Record<Placement, boolean> = {
    top: anchor.top - rect.height - gap >= 0,
    bottom: anchor.bottom + rect.height + gap <= vh,
    left: anchor.left - rect.width - gap >= 0,
    right: anchor.right + rect.width + gap <= vw,
  };
  const opposite: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const final = fits[placement] || !fits[opposite[placement]] ? placement : opposite[placement];
  let left: number;
  let top: number;
  switch (final) {
    case 'top':
      left = anchor.left + anchor.width / 2 - rect.width / 2;
      top = anchor.top - rect.height - gap;
      break;
    case 'bottom':
      left = anchor.left + anchor.width / 2 - rect.width / 2;
      top = anchor.bottom + gap;
      break;
    case 'left':
      left = anchor.left - rect.width - gap;
      top = anchor.top + anchor.height / 2 - rect.height / 2;
      break;
    default:
      left = anchor.right + gap;
      top = anchor.top + anchor.height / 2 - rect.height / 2;
  }
  floating.style.left = `${Math.max(4, Math.min(left, vw - rect.width - 4))}px`;
  floating.style.top = `${Math.max(4, Math.min(top, vh - rect.height - 4))}px`;
  floating.dataset.placement = final;
  return final;
}

/** Parse a CSS `translate(x, y)` from an element's inline transform. */
export function readTranslate(element: HTMLElement): { x: number; y: number } {
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(element.style.transform);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}
