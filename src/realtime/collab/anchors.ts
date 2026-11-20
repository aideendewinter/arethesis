/**
 * Ranges that stay attached to their text while a document is edited
 * (comments, bookmarks, highlights).
 *
 * Text inserted exactly at either end stays outside the range, so typing
 * right after a commented word doesn't extend the comment. Deleting the text
 * collapses the range (`from === to`) rather than removing it, so the comment
 * can still be shown as "on deleted text".
 *
 * @module realtime/collab/anchors
 */

import type { TextOperation } from '../ot/text-operation';

export interface TextRange {
  from: number;
  to: number;
}

/** Map a range through an operation. */
export function transformRange<R extends TextRange>(range: R, op: TextOperation): R {
  return mapRange(range, (i, stickLeft) => op.transformIndex(i, stickLeft));
}

/** Map a range with any index mapping (`stickLeft` is true for the end). */
export function mapRange<R extends TextRange>(range: R, map: (index: number, stickLeft: boolean) => number): R {
  const collapsed = range.from === range.to;
  const from = map(range.from, collapsed);
  const to = collapsed ? from : Math.max(from, map(range.to, true));
  return { ...range, from, to };
}
