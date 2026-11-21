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
 * - **Mouse and pen:** resting on a target for `delay` ms shows it, and
 *   leaving cancels. Once one is shown, moving to the next shows it at once.
 *   A click commits (unless `click: false`).
 * - **Touch:** a tap commits, but not a swipe, a scroll, a long press or a
 *   text selection. Tapping another target moves the commit there; tapping
 *   the same one again, or outside, cancels it. The pointer leaving is
 *   ignored, since a finger lifting always "leaves".
 * - **Keyboard:** focus shows and blur cancels; Enter commits (on targets
 *   that aren't buttons, links or fields, which have their own Enter);
 *   Escape cancels.
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

export type IntentVia = 'hover' | 'focus' | 'click' | 'tap' | 'key';
export type IntentCancelReason = 'leave' | 'blur' | 'moved' | 'toggle' | 'outside' | 'escape' | 'api';

export interface IntentOptions {
  /** Targets inside the host (delegated). @default the host itself */
  selector?: string;
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
  onShow?: (target: HTMLElement, via: IntentVia) => void;
  onCommit?: (target: HTMLElement, via: IntentVia) => void;
  onCancel?: (target: HTMLElement, reason: IntentCancelReason) => void;
}

export interface IntentInstance extends MixinInstance {
  /** The active target and whether it's committed, or null. */
  active(): { target: HTMLElement; committed: boolean } | null;
  commit(target: HTMLElement): void;
  cancel(): void;
}

const OWN_ENTER = 'a[href], button, input, select, textarea, summary, [contenteditable=""], [contenteditable="true"]';

export function intentMixin(element: HTMLElement, options: IntentOptions = {}): IntentInstance {
  const { selector, delay = 280, grace = 150, tolerance = 10, longPress = 500, click = true, events = true } = options;
  const controller = new AbortController();
  const { signal } = controller;

  let active: HTMLElement | null = null;
  let committed = false;
  let pending: { target: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
  let leaving: ReturnType<typeof setTimeout> | null = null;
  let press: { target: HTMLElement | null; x: number; y: number; time: number; scroll: number; selection: string; moved: boolean } | null = null;
  let lastTouch = -Infinity;
  let tapTarget: HTMLElement | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | null = null;

  const targetOf = (node: EventTarget | null): HTMLElement | null => {
    if (!(node instanceof Element)) return null;
    if (!selector) return node === element || element.contains(node) ? element : null;
    const t = node.closest<HTMLElement>(selector);
    return t && element.contains(t) ? t : null;
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

  function show(target: HTMLElement, via: IntentVia): void {
    clearPending();
    clearLeaving();
    if (active === target) return;
    if (active) cancel('moved');
    active = target;
    committed = false;
    options.onShow?.(target, via);
    if (events) emit(element, 'intent:show', { target, via });
  }

  function commit(target: HTMLElement, via: IntentVia): void {
    clearPending();
    clearLeaving();
    if (active && active !== target) cancel('moved');
    if (active === target && committed) return;
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

  function enter(target: HTMLElement): void {
    if (committed) return;
    if (active === target) {
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

  function leave(target: HTMLElement): void {
    if (pending?.target === target) clearPending();
    if (active !== target || committed) return;
    clearLeaving();
    leaving = setTimeout(() => {
      leaving = null;
      if (active === target && !committed) cancel('leave');
    }, grace);
  }

  // ── Mouse and pen ──
  if (selector) {
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
    const target = targetOf(e.target);
    if (!isTouch(e)) {
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
    if (!target?.isConnected) {
      if (active) cancel('outside');
    } else if (active === target && committed) {
      cancel('toggle');
    } else {
      commit(target, 'tap');
    }
  }

  if (click) {
    element.addEventListener('click', e => {
      // A tap's compatibility click: handled above.
      if (performance.now() - lastTouch < 800) return;
      const target = targetOf(e.target);
      if (!target) return;
      if (active === target && committed) cancel('toggle');
      else commit(target, 'click');
    }, { signal });
  }

  // ── Keyboard ──
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
    },
  };
}
