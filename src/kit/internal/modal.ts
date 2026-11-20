/**
 * Opening and closing a native `<dialog>` the same way everywhere: focus
 * moves in and comes back, the backdrop and Escape close it (as asked), and
 * browsers without `showModal()` still get a working dialog.
 *
 * @module kit/internal/modal
 * @internal
 */

export interface ModalOptions {
  /** Modal (the page behind is inert) or not. @default true */
  modal?: boolean;
  /** What closes it besides its buttons: `any` (backdrop or Escape), `closerequest` (Escape), or `none`. @default 'any' */
  closedBy?: 'any' | 'closerequest' | 'none';
  /** The element to focus on open. @default `[autofocus]`, else the first focusable element */
  initialFocus?: () => HTMLElement | null;
  onClose?: (returnValue: string) => void;
}

export interface Modal {
  open(): void;
  close(returnValue?: string): void;
  isOpen(): boolean;
  destroy(): void;
}

export const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function modal(dialog: HTMLDialogElement, options: ModalOptions = {}): Modal {
  const controller = new AbortController();
  const { signal } = controller;
  const closedBy = options.closedBy ?? 'any';
  let returnFocus: HTMLElement | null = null;
  // The native attribute does this where it's supported; the handlers below cover the rest.
  dialog.setAttribute('closedby', closedBy);

  const isOpen = (): boolean => dialog.open || dialog.hasAttribute('open');

  const afterClose = (): void => {
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus();
    options.onClose?.(dialog.returnValue ?? '');
  };

  const close = (returnValue?: string): void => {
    if (!isOpen()) return;
    if (typeof dialog.close === 'function') {
      dialog.close(returnValue);
    } else {
      if (returnValue !== undefined) dialog.returnValue = returnValue;
      dialog.removeAttribute('open');
      afterClose();
    }
  };

  dialog.addEventListener('close', afterClose, { signal });
  dialog.addEventListener('cancel', e => {
    if (closedBy === 'none') e.preventDefault();
  }, { signal });
  dialog.addEventListener('keydown', e => {
    // Native modals handle Escape themselves (as a cancel event).
    if (e.key === 'Escape' && closedBy !== 'none' && !dialog.matches(':modal')) {
      e.preventDefault();
      close('');
    }
  }, { signal });
  // The backdrop is the dialog element itself; only a click that starts and ends there counts.
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', e => (downOnBackdrop = e.target === dialog), { signal });
  dialog.addEventListener('click', e => {
    if (closedBy === 'any' && e.target === dialog && downOnBackdrop) close('');
    downOnBackdrop = false;
  }, { signal });

  return {
    open: () => {
      if (isOpen()) return;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.returnValue = '';
      const useModal = options.modal !== false;
      if (useModal && typeof dialog.showModal === 'function') dialog.showModal();
      else if (!useModal && typeof dialog.show === 'function') dialog.show();
      else dialog.setAttribute('open', '');
      const target = options.initialFocus?.() ?? dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? dialog).focus();
    },
    close,
    isOpen,
    destroy: () => controller.abort(),
  };
}
