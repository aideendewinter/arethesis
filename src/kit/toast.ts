/**
 * `<a-toast>`: short notifications in a corner of the screen.
 *
 * ```ts
 * import { toast, connectToasts } from 'arethesis/components/toast';
 *
 * toast('Saved');
 * toast('Couldn’t save', { kind: 'error', action: { label: 'Retry', run: save } });
 * connectToasts(getArethesis()); // failed requests and rolled-back edits show up by themselves
 * ```
 *
 * Messages are read by screen readers: info and success politely
 * (`role="status"`), errors at once (`role="alert"`). Both live regions are in
 * the page from the start, so the first message is announced too. A toast
 * stays while the pointer is over it or it has focus, and one with an action
 * stays until it's dismissed, so there's time to use it.
 *
 * `toast()` uses the first `<a-toast>` on the page, adding one if there's none.
 * Place your own to choose its position: `<a-toast position="top-end">`.
 *
 * @module components/toast
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import type { HttpError } from '../http/http-error';
import type { HttpClient } from '../http/http-client';
import type { OptimisticEvent, OptimisticUpdateManager } from '../data/optimistic-updates';
import { supportsPopover } from '../mixins/popup';
import { announce } from '../mixins/utils';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** A button on the toast. A toast with an action stays until it's dismissed. */
  action?: { label: string; run: () => void };
  /** How long it stays, in ms. `0` keeps it until dismissed. @default 5000 (8000 for errors) */
  timeout?: number;
}

export interface ToastHandle {
  element: HTMLElement;
  dismiss(): void;
}

export class Toaster extends Component {
  #status: HTMLElement | null = null;
  #alert: HTMLElement | null = null;

  protected override onConnected(): void {
    if (this.#status) return;
    this.setAttribute('aria-label', this.getAttribute('aria-label') ?? 'Notifications');
    const region = (role: 'status' | 'alert'): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'ar-toast__region';
      el.setAttribute('role', role);
      el.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite');
      return el;
    };
    this.#status = region('status');
    this.#alert = region('alert');
    this.replaceChildren(this.#status, this.#alert);
    // In the top layer, above sticky headers and non-modal popups.
    if (supportsPopover()) {
      this.popover = 'manual';
      try {
        this.showPopover();
      } catch {
        /* not supported here */
      }
    }
  }

  /** Show a message. */
  show(message: string, options: ToastOptions = {}): ToastHandle {
    if (!this.#status) this.onConnected();
    const kind = options.kind ?? 'info';
    const el = document.createElement('div');
    el.className = 'ar-toast';
    el.dataset.kind = kind;
    const text = document.createElement('span');
    text.className = 'ar-toast__message';
    text.textContent = message;
    el.append(text);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const dismiss = (): void => {
      if (timer) clearTimeout(timer);
      // Keep focus on the page if it was on the toast.
      if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      el.remove();
    };
    if (options.action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ar-toast__action';
      button.textContent = options.action.label;
      button.addEventListener('click', () => {
        dismiss();
        options.action!.run();
      });
      el.append(button);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ar-toast__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', dismiss);
    el.append(close);

    const timeout = options.action ? 0 : options.timeout ?? (kind === 'error' ? 8000 : 5000);
    const start = (): void => {
      if (timeout > 0) timer = setTimeout(dismiss, timeout);
    };
    const pause = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    el.addEventListener('pointerenter', pause);
    el.addEventListener('pointerleave', () => {
      if (!el.contains(document.activeElement)) start();
    });
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', e => {
      if (!el.contains(e.relatedTarget as Node)) start();
    });

    (kind === 'error' ? this.#alert! : this.#status!).append(el);
    // A modal dialog makes the rest of the page inert, and it may not be announced.
    if (document.querySelector('dialog[open]:modal')) announce(message);
    start();
    return { element: el, dismiss };
  }

  /** Remove every toast. */
  clear(): void {
    this.#status?.replaceChildren();
    this.#alert?.replaceChildren();
  }
}

/** Show a toast in the page's `<a-toast>` (added if there's none). */
export function toast(message: string, options: ToastOptions | ToastKind = {}): ToastHandle {
  defineToaster();
  let host = document.querySelector<Toaster>('a-toast');
  if (!host) {
    host = document.createElement('a-toast') as Toaster;
    document.body.append(host);
  }
  return host.show(message, typeof options === 'string' ? { kind: options } : options);
}

export interface ConnectToastsOptions {
  /** Message for a rolled-back optimistic change, or `false` for none. */
  rollback?: ((event: OptimisticEvent) => string | false) | false;
  /** Message for a failed request, or `false` for none. Requests that were cancelled are skipped. */
  httpError?: ((error: HttpError) => string | false) | false;
}

/**
 * Show toasts for rolled-back changes and failed requests. Returns a function
 * that stops. Pass `false` for either to leave it out.
 */
export function connectToasts(app: { optimistic: OptimisticUpdateManager; http: HttpClient }, options: ConnectToastsOptions = {}): () => void {
  const offs: Array<() => void> = [];
  if (options.rollback !== false) {
    const message = options.rollback ?? ((e: OptimisticEvent) => `Couldn’t ${e.kind === 'create' ? 'add' : e.kind === 'delete' ? 'delete' : 'save'} that. It’s been undone.`);
    offs.push(app.optimistic.on('rollback', e => {
      const text = message(e);
      if (text) toast(text, { kind: 'error' });
    }));
  }
  if (options.httpError) {
    const message = options.httpError;
    offs.push(app.http.onError(error => {
      const text = message(error);
      if (text) toast(text, { kind: 'error' });
    }));
  }
  return () => offs.forEach(off => off());
}

/** Define `<a-toast>` (idempotent). `import 'arethesis/components/toast'` calls this. */
export function defineToaster(): void {
  defineComponent({ tag: 'a-toast' })(Toaster);
}
