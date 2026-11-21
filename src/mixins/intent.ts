/**
 * `intent`: what the user means by hovering, tapping and focusing, as three
 * events: show, commit and cancel. For tooltips, glosses, previews and
 * anything else that appears on hover and sticks on tap.
 *
 * ```ts
 * intentMixin(passage, { selector: '.term' });
 * passage.addEventListener('intent:show', e => preview(e.detail.target));
 * passage.addEventListener('intent:commit', e => pin(e.detail.target));
 * passage.addEventListener('intent:cancel', e => clear(e.detail.target));
 * ```
 *
 * Targets are elements (the host, or those matching `selector`), or text
 * Ranges (`ranges`), so words can be targets without wrapping each in a span.
 *
 * - **Mouse and pen:** resting on a target for `delay` ms shows it, and
 *   leaving cancels. Once one is shown, moving to the next shows it at once.
 *   A click commits (unless `click: false`), but not a click that ends a text
 *   selection, or the second click of a double click.
 * - **Touch:** a tap commits, but not a swipe, a scroll, a long press or a
 *   text selection. Tapping another target moves the commit there; tapping
 *   the same one again, or outside, cancels it. The pointer leaving is
 *   ignored, since a finger lifting always "leaves".
 * - **Keyboard:** focus shows and blur cancels; Enter commits (on targets
 *   that aren't buttons, links or fields, which have their own Enter);
 *   Escape cancels. With `ranges`, the host is focusable and the arrow keys,
 *   Home and End move from range to range.
 *
 * One target is active at a time. Events bubble from the host with
 * `{ target, via }` (`hover`, `focus`, `click`, `tap`, `key`) or, for
 * cancel, `{ target, reason }` (`leave`, `blur`, `moved`, `toggle`,
 * `outside`, `escape`, `api`).
 *
 * @module mixins/intent
 */

import type { MixinInstance } from './types';
import { emit } from './utils';
import { caretAt } from '../utils/text-ranges';

export type IntentVia = 'hover' | 'focus' | 'click' | 'tap' | 'key';
export type IntentCancelReason = 'leave' | 'blur' | 'moved' | 'toggle' | 'outside' | 'escape' | 'api';
export type IntentTarget = HTMLElement | Range;

export interface IntentOptions<T extends IntentTarget = HTMLElement> {
  /** Targets inside the host (delegated). @default the host itself */
  selector?: string;
  /**
   * Text ranges as the targets instead of elements, in reading order: the
   * words from `wordRanges()`, say. A function is called on every pointer
   * move, so return a list you keep, not a new one each time.
   */
  ranges?: Iterable<Range> | (() => Iterable<Range>);
  /** With `ranges`: make the host focusable, with arrow keys, Home and End moving between ranges. @default true */
  keyboard?: boolean;
  /** Hover time before showing, in ms. @default 280 */
  delay?: number;
  /** How long a shown target survives the pointer leaving, so moving to the next one is instant. @default 150 */
  grace?: number;
  /** How far a finger may move and still tap, in px. @default 10 */
  tolerance?: number;
  /** A press longer than this (ms) isn't a tap. @default 500 */
  longPress?: number;
  /** Mouse clicks commit. @default true */
  click?: boolean;
  /** Dispatch the `intent:*` events (the callbacks run either way). @default true */
  events?: boolean;
  onShow?(target: T, via: IntentVia): void;
  onCommit?(target: T, via: IntentVia): void;
  onCancel?(target: T, reason: IntentCancelReason): void;
}

export interface IntentInstance<T extends IntentTarget = HTMLElement> extends MixinInstance {
  /** The active target and whether it's committed, or null. */
  active(): { target: T; committed: boolean } | null;
  commit(target: T): void;
  cancel(): void;
}

const OWN_ENTER = 'a[href], button, input, select, textarea, summary, [contenteditable=""], [contenteditable="true"]';
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

const isRange = (t: IntentTarget | null): t is Range => typeof (t as Range | null)?.compareBoundaryPoints === 'function';

/** The same target: the same element, or ranges with the same boundaries (so a recomputed word list still matches). */
function same(a: IntentTarget | null, b: IntentTarget | null): boolean {
  if (a === b) return true;
  if (!isRange(a) || !isRange(b)) return false;
  try {
    return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0;
  } catch {
    return false; // different documents
  }
}

const connected = (t: IntentTarget): boolean => (isRange(t) ? t.startContainer.isConnected && !t.collapsed : t.isConnected);

function under(range: Range, x: number, y: number): boolean {
  for (const r of Array.from(range.getClientRects())) {
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

export function intentMixin(element: HTMLElement, options: IntentOptions<Range> & { ranges: NonNullable<IntentOptions['ranges']> }): IntentInstance<Range>;
export function intentMixin(element: HTMLElement, options?: IntentOptions): IntentInstance;
export function intentMixin(element: HTMLElement, options: IntentOptions<IntentTarget> = {}): IntentInstance<IntentTarget> {
  const { selector, ranges, keyboard = true, delay = 280, grace = 150, tolerance = 10, longPress = 500, click = true, events = true } = options;
  const controller = new AbortController();
  const { signal } = controller;
  type Target = IntentTarget;

  let active: Target | null = null;
  let committed = false;
  let pending: { target: Target; timer: ReturnType<typeof setTimeout> } | null = null;
  let leaving: ReturnType<typeof setTimeout> | null = null;
  let press: { target: Target | null; x: number; y: number; time: number; scroll: number; selection: string; moved: boolean } | null = null;
  let lastTouch = -Infinity;
  let tapTarget: Target | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | null = null;
  let downSelection = '';

  const rangeList = (): Range[] => (ranges ? Array.from(typeof ranges === 'function' ? ranges() : ranges) : []);

  /** The range under a point: where the caret would go, found by binary search, then checked against its boxes. */
  function rangeAt(x: number, y: number): Range | null {
    const list = rangeList();
    if (!list.length) return null;
    const caret = caretAt(x, y, element.ownerDocument);
    if (!caret) return list.find(r => under(r, x, y)) ?? null;
    if (!element.contains(caret.node)) return null;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      let after: boolean;
      try {
        after = list[mid].comparePoint(caret.node, caret.offset) > 0;
      } catch {
        after = false;
      }
      if (after) lo = mid + 1;
      else hi = mid;
    }
    // The caret sits between characters, so the range just before it may be the one under the point.
    for (const r of [list[lo], list[lo - 1]]) if (r && under(r, x, y)) return r;
    return null;
  }

  const targetOf = (node: EventTarget | null): HTMLElement | null => {
    if (!(node instanceof Element)) return null;
    if (!selector) return node === element || element.contains(node) ? element : null;
    const t = node.closest<HTMLElement>(selector);
    return t && element.contains(t) ? t : null;
  };

  /** The target a pointer event is on. */
  const targetAt = (e: MouseEvent): Target | null => {
    if (!ranges) return targetOf(e.target);
    return e.target instanceof Node && element.contains(e.target) ? rangeAt(e.clientX, e.clientY) : null;
  };

  const isTouch = (e: PointerEvent): boolean => e.pointerType === 'touch';
  const selectionText = (): string => document.getSelection?.()?.toString() ?? '';
  const scrollPos = (): number => window.scrollX + window.scrollY;

  function clearPending(): void {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }

  function clearLeaving(): void {
    if (leaving) clearTimeout(leaving);
    leaving = null;
  }

  function show(target: Target, via: IntentVia): void {
    clearPending();
    clearLeaving();
    if (same(active, target)) return;
    if (active) cancel('moved');
    active = target;
    committed = false;
    options.onShow?.(target, via);
    if (events) emit(element, 'intent:show', { target, via });
  }

  function commit(target: Target, via: IntentVia): void {
    clearPending();
    clearLeaving();
    if (active && !same(active, target)) cancel('moved');
    if (same(active, target) && committed) return;
    active = target;
    committed = true;
    options.onCommit?.(target, via);
    if (events) emit(element, 'intent:commit', { target, via });
  }

  function cancel(reason: IntentCancelReason): void {
    clearPending();
    clearLeaving();
    const target = active;
    if (!target) return;
    active = null;
    committed = false;
    options.onCancel?.(target, reason);
    if (events) emit(element, 'intent:cancel', { target, reason });
  }

  function enter(target: Target): void {
    if (committed) return;
    if (same(active, target)) {
      clearLeaving();
      return;
    }
    // Something is already showing: switch now, no second wait.
    if (active || leaving) {
      show(target, 'hover');
      return;
    }
    clearPending();
    pending = { target, timer: setTimeout(() => show(target, 'hover'), delay) };
  }

  function leave(target: Target): void {
    if (pending && same(pending.target, target)) clearPending();
    if (!same(active, target) || committed) return;
    clearLeaving();
    leaving = setTimeout(() => {
      leaving = null;
      if (same(active, target) && !committed) cancel('leave');
    }, grace);
  }

  // ── Mouse and pen ──
  if (ranges) {
    let over: Range | null = null;
    element.addEventListener('pointermove', e => {
      if (isTouch(e)) return;
      const target = rangeAt(e.clientX, e.clientY);
      if (same(target, over)) return;
      if (over) leave(over);
      over = target;
      if (target) enter(target);
    }, { signal });
    element.addEventListener('pointerleave', e => {
      if (isTouch(e) || !over) return;
      leave(over);
      over = null;
    }, { signal });
  } else if (selector) {
    element.addEventListener('pointerover', e => {
      if (isTouch(e)) return;
      const target = targetOf(e.target);
      if (target && target !== targetOf(e.relatedTarget)) enter(target);
    }, { signal });
    element.addEventListener('pointerout', e => {
      if (isTouch(e)) return;
      const target = targetOf(e.target);
      if (target && target !== targetOf(e.relatedTarget)) leave(target);
    }, { signal });
  } else {
    element.addEventListener('pointerenter', e => !isTouch(e) && enter(element), { signal });
    element.addEventListener('pointerleave', e => !isTouch(e) && leave(element), { signal });
  }

  // ── Touch (and the outside press that cancels any commit) ──
  document.addEventListener('pointerdown', e => {
    const target = targetAt(e);
    if (!isTouch(e)) {
      downSelection = selectionText();
      if (!target && committed) cancel('outside');
      return;
    }
    press = { target, x: e.clientX, y: e.clientY, time: e.timeStamp || performance.now(), scroll: scrollPos(), selection: selectionText(), moved: false };
  }, { signal, capture: true });
  document.addEventListener('pointermove', e => {
    if (press && isTouch(e) && Math.hypot(e.clientX - press.x, e.clientY - press.y) > tolerance) press.moved = true;
  }, { signal, capture: true, passive: true });
  document.addEventListener('pointercancel', () => (press = null), { signal, capture: true });
  document.addEventListener('pointerup', e => {
    const p = press;
    press = null;
    if (!p || !isTouch(e)) return;
    lastTouch = performance.now();
    const duration = (e.timeStamp || performance.now()) - p.time;
    const selected = selectionText();
    const tap = !p.moved && duration < longPress && scrollPos() === p.scroll && (selected === '' || selected === p.selection);
    if (!tap) return;
    // Act on the click that follows: the browser light-dismisses popovers on
    // this pointerup, which would close anything opened now. (Without a
    // click, act shortly anyway.)
    if (tapTimer) clearTimeout(tapTimer);
    tapTarget = p.target;
    tapTimer = setTimeout(applyTap, 350);
  }, { signal, capture: true });
  document.addEventListener('click', () => {
    // Just after the click, once the browser has handled it.
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = setTimeout(applyTap, 0);
    }
  }, { signal, capture: true });

  function applyTap(): void {
    if (tapTimer) clearTimeout(tapTimer);
    tapTimer = null;
    const target = tapTarget;
    tapTarget = null;
    if (!target || !connected(target)) {
      if (active) cancel('outside');
    } else if (same(active, target) && committed) {
      cancel('toggle');
    } else {
      commit(target, 'tap');
    }
  }

  if (click) {
    element.addEventListener('click', e => {
      // A tap's compatibility click: handled above.
      if (performance.now() - lastTouch < 800) return;
      // A double click selects a word, and a drag selects text: neither is a commit.
      if (e.detail > 1) return;
      const selected = selectionText();
      if (selected !== '' && selected !== downSelection) return;
      const target = targetAt(e);
      if (!target) return;
      if (same(active, target) && committed) cancel('toggle');
      else commit(target, 'click');
    }, { signal });
  }

  // ── Keyboard ──
  let addedTabIndex = false;
  if (ranges) {
    if (keyboard) {
      if (!element.matches(FOCUSABLE)) {
        element.tabIndex = 0;
        addedTabIndex = true;
      }
      let cursor = -1;
      element.addEventListener('keydown', e => {
        if (e.target !== element || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
        const list = rangeList();
        if (!list.length) return;
        const at = active ? list.findIndex(r => same(r, active)) : -1;
        if (at >= 0) cursor = at;
        const rtl = getComputedStyle(element).direction === 'rtl';
        const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
        let next: number;
        if (step) next = cursor < 0 ? (step > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, cursor + step));
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = list.length - 1;
        else {
          if (e.key === 'Enter' && active) {
            e.preventDefault();
            commit(active, 'key');
          }
          return;
        }
        e.preventDefault();
        cursor = next;
        const range = list[next];
        if (committed) commit(range, 'key');
        else show(range, 'focus');
        range.startContainer.parentElement?.scrollIntoView?.({ block: 'nearest' });
      }, { signal });
      element.addEventListener('focusout', e => {
        if (e.target === element && active && !committed) cancel('blur');
      }, { signal });
    }
  } else {
    element.addEventListener('focusin', e => {
      const target = targetOf(e.target);
      if (target && !committed) show(target, 'focus');
    }, { signal });
    element.addEventListener('focusout', e => {
      const target = targetOf(e.target);
      if (target && active === target && !committed && targetOf(e.relatedTarget) !== target) cancel('blur');
    }, { signal });
    if (!selector) {
      // `focus`/`blur` dispatched on the host itself (not bubbling) count too.
      element.addEventListener('focus', () => !committed && show(element, 'focus'), { signal });
      element.addEventListener('blur', () => active === element && !committed && cancel('blur'), { signal });
    }
    element.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const target = targetOf(e.target);
      if (!target || (e.target as Element).closest(OWN_ENTER)) return;
      commit(target, 'key');
    }, { signal });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (active || pending)) cancel('escape');
  }, { signal });

  return {
    name: 'intent',
    element,
    options: options as Record<string, unknown>,
    active: () => (active ? { target: active, committed } : null),
    commit: target => commit(target, 'key'),
    cancel: () => cancel('api'),
    destroy() {
      if (tapTimer) clearTimeout(tapTimer);
      cancel('api');
      controller.abort();
      if (addedTabIndex) element.removeAttribute('tabindex');
    },
  };
}
