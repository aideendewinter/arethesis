import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectionMenuMixin, type SelectionMenuInstance } from '../selection-menu';
import { contextMenuMixin } from '../context-menu';
import { textRange } from '../../utils/text-ranges';

const items = [
  { label: 'Highlight', action: 'highlight', icon: '✎' },
  { label: 'Note', action: 'note' },
  { label: 'Define', action: 'define', icon: '?', iconOnly: true },
  { label: 'Share', action: 'share', disabled: true },
];

let frames: FrameRequestCallback[] = [];
/** Selection changed: run the frame it scheduled (browsers fire selectionchange asynchronously). */
function changed(): void {
  document.dispatchEvent(new Event('selectionchange'));
  const run = frames;
  frames = [];
  for (const cb of run) cb(0);
}

function select(root: Node, start: number, end: number): Range {
  const range = textRange(root, start, end)!;
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  changed();
  return range;
}

function clearSelection(): void {
  document.getSelection()!.removeAllRanges();
  changed();
}

const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const menu = () => document.querySelector<HTMLElement>('.ar-selection-menu');

describe('selection-menu', () => {
  let article: HTMLElement;
  let m: SelectionMenuInstance;
  const events: string[] = [];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    document.body.innerHTML = '<article id="a"><p>Sing, goddess, the anger of Achilles</p><input id="f" value="field text"></article><p id="o">outside</p>';
    article = document.getElementById('a')!;
    events.length = 0;
    for (const type of ['open', 'select', 'close']) {
      article.addEventListener(`selection-menu:${type}`, e => events.push(`${type}:${(e as CustomEvent).detail.action ?? ''}:${(e as CustomEvent).detail.text ?? ''}`));
    }
  });

  afterEach(() => {
    m?.destroy();
    document.getSelection()?.removeAllRanges();
    vi.unstubAllGlobals();
  });

  it('opens for a selection inside the element, and closes when it collapses or leaves', () => {
    m = selectionMenuMixin(article, { items });
    expect(menu()).toBeNull();
    select(article, 6, 13);
    expect(m.isOpen()).toBe(true);
    const toolbar = menu()!;
    expect(toolbar.getAttribute('role')).toBe('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Selection actions');
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons.map(b => b.textContent)).toEqual(['✎Highlight', 'Note', '?', 'Share']);
    expect(buttons[2].getAttribute('aria-label')).toBe('Define');
    expect(buttons[3].disabled).toBe(true);
    expect(buttons.map(b => b.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(m.range()!.toString()).toBe('goddess');
    // Growing the selection keeps it open (one open event).
    select(article, 6, 24);
    expect(m.range()!.toString()).toBe('goddess, the anger');
    clearSelection();
    expect(m.isOpen()).toBe(false);
    expect(menu()).toBeNull();
    select(document.getElementById('o')!, 0, 3);
    expect(m.isOpen()).toBe(false);
    expect(events).toEqual(['open::goddess', 'close::']);
  });

  it('keeps the selection when a button is pressed, and reports the action', () => {
    const onSelect = vi.fn();
    m = selectionMenuMixin(article, { items, onSelect });
    select(article, 6, 13);
    const highlight = menu()!.querySelector<HTMLButtonElement>('[data-action=highlight]')!;
    const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    highlight.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    highlight.dispatchEvent(mouse);
    expect(mouse.defaultPrevented).toBe(true);
    highlight.click();
    expect(onSelect).toHaveBeenCalledWith('highlight', expect.any(Range), 'goddess');
    expect(document.getSelection()!.toString()).toBe('goddess');
    expect(events).toEqual(['open::goddess', 'close::', 'select:highlight:goddess']);
    // The same selection doesn't reopen it…
    changed();
    expect(m.isOpen()).toBe(false);
    // …a new one does.
    select(article, 0, 4);
    expect(m.isOpen()).toBe(true);
    menu()!.querySelector<HTMLButtonElement>('[data-action=share]')!.click();
    menu()!.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('is reachable from the keyboard, ahead of a context menu', () => {
    const contextSelect = vi.fn();
    contextMenuMixin(article, { items: [{ label: 'Open', action: 'open' }], onSelect: contextSelect });
    m = selectionMenuMixin(article, { items });
    const p = article.querySelector('p')!;
    p.tabIndex = 0;
    p.focus();
    select(article, 6, 13);
    key(p, 'F10', { shiftKey: true });
    const buttons = Array.from(menu()!.querySelectorAll<HTMLButtonElement>('button'));
    expect(document.activeElement).toBe(buttons[0]);
    expect(document.querySelector('[role=menu]')).toBeNull();
    // Moving inside the toolbar doesn't close it, even if the selection changes.
    changed();
    key(buttons[0], 'ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    key(buttons[1], 'ArrowLeft');
    key(buttons[0], 'ArrowLeft'); // wraps, skipping the disabled one
    expect(document.activeElement).toBe(buttons[2]);
    key(buttons[2], 'Home');
    key(buttons[0], 'End');
    key(buttons[2], 'ArrowDown');
    key(buttons[0], 'ArrowUp');
    expect(buttons.map(b => b.tabIndex)).toEqual([-1, -1, 0, -1]);
    key(buttons[2], 'x');
    key(buttons[2], 'Escape');
    expect(m.isOpen()).toBe(false);
    expect(document.activeElement).toBe(p);
    expect(document.getSelection()!.toString()).toBe('goddess');
    // Without a selection, the keys open the context menu as before.
    clearSelection();
    key(p, 'ContextMenu');
    expect(document.querySelector('[role=menu]')).not.toBeNull();
  });

  it('closes on Escape from the text and on Tab out of the toolbar', () => {
    m = selectionMenuMixin(article, { items });
    select(article, 6, 13);
    key(document.body, 'Escape');
    expect(m.isOpen()).toBe(false);
    changed();
    expect(m.isOpen()).toBe(false);
    select(article, 0, 4);
    m.focus();
    key(document.activeElement!, 'Tab');
    expect(m.isOpen()).toBe(false);
    expect(document.activeElement).toBe(article); // made focusable to return there
    expect(article.tabIndex).toBe(-1);
    select(article, 0, 4);
    m.close();
    expect(m.isOpen()).toBe(false);
    m.focus(); // nothing open: nothing to focus
  });

  it('skips form fields, short selections and empty item lists, and can render its own buttons', () => {
    m = selectionMenuMixin(article, { minLength: 3, items: (_range, text) => (text.includes('anger') ? [] : items) });
    const field = document.getElementById('f') as HTMLInputElement;
    const range = document.createRange();
    range.selectNodeContents(field);
    document.getSelection()!.addRange(range);
    changed();
    expect(m.isOpen()).toBe(false);
    select(article, 0, 2);
    expect(m.isOpen()).toBe(false);
    select(article, 19, 24);
    expect(m.isOpen()).toBe(false);
    m.destroy();
    const render = vi.fn((el: HTMLElement) => (el.innerHTML = '<button data-action="x">X</button>'));
    m = selectionMenuMixin(article, { render, label: 'Text tools', placement: 'bottom', announce: false });
    select(article, 0, 4);
    expect(render).toHaveBeenCalledWith(menu(), expect.any(Range), 'Sing');
    expect(menu()!.getAttribute('aria-label')).toBe('Text tools');
  });

  it('remembers which end the selection grows from', () => {
    m = selectionMenuMixin(article, { items });
    const p = article.querySelector('p')!.firstChild!;
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.collapse(p, 13);
    selection.extend(p, 6);
    changed();
    expect(m.isOpen()).toBe(true);
    menu()!.querySelector<HTMLButtonElement>('[data-action=note]')!.click();
    expect(selection.toString()).toBe('goddess');
    expect(selection.focusOffset).toBe(6);
  });
});
