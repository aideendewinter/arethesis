/**
 * Ranges over the text of an element: by character offset, by word, by
 * search match, and under a point. Pair them with {@link highlighter}, which
 * highlights ranges without changing the page.
 *
 * Offsets count the characters of the element's text nodes in document
 * order (its `textContent`, minus `<script>`, `<style>` and `<template>`).
 * Words and matches may span inline elements: `<b>Hel</b>lo` is one word.
 *
 * @module utils/text-ranges
 */

interface TextIndex {
  text: string;
  nodes: Text[];
  /** Where each node starts in `text`. */
  starts: number[];
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

function indexText(root: Node): TextIndex {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      for (let p = node.parentNode; p && p !== root; p = p.parentNode) {
        if (SKIP.has((p as Element).nodeName)) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(text.length);
    text += (n as Text).data;
  }
  return { text, nodes, starts };
}

/** The node and offset for a character offset; `end` prefers the end of a node over the start of the next. */
function locate(index: TextIndex, offset: number, end: boolean): { node: Text; offset: number } | null {
  const { nodes, starts } = index;
  if (!nodes.length) return null;
  // Binary search for the last node starting at or before `offset`.
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] < offset || (!end && starts[mid] === offset)) lo = mid;
    else hi = mid - 1;
  }
  // Skip empty nodes when looking for a start.
  while (!end && lo < nodes.length - 1 && offset - starts[lo] >= nodes[lo].data.length) lo++;
  const node = nodes[lo];
  return { node, offset: Math.min(Math.max(0, offset - starts[lo]), node.data.length) };
}

function toRange(index: TextIndex, start: number, end: number): Range | null {
  const from = locate(index, start, false);
  const to = locate(index, end, true);
  if (!from || !to) return null;
  const range = from.node.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** A Range over characters `start` to `end` of `root`'s text, or null if it has none. */
export function textRange(root: Node, start: number, end: number): Range | null {
  const index = indexText(root);
  const length = index.text.length;
  const from = Math.max(0, Math.min(start, length));
  return toRange(index, from, Math.max(from, Math.min(end, length)));
}

/** `root`'s text, as the offsets above count it. */
export function textOf(root: Node): string {
  return indexText(root).text;
}

/** The character offset of a DOM position within `root`'s text, or undefined if it isn't in it. */
export function textOffset(root: Node, node: Node, offset: number): number | undefined {
  const index = indexText(root);
  if (node.nodeType === Node.TEXT_NODE) {
    const i = index.nodes.indexOf(node as Text);
    return i >= 0 ? index.starts[i] + offset : undefined;
  }
  if (node !== root && !root.contains(node)) return undefined;
  // An element position: the first text node at or after it.
  const point = (root.ownerDocument ?? (root as Document)).createRange();
  point.setStart(node, offset);
  for (let i = 0; i < index.nodes.length; i++) {
    if (point.comparePoint(index.nodes[i], 0) >= 0) return index.starts[i];
  }
  return index.text.length;
}

export interface WordRangeOptions {
  /** For word boundaries (`Intl.Segmenter`). @default the document's language */
  locale?: string;
}

/**
 * The words in `root`, as Ranges in reading order: what `Intl.Segmenter`
 * counts as words (punctuation and spaces left out), or runs of letters,
 * digits, apostrophes and hyphens where it isn't available.
 */
export function wordRanges(root: Node, options: WordRangeOptions = {}): Range[] {
  const index = indexText(root);
  const ranges: Range[] = [];
  const locale = options.locale ?? (root.ownerDocument?.documentElement.lang || undefined);
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    for (const s of new Segmenter(locale, { granularity: 'word' }).segment(index.text)) {
      if (!s.isWordLike) continue;
      const range = toRange(index, s.index, s.index + s.segment.length);
      if (range) ranges.push(range);
    }
    return ranges;
  }
  for (const m of index.text.matchAll(/[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*/gu)) {
    const range = toRange(index, m.index, m.index + m[0].length);
    if (range) ranges.push(range);
  }
  return ranges;
}

export interface FindOptions {
  /** @default false */
  caseSensitive?: boolean;
  /** Only matches that aren't part of a longer word. @default false */
  wholeWord?: boolean;
  /** Stop after this many. @default 1000 */
  limit?: number;
}

/** Every match of `query` in `root`'s text, as Ranges. */
export function findRanges(root: Node, query: string, options: FindOptions = {}): Range[] {
  if (!query) return [];
  const index = indexText(root);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = options.wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
  const regex = new RegExp(pattern, options.caseSensitive ? 'gu' : 'giu');
  const limit = options.limit ?? 1000;
  const ranges: Range[] = [];
  for (const m of index.text.matchAll(regex)) {
    if (ranges.length >= limit) break;
    const range = toRange(index, m.index, m.index + m[0].length);
    if (range) ranges.push(range);
  }
  return ranges;
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** The DOM position under a viewport point (where a click would put the caret), or null. */
export function caretAt(x: number, y: number, doc: Document = document): { node: Node; offset: number } | null {
  const d = doc as CaretDocument;
  if (typeof d.caretPositionFromPoint === 'function') {
    const pos = d.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  if (typeof d.caretRangeFromPoint === 'function') {
    const range = d.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

function inRect(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * The range under a viewport point, from `ranges`. Highlights can't receive
 * pointer events, so this is how a tap finds its word. Checks the ranges'
 * boxes, then where the caret would go.
 */
export function rangeAtPoint(ranges: Iterable<Range>, x: number, y: number): Range | null {
  const list = Array.from(ranges);
  for (const range of list) {
    for (const rect of Array.from(range.getClientRects())) if (inRect(rect, x, y)) return range;
  }
  const caret = caretAt(x, y, list[0]?.startContainer.ownerDocument ?? document);
  if (!caret) return null;
  for (const range of list) {
    try {
      // The end boundary itself belongs to the next range.
      if (range.isPointInRange(caret.node, caret.offset) && !(caret.node === range.endContainer && caret.offset === range.endOffset)) return range;
    } catch {
      /* a different document */
    }
  }
  return null;
}
