/**
 * The math behind windowed (virtualized) lists: which items of a long list of
 * equal-height rows need to be in the DOM for what's on screen.
 *
 * @module utils/virtual-window
 */

export interface WindowInput {
  /** Top of the list relative to the top of the visible area, in px (negative once scrolled past). */
  listTop: number;
  /** Height of the visible area, in px. */
  viewport: number;
  /** Height of one item, in px. */
  itemSize: number;
  /** Number of items in the list. */
  count: number;
  /** Extra items to render on each side. */
  overscan: number;
}

/** The items to render: `start` (inclusive) to `end` (exclusive). */
export interface WindowRange {
  start: number;
  end: number;
}

export function computeWindow({ listTop, viewport, itemSize, count, overscan }: WindowInput): WindowRange {
  if (count <= 0) return { start: 0, end: 0 };
  const size = Math.max(1, itemSize);
  const from = Math.max(0, -listTop);
  const to = Math.max(0, viewport - listTop);
  const clamp = (n: number) => Math.max(0, Math.min(count, n));
  const start = clamp(Math.floor(from / size) - overscan);
  const end = Math.max(start, clamp(Math.ceil(to / size) + overscan));
  return { start, end };
}
