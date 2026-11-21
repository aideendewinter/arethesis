import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { intentMixin, type IntentInstance } from '../intent';
import { tooltipMixin } from '../tooltip';
import { wordRanges } from '../../utils/text-ranges';

const pointer = (el: Element, type: string, init: PointerEventInit = {}) =>
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: 0, clientY: 0, ...init }));
const touch = (el: Element, type: string, init: PointerEventInit = {}) => pointer(el, type, { pointerType: 'touch', ...init });
const tap = (el: Element, init: PointerEventInit = {}) => {
  touch(el, 'pointerdown', init);
  touch(el, 'pointerup', init);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  vi.advanceTimersByTime(0); // the commit runs just after the click
};

function setup(options = {}) {
  document.body.innerHTML = `<p id="p"><span class="t" id="a">alpha <b>bold</b></span> and <span class="t" id="b">beta</span> <button class="t" id="c">c</button></p><div id="out">outside</div>`;
  const host = document.getElementById('p')!;
  const log: string[] = [];
  for (const type of ['show', 'commit', 'cancel']) {
    host.addEventListener(`intent:${type}`, e => {
      const d = (e as CustomEvent).detail;
      log.push(`${type}:${d.target.id}:${d.via ?? d.reason}`);
    });
  }
  const m = intentMixin(host, { selector: '.t', ...options }) as IntentInstance;
  const $ = (id: string) => document.getElementById(id)!;
  return { host, log, m, $ };
}

describe('intent', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('shows on hover after the delay, switches at once, and cancels on leave', () => {
    const { log, $, m } = setup();
    pointer($('a'), 'pointerover', { pointerType: 'mouse' });
    vi.advanceTimersByTime(279);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(log).toEqual(['show:a:hover']);
    // Moving within the target isn't leaving it.
    pointer($('a').querySelector('b')!, 'pointerover', { relatedTarget: $('a') });
    pointer($('a'), 'pointerout', { relatedTarget: $('a').querySelector('b') });
    pointer($('a'), 'pointerout', { relatedTarget: $('p') });
    pointer($('b'), 'pointerover', { relatedTarget: $('p') });
    expect(log).toEqual(['show:a:hover', 'cancel:a:moved', 'show:b:hover']);
    expect(m.active()).toEqual({ target: $('b'), committed: false });
    pointer($('b'), 'pointerout', { relatedTarget: $('p') });
    vi.advanceTimersByTime(149);
    pointer($('b'), 'pointerover', { relatedTarget: $('p') }); // came back in time
    vi.advanceTimersByTime(500);
    expect(log.at(-1)).toBe('show:b:hover');
    pointer($('b'), 'pointerout', { relatedTarget: $('p') });
    vi.advanceTimersByTime(150);
    expect(log.at(-1)).toBe('cancel:b:leave');
    // Leaving before the delay shows nothing.
    pointer($('a'), 'pointerover', { relatedTarget: $('p') });
    pointer($('a'), 'pointerout', { relatedTarget: $('p') });
    vi.advanceTimersByTime(1000);
    expect(log.at(-1)).toBe('cancel:b:leave');
    expect(m.active()).toBeNull();
  });

  it('commits on click, keeps the commit while hovering others, and cancels outside', () => {
    const { log, $ } = setup();
    $('a').click();
    pointer($('b'), 'pointerover', { relatedTarget: $('p') });
    vi.advanceTimersByTime(1000);
    pointer($('a'), 'pointerout', { relatedTarget: $('p') });
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['commit:a:click']);
    $('b').click();
    expect(log).toEqual(['commit:a:click', 'cancel:a:moved', 'commit:b:click']);
    $('b').click();
    expect(log.at(-1)).toBe('cancel:b:toggle');
    $('a').click();
    pointer($('out'), 'pointerdown', { pointerType: 'mouse' });
    expect(log.at(-1)).toBe('cancel:a:outside');
    // A click elsewhere in the host isn't on a target.
    $('p').click();
    expect(log.at(-1)).toBe('cancel:a:outside');
  });

  it('tells a tap from a swipe, a long press and a selection', () => {
    const { log, $ } = setup();
    tap($('a'));
    expect(log).toEqual(['commit:a:tap']);
    // The finger lifting doesn't cancel it.
    touch($('a'), 'pointerout', { relatedTarget: null });
    touch($('a'), 'pointerleave');
    tap($('b'));
    expect(log).toEqual(['commit:a:tap', 'cancel:a:moved', 'commit:b:tap']);
    tap($('b'));
    expect(log.at(-1)).toBe('cancel:b:toggle');
    const before = log.length;
    // A swipe.
    touch($('a'), 'pointerdown', { clientX: 0, clientY: 0 });
    touch($('a'), 'pointermove', { clientX: 0, clientY: 30 });
    touch($('a'), 'pointerup', { clientX: 0, clientY: 30 });
    // The browser took over (scrolling).
    touch($('a'), 'pointerdown');
    document.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch' }));
    touch($('a'), 'pointerup');
    // A long press.
    touch($('a'), 'pointerdown');
    vi.advanceTimersByTime(600);
    touch($('a'), 'pointerup');
    // A text selection.
    touch($('a'), 'pointerdown');
    const range = document.createRange();
    range.selectNodeContents($('a'));
    document.getSelection()!.addRange(range);
    touch($('a'), 'pointerup');
    document.getSelection()!.removeAllRanges();
    expect(log.length).toBe(before);
    // A tap outside cancels a commit.
    tap($('a'));
    tap($('out'));
    expect(log.slice(-2)).toEqual(['commit:a:tap', 'cancel:a:outside']);
    // Without a click after the tap, it still commits, a moment later.
    touch($('b'), 'pointerdown');
    touch($('b'), 'pointerup');
    expect(log.at(-1)).toBe('cancel:a:outside');
    vi.advanceTimersByTime(350);
    expect(log.at(-1)).toBe('commit:b:tap');
    // A mouse up with no touch press does nothing.
    pointer($('a'), 'pointerup', { pointerType: 'mouse' });
    expect(log.at(-1)).toBe('commit:b:tap');
  });

  it('shows on focus, commits on Enter, and cancels on blur and Escape', () => {
    const { log, $, m } = setup();
    $('a').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    $('a').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: $('b') }));
    expect(log).toEqual(['show:a:focus', 'cancel:a:blur']);
    $('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(log.at(-1)).toBe('commit:a:key');
    // Buttons have their own Enter.
    $('c').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    $('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    $('p').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(log.at(-1)).toBe('commit:a:key');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(log.at(-1)).toBe('cancel:a:escape');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(log.at(-1)).toBe('cancel:a:escape');
    m.commit($('b'));
    m.commit($('b'));
    m.cancel();
    expect(log.slice(-2)).toEqual(['commit:b:key', 'cancel:b:api']);
    m.destroy();
    $('a').click();
    expect(log.at(-1)).toBe('cancel:b:api');
  });

  it('works on the host without a selector, with callbacks and without events', () => {
    document.body.innerHTML = '<button id="h">h</button>';
    const host = document.getElementById('h')!;
    const onShow = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const events = vi.fn();
    host.addEventListener('intent:show', events);
    const m = intentMixin(host, { delay: 50, click: false, events: false, onShow, onCommit, onCancel });
    host.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(50);
    expect(onShow).toHaveBeenCalledWith(host, 'hover');
    host.dispatchEvent(new PointerEvent('pointerleave'));
    vi.advanceTimersByTime(150);
    expect(onCancel).toHaveBeenCalledWith(host, 'leave');
    host.click();
    expect(onCommit).not.toHaveBeenCalled();
    host.dispatchEvent(new FocusEvent('focus'));
    host.dispatchEvent(new FocusEvent('blur'));
    expect(onCancel).toHaveBeenLastCalledWith(host, 'blur');
    tap(host);
    expect(onCommit).toHaveBeenCalledWith(host, 'tap');
    expect(events).not.toHaveBeenCalled();
    m.destroy();
  });
});

describe('tooltip on touch', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('shows on a tap and hides on a second tap or one elsewhere', () => {
    document.body.innerHTML = '<button id="b" title="Bold">B</button><p id="o">o</p>';
    const btn = document.getElementById('b')!;
    const m = tooltipMixin(btn);
    tap(btn);
    const tip = document.getElementById(btn.getAttribute('aria-describedby')!)!;
    expect(tip.hidden).toBe(false);
    tap(btn);
    expect(tip.hidden).toBe(true);
    tap(btn);
    tap(document.getElementById('o')!);
    expect(tip.hidden).toBe(true);
    tap(btn);
    (m.hide as () => void)();
    expect(tip.hidden).toBe(true);
    window.dispatchEvent(new Event('scroll'));
    m.destroy();
  });
});

describe('intent on text ranges', () => {
  type CaretDoc = { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as unknown as CaretDoc).caretPositionFromPoint;
  });

  // Word i is laid out at x = 50i to 50i + 40, y 0 to 20; between them is space.
  function setup(options = {}, fresh = false) {
    document.body.innerHTML = '<p id="p">alpha beta gamma delta</p><div id="out">out</div>';
    const host = document.getElementById('p')!;
    const text = host.firstChild as Text;
    const starts = [0, 6, 11, 17];
    const lengths = [5, 4, 5, 5];
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
      const i = starts.indexOf(this.startOffset);
      return (i < 0 || this.startContainer !== text ? [] : [new DOMRect(50 * i, 0, 40, 20)]) as unknown as DOMRectList;
    });
    (document as unknown as CaretDoc).caretPositionFromPoint = x => {
      const i = Math.min(3, Math.floor(x / 50));
      const inWord = x - 50 * i <= 40;
      return { offsetNode: text, offset: starts[i] + (inWord ? Math.min(lengths[i], Math.round((x - 50 * i) / 8)) : lengths[i]) };
    };
    const words = wordRanges(host);
    const log: string[] = [];
    for (const type of ['show', 'commit', 'cancel']) {
      host.addEventListener(`intent:${type}`, e => {
        const d = (e as CustomEvent).detail;
        log.push(`${type}:${String(d.target)}:${d.via ?? d.reason}`);
      });
    }
    const m = intentMixin(host, { ranges: fresh ? () => wordRanges(host) : words, ...options });
    const at = (x: number, type = 'pointermove', init: PointerEventInit = {}) =>
      host.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: x, clientY: 10, ...init }));
    const clickAt = (x: number, init: MouseEventInit = {}) => {
      at(x, 'pointerdown');
      host.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: 10, detail: 1, ...init }));
    };
    return { host, words, log, m, at, clickAt };
  }

  it('shows the word under the pointer, switches at once, and cancels in the gaps', () => {
    const { log, at, m, words } = setup();
    at(10);
    vi.advanceTimersByTime(280);
    expect(log).toEqual(['show:alpha:hover']);
    at(20); // the same word
    at(45); // the gap: leaving, but the next word within the grace shows at once
    at(60);
    expect(log).toEqual(['show:alpha:hover', 'cancel:alpha:moved', 'show:beta:hover']);
    expect(m.active()).toEqual({ target: words[1], committed: false });
    at(95);
    vi.advanceTimersByTime(150);
    expect(log.at(-1)).toBe('cancel:beta:leave');
    at(110);
    document.getElementById('p')!.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(1000);
    expect(log.at(-1)).toBe('cancel:beta:leave');
    // Touch moves don't hover.
    at(10, 'pointermove', { pointerType: 'touch' });
    vi.advanceTimersByTime(1000);
    expect(log.at(-1)).toBe('cancel:beta:leave');
  });

  it('commits on click, but not after a selection or on a double click', () => {
    const { log, clickAt, at, words } = setup({}, true);
    clickAt(110);
    expect(log).toEqual(['commit:gamma:click']);
    // A recomputed list still matches the same word.
    clickAt(105);
    expect(log.at(-1)).toBe('cancel:gamma:toggle');
    clickAt(10);
    clickAt(10, { detail: 2 });
    expect(log.at(-1)).toBe('commit:alpha:click');
    at(60, 'pointerdown');
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p')!);
    document.getSelection()!.addRange(range);
    document.getElementById('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 160, clientY: 10, detail: 1 }));
    document.getSelection()!.removeAllRanges();
    expect(log.at(-1)).toBe('commit:alpha:click');
    // A click in a gap isn't on a word; the press there cancels.
    clickAt(45);
    expect(log.at(-1)).toBe('cancel:alpha:outside');
    void words;
  });

  it('commits a tapped word and hit-tests by boxes without a caret API', () => {
    const { log, at } = setup();
    delete (document as unknown as CaretDoc).caretPositionFromPoint;
    at(160, 'pointerdown', { pointerType: 'touch' });
    at(160, 'pointerup', { pointerType: 'touch' });
    vi.advanceTimersByTime(350);
    expect(log).toEqual(['commit:delta:tap']);
    // A caret outside the host finds nothing.
    (document as unknown as CaretDoc).caretPositionFromPoint = () => ({ offsetNode: document.getElementById('out')!.firstChild!, offset: 0 });
    at(160, 'pointerdown', { pointerType: 'touch' });
    at(160, 'pointerup', { pointerType: 'touch' });
    vi.advanceTimersByTime(350);
    expect(log.at(-1)).toBe('cancel:delta:outside');
  });

  it('moves between words from the keyboard', () => {
    const { host, log, m } = setup();
    expect(host.tabIndex).toBe(0);
    const key = (k: string, init: KeyboardEventInit = {}) => host.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
    key('Enter'); // nothing active yet
    key('ArrowLeft');
    expect(log).toEqual(['show:delta:focus']);
    key('Home');
    key('ArrowRight');
    key('ArrowRight', { ctrlKey: true });
    expect(log.slice(-2)).toEqual(['cancel:alpha:moved', 'show:beta:focus']);
    key('Enter');
    expect(log.at(-1)).toBe('commit:beta:key');
    // While committed, the commit moves.
    key('End');
    expect(log.slice(-2)).toEqual(['cancel:beta:moved', 'commit:delta:key']);
    key('ArrowRight');
    key('x');
    expect(log.at(-1)).toBe('commit:delta:key');
    m.cancel();
    key('ArrowLeft');
    host.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(log.slice(-2)).toEqual(['show:gamma:focus', 'cancel:gamma:blur']);
    m.destroy();
    expect(host.hasAttribute('tabindex')).toBe(false);
  });

  it('leaves the host alone with keyboard: false, or when it is already focusable', () => {
    const { host, m } = setup({ keyboard: false });
    expect(host.hasAttribute('tabindex')).toBe(false);
    m.destroy();
    document.body.innerHTML = '<p tabindex="-1">a b</p>';
    const p = document.querySelector('p')!;
    const ranges: Range[] = [];
    intentMixin(p, { ranges: () => ranges }).destroy();
    expect(p.getAttribute('tabindex')).toBe('-1');
  });
});
