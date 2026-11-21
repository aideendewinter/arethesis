/**
 * Layers: what's open on top of the page, in order, so Escape closes the
 * topmost thing and nothing else.
 *
 * Popups (menus, lists, the selection menu) and dialogs register themselves
 * while open; they close themselves on Escape. Register your own panels
 * (a settings sheet, a side drawer) with `pushLayer`, and the shortcut
 * manager closes the top one on Escape before any `Escape` shortcut runs:
 *
 * ```ts
 * const release = pushLayer(sheet, () => closeSheet());
 * // …when the sheet closes by other means:
 * release();
 * ```
 *
 * @module utils/layers
 */

export type LayerKind = 'popup' | 'dialog' | 'app';

export interface Layer {
  readonly element: Element | null;
  readonly kind: LayerKind;
  /** Close it (app layers; popups and dialogs close themselves). */
  readonly close?: () => void;
}

const stack: Layer[] = [];

/** Register an open layer; returns a function that removes it (call it when the layer closes). */
export function pushLayer(element: Element | null, close?: () => void, kind: LayerKind = 'app'): () => void {
  const layer: Layer = { element, close, kind };
  stack.push(layer);
  return () => {
    const i = stack.lastIndexOf(layer);
    if (i >= 0) stack.splice(i, 1);
  };
}

const visible = (layer: Layer): boolean => !layer.element || layer.element.isConnected;

/** The topmost open layer that's in the page, or null. */
export function topLayer(): Layer | null {
  for (let i = stack.length - 1; i >= 0; i--) if (visible(stack[i])) return stack[i];
  return null;
}

/** Every open layer that's in the page, bottom first. */
export function openLayers(): Layer[] {
  return stack.filter(visible);
}
