import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { intentMixin, type IntentInstance } from '../intent';
import { tooltipMixin } from '../tooltip';

const pointer = (el: Element, type: string, init: PointerEventInit = {}) =>
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: 0, clientY: 0, ...init }));
const touch = (el: Element, type: string, init: PointerEventInit = {}) => pointer(el, type, { pointerType: 'touch', ...init });
const tap = (el: Element, init: PointerEventInit = {}) => {
  touch(el, 'pointerdown', init);
  touch(el, 'pointerup', init);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    // A mouse up with no touch press does nothing.
    pointer($('a'), 'pointerup', { pointerType: 'mouse' });
    expect(log.at(-1)).toBe('cancel:a:outside');
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
