import { afterEach, describe, expect, it, vi } from 'vitest';
import { highlighter, supportsHighlights } from '../highlight';
import { caretAt, findRanges, rangeAtPoint, textOf, textOffset, textRange, wordRanges } from '../text-ranges';

function passage(markup: string): HTMLElement {
  document.body.innerHTML = `<p id="p">${markup}</p>`;
  return document.getElementById('p')!;
}

describe('text ranges', () => {
  it('maps character offsets to ranges and back, across elements', () => {
    const p = passage('Sing, <b>god</b>dess, the <i>an</i>ger<script>x()</script>');
    expect(textOf(p)).toBe('Sing, goddess, the anger');
    const range = textRange(p, 6, 13)!;
    expect(range.toString()).toBe('goddess');
    expect(range.startContainer.parentElement!.tagName).toBe('B');
    expect(textOffset(p, range.endContainer, range.endOffset)).toBe(13);
    expect(textOffset(p, p, 1)).toBe(6); // before <b>
    expect(textOffset(p, p, p.childNodes.length)).toBe(24);
    expect(textOffset(p, document.body, 0)).toBeUndefined();
    expect(textOffset(p, document.createTextNode('x'), 0)).toBeUndefined();
    expect(textRange(p, -5, 4)!.toString()).toBe('Sing');
    expect(textRange(p, 20, 999)!.toString()).toBe('nger');
    expect(textRange(document.createElement('div'), 0, 1)).toBeNull();
  });

  it('finds words, leaving out punctuation and spaces', () => {
    const p = passage(`Rosy-fingered <em>Daw</em>n — “it's” 2 東京タワー.`);
    const words = wordRanges(p).map(r => r.toString());
    expect(words.slice(0, 5)).toEqual(['Rosy', 'fingered', 'Dawn', "it's", '2']);
    expect(words.join('')).toContain('東京');
    // The fallback without Intl.Segmenter keeps hyphens and apostrophes.
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    expect(wordRanges(p).map(r => r.toString())).toEqual(['Rosy-fingered', 'Dawn', "it's", '2', '東京タワー']);
    vi.unstubAllGlobals();
  });

  it('finds matches, optionally by case and whole word', () => {
    const p = passage('Ares and <b>ar</b>es, AREs of Sp<i>ar</i>ta');
    expect(findRanges(p, 'ares').map(r => r.toString())).toEqual(['Ares', 'ares', 'AREs']);
    expect(findRanges(p, 'ar', { wholeWord: true })).toEqual([]);
    expect(findRanges(p, 'ar', { caseSensitive: true }).length).toBe(2);
    expect(findRanges(p, 'ar', { limit: 1 }).length).toBe(1);
    expect(findRanges(p, '')).toEqual([]);
    expect(findRanges(p, 'a.d')).toEqual([]); // not a pattern
  });

  it('finds the range under a point', () => {
    const p = passage('one two three');
    const words = wordRanges(p);
    vi.spyOn(words[1], 'getClientRects').mockReturnValue([new DOMRect(40, 0, 30, 20)] as unknown as DOMRectList);
    expect(rangeAtPoint(words, 50, 10)).toBe(words[1]);
    // From the caret, where the boxes don't say.
    const text = p.firstChild!;
    (document as unknown as { caretRangeFromPoint: unknown }).caretRangeFromPoint = () => {
      const r = document.createRange();
      r.setStart(text, 9);
      return r;
    };
    expect(caretAt(0, 0)).toEqual({ node: text, offset: 9 });
    expect(rangeAtPoint(words, 0, 0)).toBe(words[2]);
    delete (document as unknown as { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
    (document as unknown as { caretPositionFromPoint: unknown }).caretPositionFromPoint = () => ({ offsetNode: text, offset: 3 });
    expect(rangeAtPoint(words, 0, 0)).toBeNull(); // the end of "one" is a space away from anything
    (document as unknown as { caretPositionFromPoint: unknown }).caretPositionFromPoint = () => null;
    expect(caretAt(0, 0)).toBeNull();
    delete (document as unknown as { caretPositionFromPoint?: unknown }).caretPositionFromPoint;
    expect(rangeAtPoint(words, 0, 0)).toBeNull();
  });
});

describe('highlighter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wraps ranges in marks without the Highlight API, and leaves the page as it was', () => {
    expect(supportsHighlights()).toBe(false);
    const p = passage('Sing, <b>god</b>dess, the anger of Achilles');
    const before = p.innerHTML;
    const words = wordRanges(p);
    const h = highlighter('reading');
    expect(h.native).toBe(false);
    h.set([words[1]]);
    expect(Array.from(p.querySelectorAll('mark'), m => m.textContent)).toEqual(['god', 'dess']);
    expect(p.querySelector('mark')!.className).toBe('ar-highlight');
    expect(p.querySelector('mark')!.dataset.highlight).toBe('reading');
    expect(textOf(p)).toBe('Sing, goddess, the anger of Achilles');
    // The highlighted range still covers its word.
    expect(words[1].toString()).toBe('goddess');
    // happy-dom doesn't move live ranges on splitText as browsers do, so get the rest afresh.
    const anger = textRange(p, 19, 24)!;
    words[3] = anger;
    h.add(words[3], words[3]);
    expect(h.ranges).toEqual([words[1], words[3]]);
    expect(h.has(words[3])).toBe(true);
    expect(p.querySelectorAll('mark').length).toBe(3);
    h.delete(words[1]);
    h.delete(words[1]);
    expect(Array.from(p.querySelectorAll('mark'), m => m.textContent)).toEqual(['anger']);
    expect(words[1].toString()).toBe('goddess');
    words[5] = textRange(p, 28, 36)!;
    h.set([words[5]]);
    expect(p.querySelector('mark')!.textContent).toBe('Achilles');
    h.destroy();
    expect(p.innerHTML).toBe(before);
    expect(words[5].toString()).toBe('Achilles');
  });

  it('handles overlaps, collapsed ranges and single text nodes', () => {
    const p = passage('abcdef');
    const h = highlighter('a');
    const collapsed = textRange(p, 2, 2)!;
    h.set([textRange(p, 1, 4)!, textRange(p, 2, 5)!, collapsed]);
    expect(textOf(p)).toBe('abcdef');
    expect(Array.from(p.querySelectorAll('mark'), m => m.textContent).join('|')).toBe('bcd|cd|e');
    h.clear();
    expect(p.innerHTML).toBe('abcdef');
  });

  it("does nothing without the API when fallback is 'none'", () => {
    const p = passage('one two');
    const h = highlighter('x', { fallback: 'none' });
    h.set(wordRanges(p));
    expect(p.innerHTML).toBe('one two');
  });

  it('uses CSS.highlights when there is one', () => {
    class FakeHighlight extends Set<AbstractRange> {
      priority = 0;
      type = 'highlight';
    }
    const highlights = new Map<string, FakeHighlight>();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { highlights });
    expect(supportsHighlights()).toBe(true);
    const p = passage('one two three');
    const words = wordRanges(p);
    const h = highlighter('search', { priority: 2, type: 'spelling-error' });
    expect(h.native).toBe(true);
    h.set([words[0], words[2]]);
    const native = highlights.get('search')!;
    expect([...native]).toEqual([words[0], words[2]]);
    expect(native.priority).toBe(2);
    expect(native.type).toBe('spelling-error');
    expect(p.innerHTML).toBe('one two three');
    h.delete(words[0]);
    expect([...native]).toEqual([words[2]]);
    // A newer highlighter with the same name keeps it on destroy of the old one.
    const other = highlighter('search');
    h.destroy();
    expect(highlights.has('search')).toBe(true);
    other.destroy();
    expect(highlights.has('search')).toBe(false);
  });
});
