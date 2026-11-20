/**
 * `<a-dialog>`: a native `<dialog>` with a heading, a close button, and a
 * promise for its result.
 *
 * ```html
 * <a-dialog id="rename" heading="Rename card">
 *   <form method="dialog">
 *     <label>Title <input name="title" autofocus></label>
 *     <button value="cancel" formnovalidate>Cancel</button>
 *     <button value="save">Save</button>
 *   </form>
 * </a-dialog>
 * ```
 *
 * ```ts
 * const result = await document.querySelector('#rename').open(); // 'save', 'cancel' or ''
 * if (await confirm({ title: 'Delete this card?', confirmLabel: 'Delete', danger: true })) remove();
 * ```
 *
 * It's modal unless `modal="false"`: focus moves in, the page behind is
 * inert, and focus goes back to where it was on close. `closedby` says what
 * else closes it: `any` (the default: the backdrop or Escape),
 * `closerequest` (Escape) or `none`. A `<form method="dialog">` closes it
 * with the pressed button's `value`.
 *
 * Events: `dialog:open`, `dialog:close` (`{ returnValue }`).
 *
 * @module components/dialog
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import { uniqueId } from '../utils/dom';
import { FOCUSABLE, modal, type Modal } from './internal/modal';

export class Dialog extends Component {
  #dialog: HTMLDialogElement | null = null;
  #modal: Modal | null = null;
  #heading: HTMLElement | null = null;
  #waiting: Array<(value: string) => void> = [];

  static get observedAttributes(): string[] {
    return ['heading'];
  }

  attributeChangedCallback(name: string): void {
    if (name === 'heading' && this.#heading) this.#heading.textContent = this.getAttribute('heading') ?? '';
  }

  /** The inner `<dialog>`. */
  get dialog(): HTMLDialogElement {
    this.#build();
    return this.#dialog!;
  }

  get isOpen(): boolean {
    return this.#modal?.isOpen() ?? false;
  }

  /** The value it last closed with (a form button's `value`, or `''`). */
  get returnValue(): string {
    return this.#dialog?.returnValue ?? '';
  }

  protected override onConnected(): void {
    this.#build();
  }

  protected override onDisconnected(): void {
    if (this.isOpen) this.close();
  }

  #build(): void {
    if (this.#dialog) return;
    const id = this.id || uniqueId('ar-dialog');
    const dialog = document.createElement('dialog');
    dialog.className = 'ar-dialog';
    const header = document.createElement('header');
    header.className = 'ar-dialog__header';
    const heading = document.createElement('h2');
    heading.className = 'ar-dialog__heading';
    heading.id = `${id}-heading`;
    heading.textContent = this.getAttribute('heading') ?? '';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'ar-dialog__close';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.close(''));
    header.append(heading, closeButton);
    const body = document.createElement('div');
    body.className = 'ar-dialog__body';
    body.append(...Array.from(this.childNodes));
    dialog.append(header, body);
    dialog.setAttribute('aria-labelledby', heading.id);
    if (this.getAttribute('closedby') === 'none') closeButton.hidden = true;
    this.append(dialog);
    this.#dialog = dialog;
    this.#heading = heading;
    this.#modal = modal(dialog, {
      modal: this.getAttribute('modal') !== 'false',
      closedBy: (this.getAttribute('closedby') as 'any' | 'closerequest' | 'none' | null) ?? 'any',
      // The content first: `[autofocus]`, else its first control (the close button comes last).
      initialFocus: () => body.querySelector<HTMLElement>('[autofocus]') ?? body.querySelector<HTMLElement>(FOCUSABLE),
      onClose: value => {
        this.removeAttribute('open');
        this.emit('dialog:close', { returnValue: value });
        for (const resolve of this.#waiting.splice(0)) resolve(value);
      },
    });
  }

  /** Open it. Resolves with the value it closes with. */
  open(): Promise<string> {
    this.#build();
    const result = new Promise<string>(resolve => this.#waiting.push(resolve));
    if (!this.isOpen) {
      this.#modal!.open();
      this.setAttribute('open', '');
      this.emit('dialog:open', {});
    }
    return result;
  }

  /** Close it, with a value for `open()`'s promise. */
  close(returnValue = ''): void {
    this.#modal?.close(returnValue);
  }
}

export interface ConfirmOptions {
  title: string;
  /** Text (or nodes) under the title. */
  body?: string | Node;
  confirmLabel?: string;
  cancelLabel?: string;
  /** A destructive action: the confirm button is styled as dangerous, and Cancel gets focus. */
  danger?: boolean;
}

/** Ask a yes-or-no question in a modal dialog. Resolves to whether it was confirmed. */
export async function confirm(options: ConfirmOptions): Promise<boolean> {
  defineDialog();
  const host = document.createElement('a-dialog') as Dialog;
  host.setAttribute('heading', options.title);
  if (options.body) {
    const body = typeof options.body === 'string' ? Object.assign(document.createElement('p'), { textContent: options.body }) : options.body;
    host.append(body);
  }
  const form = document.createElement('form');
  form.method = 'dialog';
  form.className = 'ar-dialog__actions';
  const cancel = Object.assign(document.createElement('button'), { value: 'cancel', textContent: options.cancelLabel ?? 'Cancel', className: 'ar-dialog__button ar-dialog__button--secondary' });
  const ok = Object.assign(document.createElement('button'), { value: 'confirm', textContent: options.confirmLabel ?? 'OK', className: options.danger ? 'ar-dialog__button ar-dialog__button--danger' : 'ar-dialog__button' });
  (options.danger ? cancel : ok).setAttribute('autofocus', '');
  form.append(cancel, ok);
  host.append(form);
  document.body.append(host);
  host.dialog.setAttribute('role', 'alertdialog');
  try {
    return (await host.open()) === 'confirm';
  } finally {
    host.remove();
  }
}

/** Define `<a-dialog>` (idempotent). `import 'arethesis/components/dialog'` calls this. */
export function defineDialog(): void {
  defineComponent({ tag: 'a-dialog' })(Dialog);
}
