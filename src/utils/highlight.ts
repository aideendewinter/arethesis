/**
 * `highlighter`: highlight ranges of text without changing the page.
 *
 * ```ts
 * const reading = highlighter('reading');
 * const words = wordRanges(passage);
 * reading.set([words[12]]);
 * ```
 * ```css
 * ::highlight(reading), .ar-highlight[data-highlight=reading] { background: var(--ar-color-accent-subtle); }
 * ```
 *
 * It uses the CSS Custom Highlight API, so copying, selection, find-in-page
 * and screen readers see the page exactly as it was. Where the API is
 * missing, the ranges' text is wrapped in
 * `<mark class="ar-highlight" data-highlight="name">` and unwrapped again
 * on change (`fallback: 'none'` skips that), and the highlighted Range
 * objects are moved to match. Style both selectors.
 *
 * One highlighter per name: a second one with the same name replaces the
 * first's native highlight.
 *
 * @module utils/highlight
 */

import { textOffset, textRange } from './text-ranges';

export interface HighlighterOptions {
  /** Which highlight wins where two overlap (higher on top). Native only. @default 0 */
  priority?: number;
  /** Without the Highlight API: wrap in `<mark>` elements, or show nothing. @default 'mark' */
  fallback?: 'mark' | 'none';
  /** The highlight's type, for spelling and grammar styles. Native only. @default 'highlight' */
  type?: 'highlight' | 'spelling-error' | 'grammar-error';
}

export interface Highlighter {
  readonly name: string;
  /** True when it uses the native API. */
  readonly native: boolean;
  /** The highlighted ranges, in the order they were added. */
  readonly ranges: Range[];
  set(ranges: Iterable<Range>): void;
  add(...ranges: Range[]): void;
  delete(range: Range): void;
  has(range: Range): boolean;
  clear(): void;
  /** Clear it and give up the name. */
  destroy(): void;
}

interface HighlightLike {
  priority: number;
  type?: string;
  add(range: AbstractRange): unknown;
  clear(): void;
}

type HighlightRegistryLike = Map<string, HighlightLike>;

function registry(): HighlightRegistryLike | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistryLike } }).CSS;
  return css?.highlights && typeof (globalThis as { Highlight?: unknown }).Highlight === 'function' ? css.highlights : null;
}

/** True when the browser has the CSS Custom Highlight API. */
export function supportsHighlights(): boolean {
  return registry() !== null;
}

export function highlighter(name: string, options: HighlighterOptions = {}): Highlighter {
  const { priority = 0, fallback = 'mark', type = 'highlight' } = options;
  const registered = registry();
  const ranges: Range[] = [];
  let native: HighlightLike | null = null;
  let marks: HTMLElement[] = [];
  let rendered: Range[] = [];

  if (registered) {
    const HighlightCtor = (globalThis as unknown as { Highlight: new () => HighlightLike }).Highlight;
    native = new HighlightCtor();
    native.priority = priority;
    native.type = type;
    registered.set(name, native);
  }

  function render(): void {
    if (native) {
      native.clear();
      for (const range of ranges) native.add(range);
      return;
    }
    if (fallback === 'none') return;
    // Wrapping moves text nodes, so remember each range as text offsets
    // within an element outside the marks, and put the ranges back after.
    // Ranges just removed sit in marks too: put them back as well.
    const all = [...new Set([...rendered, ...ranges])];
    rendered = [...ranges];
    const spots = all.flatMap(range => {
      let root: Node | null = range.commonAncestorContainer;
      if (root.nodeType !== Node.ELEMENT_NODE) root = root.parentNode;
      // A range whose text is gone from the page has nothing to highlight.
      if (!root?.isConnected) return [];
      while ((root as Element).closest('mark.ar-highlight') && root.parentNode) root = root.parentNode;
      return {
        range,
        root,
        start: textOffset(root, range.startContainer, range.startOffset) ?? 0,
        end: textOffset(root, range.endContainer, range.endOffset) ?? 0,
      };
    });
    unwrap();
    for (const spot of spots) {
      if (!ranges.includes(spot.range)) continue;
      const range = textRange(spot.root, spot.start, spot.end);
      if (range) wrap(range);
    }
    for (const spot of spots) {
      const range = textRange(spot.root, spot.start, spot.end);
      if (!range) continue;
      spot.range.setStart(range.startContainer, range.startOffset);
      spot.range.setEnd(range.endContainer, range.endOffset);
    }
  }

  function unwrap(): void {
    const parents = new Set<Node>();
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parents.add(parent);
    }
    marks = [];
    for (const parent of parents) parent.normalize();
  }

  function wrap(range: Range): void {
    if (range.collapsed) return;
    const doc = range.startContainer.ownerDocument!;
    const root = range.commonAncestorContainer;
    const texts: Text[] = [];
    if (root.nodeType === Node.TEXT_NODE) texts.push(root as Text);
    else {
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (range.intersectsNode(n)) texts.push(n as Text);
    }
    for (let text of texts) {
      const start = text === range.startContainer ? range.startOffset : 0;
      const end = text === range.endContainer ? range.endOffset : text.data.length;
      if (end <= start) continue;
      // Split off the part outside the range (live ranges follow the split).
      if (end < text.data.length) text.splitText(end);
      if (start > 0) text = text.splitText(start);
      const mark = doc.createElement('mark');
      mark.className = 'ar-highlight';
      mark.dataset.highlight = name;
      text.replaceWith(mark);
      mark.append(text);
      marks.push(mark);
    }
  }

  return {
    name,
    native: native !== null,
    get ranges() {
      return [...ranges];
    },
    set(next) {
      ranges.length = 0;
      ranges.push(...next);
      render();
    },
    add(...more) {
      for (const range of more) if (!ranges.includes(range)) ranges.push(range);
      render();
    },
    delete(range) {
      const i = ranges.indexOf(range);
      if (i < 0) return;
      ranges.splice(i, 1);
      render();
    },
    has: range => ranges.includes(range),
    clear() {
      ranges.length = 0;
      render();
    },
    destroy() {
      this.clear();
      if (registered && native && registered.get(name) === native) registered.delete(name);
    },
  };
}
