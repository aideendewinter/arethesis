import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Arethesis, getArethesis } from '../../core/arethesis';
import { confirm, type Dialog } from '../elements/dialog';
import { flush } from '../../../test/helpers';

async function mount(attrs = '', inner = '<p>Body</p><button id="inside">Inside</button>') {
  document.body.innerHTML = `<button id="opener">Open</button><a-dialog heading="Rename" ${attrs}>${inner}</a-dialog>`;
  await flush();
  const el = document.querySelector<Dialog>('a-dialog')!;
  return { el, dialog: el.dialog, opener: document.getElementById('opener') as HTMLButtonElement };
}

describe('<a-dialog>', () => {
  beforeEach(() => void getArethesis());
  afterEach(() => Arethesis.resetInstance());

  it('wraps its content in a labelled <dialog> with a close button', async () => {
    const { dialog } = await mount();
    expect(dialog.localName).toBe('dialog');
    const heading = dialog.querySelector('h2')!;
    expect(heading.textContent).toBe('Rename');
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(dialog.querySelector('.ar-dialog__body p')!.textContent).toBe('Body');
    expect(dialog.querySelector('.ar-dialog__close')!.getAttribute('aria-label')).toBe('Close');
    expect(dialog.getAttribute('closedby')).toBe('any');
  });

  it('opens, moves focus in, resolves with the close value and gives focus back', async () => {
    const { el, dialog, opener } = await mount();
    const events: string[] = [];
    el.addEventListener('dialog:open', () => events.push('open'));
    el.addEventListener('dialog:close', e => events.push(`close:${(e as CustomEvent).detail.returnValue}`));
    opener.focus();
    const result = el.open();
    expect(el.isOpen).toBe(true);
    expect(el.hasAttribute('open')).toBe(true);
    expect(document.activeElement?.closest('dialog')).toBe(dialog);
    el.close('save');
    expect(await result).toBe('save');
    expect(el.returnValue).toBe('save');
    expect(document.activeElement).toBe(opener);
    expect(el.hasAttribute('open')).toBe(false);
    expect(events).toEqual(['open', 'close:save']);
  });

  it('closes from its close button and from the backdrop, unless closedby says otherwise', async () => {
    const { el, dialog } = await mount();
    let result = el.open();
    (dialog.querySelector('.ar-dialog__close') as HTMLButtonElement).click();
    expect(await result).toBe('');
    result = el.open();
    dialog.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await result).toBe('');
    // A drag that starts inside and ends on the backdrop doesn't close it.
    void el.open();
    dialog.querySelector('p')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.isOpen).toBe(true);
    el.close();

    const strict = await mount('closedby="none"');
    void strict.el.open();
    strict.dialog.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    strict.dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const cancel = new Event('cancel', { cancelable: true });
    strict.dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(strict.el.isOpen).toBe(true);
    expect((strict.dialog.querySelector('.ar-dialog__close') as HTMLElement).hidden).toBe(true);
  });

  it('works where <dialog> has no showModal or close', async () => {
    const { el, dialog, opener } = await mount('modal="false"', '<input autofocus>');
    Object.defineProperty(dialog, 'show', { value: undefined });
    Object.defineProperty(dialog, 'close', { value: undefined });
    opener.focus();
    const result = el.open();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector('input'));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(await result).toBe('');
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('updates its heading, and closes when removed', async () => {
    const { el } = await mount();
    el.setAttribute('heading', 'Renamed');
    expect(el.dialog.querySelector('h2')!.textContent).toBe('Renamed');
    const result = el.open();
    el.remove();
    expect(await result).toBe('');
  });
});

describe('confirm()', () => {
  beforeEach(() => void getArethesis());
  afterEach(() => Arethesis.resetInstance());

  it('asks in an alertdialog, focuses Cancel for dangerous actions, and cleans up', async () => {
    const answer = confirm({ title: 'Delete this card?', body: 'It can’t be undone.', confirmLabel: 'Delete', danger: true });
    await flush();
    const dialog = document.querySelector('dialog')!;
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.querySelector('p')!.textContent).toBe('It can’t be undone.');
    expect(document.activeElement?.textContent).toBe('Cancel');
    const del = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Delete')!;
    expect(del.classList.contains('ar-dialog__button--danger')).toBe(true);
    (document.querySelector('a-dialog') as Dialog).close('confirm');
    expect(await answer).toBe(true);
    expect(document.querySelector('a-dialog')).toBeNull();
  });

  it('resolves false when cancelled', async () => {
    const node = document.createElement('strong');
    node.textContent = 'Sure?';
    const answer = confirm({ title: 'Archive?', body: node });
    await flush();
    expect(document.activeElement?.textContent).toBe('OK');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    (document.querySelector('a-dialog') as Dialog).close('cancel');
    expect(await answer).toBe(false);
  });
});
