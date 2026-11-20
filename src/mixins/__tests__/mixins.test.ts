import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../index';
import { mixinRegistry } from '../registry';
import { draggableMixin } from '../draggable';
import { editableMixin } from '../editable';
import { gridNavigationMixin } from '../grid-navigation';
import { infiniteScrollMixin } from '../infinite-scroll';
import { sortableMixin } from '../sortable';
import { resizableMixin } from '../resizable';
import { dropdownMixin } from '../dropdown';
import { tooltipMixin } from '../tooltip';
import { contextMenuMixin } from '../context-menu';
import { announce, placeFloating } from '../utils';
import { Arethesis } from '../../core/arethesis';
import { MockIntersectionObserver } from '../../../test/intersection';
import { flush } from '../../../test/helpers';

const html = (markup: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = markup.trim();
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
};
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const pointer = (el: Element, type: string, x: number, y: number, extra: PointerEventInit = {}) =>
  el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true, cancelable: true, ...extra }));

afterEach(() => vi.useRealTimers());

describe('built-in registration', () => {
  it('registers every mixin', () => {
    expect(mixinRegistry.names()).toEqual(expect.arrayContaining(['draggable', 'editable', 'grid-navigation', 'infinite-scroll', 'sortable', 'resizable', 'dropdown', 'tooltip', 'context-menu']));
  });
  it('forgets an instance that was destroyed directly, so it can be applied again (regression)', () => {
    const el = html('<ul><li>a</li></ul>');
    const first = mixinRegistry.apply(el, 'sortable')!;
    expect(mixinRegistry.isApplied(el, 'sortable')).toBe(true);
    first.destroy();
    expect(mixinRegistry.isApplied(el, 'sortable')).toBe(false);
    expect(el.dataset.mixinsApplied).toBeUndefined();
    const second = mixinRegistry.apply(el, 'sortable')!;
    expect(second).not.toBe(first);
    expect(el.classList.contains('is-sortable')).toBe(true);
    // remove() and removeAll() still work, and destroying twice is harmless.
    expect(mixinRegistry.remove(el, 'sortable')).toBe(true);
    first.destroy();
    mixinRegistry.apply(el, 'sortable');
    mixinRegistry.apply(el, 'tooltip', { content: 'x' });
    mixinRegistry.removeAll(el);
    expect(mixinRegistry.isApplied(el, 'sortable')).toBe(false);
    expect(mixinRegistry.isApplied(el, 'tooltip')).toBe(false);
  });
});

describe('draggable', () => {
  it('drags with pointer events and accumulates offsets across drags (regression)', () => {
    const el = html('<div>drag</div>');
    const events: string[] = [];
    el.addEventListener('draggable:end', e => events.push(JSON.stringify((e as CustomEvent).detail)));
    const onDrag = vi.fn();
    const m = draggableMixin(el, { onDrag });
    pointer(el, 'pointerdown', 10, 10);
    pointer(el, 'pointermove', 30, 25);
    pointer(el, 'pointerup', 30, 25);
    expect(el.style.transform).toBe('translate(20px, 15px)');
    pointer(el, 'pointerdown', 100, 100);
    pointer(el, 'pointermove', 110, 100);
    pointer(el, 'pointerup', 110, 100);
    expect(el.style.transform).toBe('translate(30px, 15px)');
    expect(events.at(-1)).toBe('{"x":30,"y":15,"dx":10,"dy":0}');
    expect(onDrag).toHaveBeenCalledTimes(2);
    expect((m.position as () => unknown)()).toEqual({ x: 30, y: 15 });
    (m.reset as () => void)();
    expect(el.style.transform).toBe('translate(0px, 0px)');
    m.destroy();
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointermove', 50, 50);
    expect(el.style.transform).toBe('translate(0px, 0px)');
  });

  it('respects axis, grid, keyboard nudges and ignores other buttons', () => {
    const el = html('<div><span class="h">h</span><input></div>');
    const onEnd = vi.fn();
    draggableMixin(el, { axis: 'x', grid: [10, 10], handle: '.h', onEnd });
    const handle = el.querySelector('.h')!;
    pointer(handle, 'pointerdown', 0, 0, { button: 2 });
    pointer(handle, 'pointermove', 50, 50);
    expect(el.style.transform).toBe('');
    pointer(handle, 'pointerdown', 0, 0);
    pointer(handle, 'pointermove', 14, 40);
    pointer(handle, 'pointercancel', 14, 40);
    expect(el.style.transform).toBe('translate(10px, 0px)');
    key(el, 'ArrowRight');
    key(el, 'ArrowDown', { shiftKey: true });
    key(el, 'a');
    expect(el.style.transform).toBe('translate(20px, 0px)');
    expect(onEnd).toHaveBeenCalledTimes(3);
  });

  it('keeps the element inside its containment', () => {
    const parent = html('<div><div class="d"></div></div>');
    const el = parent.querySelector<HTMLElement>('.d')!;
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 20, 20));
    draggableMixin(el, { containment: 'parent' });
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointermove', 500, -500);
    expect(el.style.transform).toBe('translate(70px, -10px)');
    for (const containment of ['window', parent, '.missing'] as const) {
      const other = html('<div></div>');
      draggableMixin(other, { containment });
      pointer(other, 'pointerdown', 0, 0);
      pointer(other, 'pointermove', 1, 1);
    }
  });
});

describe('editable', () => {
  it('edits with Enter, saves via callback and event', async () => {
    const el = html('<span>Old</span>');
    const onSave = vi.fn();
    const saved = vi.fn();
    el.addEventListener('editable:save', e => saved((e as CustomEvent).detail));
    const m = editableMixin(el, { onSave });
    key(el, 'Enter');
    const input = el.querySelector('input')!;
    expect(input.value).toBe('Old');
    expect(input.getAttribute('aria-label')).toBe('Edit');
    input.value = 'New';
    key(input, 'Enter');
    await flush();
    expect(el.textContent).toBe('New');
    expect(onSave).toHaveBeenCalledWith('New', el);
    expect(saved).toHaveBeenCalledWith({ value: 'New', previous: 'Old' });
    expect((m.isEditing as () => boolean)()).toBe(false);
  });

  it('cancels with Escape, rolls back failed saves and validates', async () => {
    const el = html('<span>Keep</span>');
    const errorEvent = vi.fn();
    el.addEventListener('editable:error', errorEvent);
    editableMixin(el, {
      validate: v => (v.length >= 3 ? true : 'Too short'),
      onSave: async () => {
        throw new Error('server');
      },
    });
    el.dispatchEvent(new MouseEvent('dblclick'));
    let input = el.querySelector('input')!;
    input.value = 'changed';
    key(input, 'Escape');
    expect(el.textContent).toBe('Keep');
    el.dispatchEvent(new MouseEvent('dblclick'));
    input = el.querySelector('input')!;
    input.value = 'ab';
    key(input, 'Enter');
    await flush();
    expect(el.querySelector('.editable-error')!.textContent).toBe('Too short');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.value = 'abcd';
    key(input, 'Enter');
    await flush();
    expect(el.textContent).toBe('Keep');
    expect(errorEvent).toHaveBeenCalled();
  });

  it('supports textarea, select, blur saving and cancelable save events', async () => {
    const ta = html('<div>Line</div>');
    const m = editableMixin(ta, { type: 'textarea' });
    (m.start as () => void)();
    const area = ta.querySelector('textarea')!;
    area.value = 'Line 2';
    key(area, 'Enter'); // plain Enter inserts a newline
    expect(ta.querySelector('textarea')).not.toBeNull();
    key(area, 'Enter', { ctrlKey: true });
    await flush();
    expect(ta.textContent).toBe('Line 2');

    const sel = html('<div>b</div>');
    editableMixin(sel, { type: 'select', choices: ['a', { value: 'b', label: 'Bee' }] });
    key(sel, 'F2');
    const select = sel.querySelector('select')!;
    expect(select.options).toHaveLength(2);
    select.value = 'a';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(sel.textContent).toBe('a');

    const blur = html('<div>x</div>');
    blur.addEventListener('editable:save', e => e.preventDefault());
    const bm = editableMixin(blur);
    (bm.start as () => void)();
    const bi = blur.querySelector('input')!;
    bi.value = 'y';
    bi.dispatchEvent(new Event('blur'));
    await flush();
    expect(blur.textContent).toBe('x'); // prevented
    (bm.start as () => void)();
    blur.querySelector('input')!.dispatchEvent(new Event('blur')); // unchanged
    await flush();
    expect(blur.textContent).toBe('x');
    (bm.start as () => void)();
    bm.destroy();
    expect(blur.textContent).toBe('x');
    key(blur, 'Enter');
    expect(blur.querySelector('input')).toBeNull(); // listener removed (regression)
  });
});

describe('grid-navigation', () => {
  const grid = () => html(`
    <table><tbody>
      <tr><td>a1</td><td>a2</td><td>a3</td></tr>
      <tr><td>b1</td><td>b2</td><td>b3</td></tr>
      <tr><td>c1</td><td>c2</td></tr>
    </tbody></table>`);

  it('moves with arrows, Home/End and PageUp/Down using a roving tabindex', () => {
    const table = grid();
    const navigated: string[] = [];
    table.addEventListener('grid:navigate', e => navigated.push((e as CustomEvent).detail.cell.textContent));
    const m = gridNavigationMixin(table, { pageSize: 2 });
    const cells = Array.from(table.querySelectorAll('td'));
    expect(cells.filter(c => c.tabIndex === 0)).toEqual([cells[0]]);
    cells[0].focus();
    key(cells[0], 'ArrowRight');
    key(document.activeElement!, 'ArrowDown');
    key(document.activeElement!, 'End');
    key(document.activeElement!, 'Home');
    key(document.activeElement!, 'PageDown');
    key(document.activeElement!, 'End', { ctrlKey: true });
    key(document.activeElement!, 'Home', { ctrlKey: true });
    key(document.activeElement!, 'ArrowUp'); // at top: stays
    key(document.activeElement!, 'ArrowLeft'); // at left edge: stays
    expect(navigated).toEqual(['a2', 'b2', 'b3', 'b1', 'c1', 'c2', 'a1']);
    expect(cells.filter(c => c.tabIndex === 0)).toEqual([cells[0]]);
    expect((m.activeCell as () => HTMLElement)()).toBe(cells[0]);
    (m.focusCell as (r: number, c: number) => void)(2, 5);
    expect(document.activeElement).toBe(cells[7]);
  });

  it('lets Tab leave the grid by default (regression: keyboard trap)', () => {
    const table = grid();
    gridNavigationMixin(table);
    const cell = table.querySelector('td')!;
    cell.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    cell.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('moves between cells with Tab when configured, wraps, and requests edits', () => {
    const table = grid();
    const edits: Array<[string, string | undefined]> = [];
    table.addEventListener('grid:edit', e => edits.push([(e as CustomEvent).detail.cell.textContent, (e as CustomEvent).detail.key]));
    gridNavigationMixin(table, { tabBehavior: 'cells', wrap: true });
    const cells = Array.from(table.querySelectorAll('td'));
    cells[2].focus();
    key(cells[2], 'Tab');
    expect(document.activeElement).toBe(cells[3]);
    key(cells[3], 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(cells[2]);
    key(cells[0], 'ArrowUp');
    expect(document.activeElement).toBe(cells[6]);
    key(cells[6], 'Enter');
    key(cells[6], 'x');
    key(cells[6], 'c', { ctrlKey: true });
    cells[4].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(edits).toEqual([['c1', 'Enter'], ['c1', 'x'], ['b2', 'dblclick']]);
    const last = cells[7];
    last.focus();
    const evt = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false); // last cell: Tab still leaves
  });

  it('tracks clicks/focus, ignores inputs, refreshes and cleans up', () => {
    const table = html('<div><div data-row><div data-cell>1</div><div data-cell><input></div></div></div>');
    const m = gridNavigationMixin(table, { cellSelector: '[data-cell]', rowSelector: '[data-row]' });
    expect(table.getAttribute('role')).toBe('grid');
    const [c1, c2] = Array.from(table.querySelectorAll<HTMLElement>('[data-cell]'));
    c2.click();
    expect(c2.tabIndex).toBe(0);
    c1.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(c1.classList.contains('is-focused')).toBe(true);
    const input = table.querySelector('input')!;
    const evt = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    input.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
    (m.refresh as () => void)();
    m.destroy();
    expect(table.hasAttribute('role')).toBe(false);
    expect(c1.hasAttribute('tabindex')).toBe(false);
  });
});

describe('infinite-scroll', () => {
  beforeEach(() => MockIntersectionObserver.install());

  it('loads more when the sentinel is visible and re-checks afterwards', async () => {
    const el = html('<div style="overflow:auto"></div>');
    let pages = 0;
    const loaded = vi.fn();
    el.addEventListener('infinite-scroll:loaded', loaded);
    const m = infiniteScrollMixin(el, { threshold: 200, loadMore: async () => void pages++, hasMore: () => pages < 2 });
    const sentinel = el.querySelector('.ar-scroll-sentinel')!;
    expect(MockIntersectionObserver.latest()!.options.rootMargin).toBe('0px 0px 200px 0px');
    expect(MockIntersectionObserver.latest()!.options.root).toBe(el);
    MockIntersectionObserver.latest()!.trigger();
    MockIntersectionObserver.latest()!.trigger(); // ignored while loading
    await flush();
    expect(pages).toBe(1);
    MockIntersectionObserver.latest()!.trigger(); // a fresh observer after the load
    await flush();
    expect(pages).toBe(2);
    expect(loaded).toHaveBeenCalledTimes(2);
    MockIntersectionObserver.latest()?.trigger();
    await flush();
    expect(pages).toBe(2);
    m.destroy();
    expect(sentinel.isConnected).toBe(false); // regression: sentinel removed
  });

  it('pages a ListView by id and reports errors', async () => {
    const app = new Arethesis();
    const view = app.listViews.getOrCreate({ id: 'v', type: 'T' });
    app.listViews.setLoader(async () => ({ ids: ['1'], page: { nextCursor: null } }));
    app.listViews.populate('v', [], { nextCursor: 'c' });
    const el = html('<div><div class="end"></div></div>');
    infiniteScrollMixin(el, { view: 'v', sentinel: '.end', root: 'viewport' });
    MockIntersectionObserver.latest()!.trigger();
    await flush();
    expect(view.ids).toEqual(['1']);
    const failing = html('<div></div>');
    const error = vi.fn();
    failing.addEventListener('infinite-scroll:error', error);
    const prevented = html('<div></div>');
    prevented.addEventListener('infinite-scroll:load', e => e.preventDefault());
    const loadMore = vi.fn();
    const p = infiniteScrollMixin(prevented, { loadMore, root: 'self' });
    await (p.load as () => Promise<void>)();
    expect(loadMore).not.toHaveBeenCalled();
    const f = infiniteScrollMixin(failing, { loadMore: () => Promise.reject(new Error('x')), root: 'body' });
    await (f.load as () => Promise<void>)();
    expect(error).toHaveBeenCalled();
    app.destroy();
  });
});

describe('sortable', () => {
  const list = (label = 'List') => html(`<ul aria-label="${label}"><li data-id="a">A</li><li data-id="b">B</li><li data-id="c">C</li></ul>`);
  const order = (ul: Element) => Array.from(ul.children).map(c => c.getAttribute('data-id'));

  it('reorders with the keyboard and announces each step', async () => {
    vi.useFakeTimers();
    const ul = list();
    const end = vi.fn();
    ul.addEventListener('sortable:end', e => end((e as CustomEvent).detail));
    const m = sortableMixin(ul, {});
    const a = ul.querySelector<HTMLElement>('[data-id=a]')!;
    expect(a.tabIndex).toBe(0);
    expect(ul.getAttribute('role')).toBe('list');
    a.focus();
    key(a, ' ');
    expect(a.getAttribute('aria-grabbed')).toBe('true');
    key(a, 'ArrowDown');
    key(a, 'ArrowDown');
    key(a, 'ArrowDown'); // already last
    expect(order(ul)).toEqual(['b', 'c', 'a']);
    key(a, 'Enter');
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', oldIndex: 0, newIndex: 2 }));
    vi.advanceTimersByTime(50);
    expect(document.querySelector('[aria-live]')!.textContent).toMatch(/dropped at position 3 of 3/);
    expect((m.toArray as () => string[])()).toEqual(['b', 'c', 'a']);
    key(a, ' ');
    key(a, 'ArrowUp');
    key(a, 'Escape');
    expect(order(ul)).toEqual(['b', 'c', 'a']); // cancelled
    key(a, ' ');
    key(a, 'Tab'); // ignored keys
    key(a, ' ');
    expect(order(ul)).toEqual(['b', 'c', 'a']);
  });

  it('moves between containers in a group and reverts prevented drops', () => {
    const todo = list('To do');
    const done = html('<ul aria-label="Done"><li data-id="x">X</li></ul>');
    sortableMixin(todo, { group: 'board' });
    sortableMixin(done, { group: 'board' });
    const b = todo.querySelector<HTMLElement>('[data-id=b]')!;
    key(b, 'Enter');
    key(b, 'ArrowRight');
    expect(order(done)).toEqual(['x', 'b']);
    key(b, 'ArrowLeft');
    key(b, 'ArrowRight');
    done.addEventListener('sortable:end', e => e.preventDefault());
    todo.addEventListener('sortable:end', e => e.preventDefault());
    key(b, 'Enter');
    expect(order(todo)).toEqual(['a', 'b', 'c']);
    expect(order(done)).toEqual(['x']);
  });

  const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

  /**
   * Fake layout (happy-dom has none): children of each container are laid out
   * in `cols` columns of 100×40 cells starting at `origin`. A lifted item
   * (position: fixed) is where its left/top say.
   */
  function layout(container: HTMLElement, origin: [number, number], cols = 1, size: [number, number] = [100, 40]) {
    const [w, h] = size;
    const place = (el: HTMLElement) =>
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => {
        if (el.style.position === 'fixed') return new DOMRect(parseFloat(el.style.left), parseFloat(el.style.top), w, h);
        const parent = el.parentElement as HTMLElement;
        const flow = Array.from(parent.children).filter(c => (c as HTMLElement).style.position !== 'fixed');
        const i = flow.indexOf(el);
        const [ox, oy] = parent === container ? origin : (parent as HTMLElement & { origin: [number, number] }).origin;
        return new DOMRect(ox + (i % cols) * w, oy + Math.floor(i / cols) * h, w, h);
      });
    (container as HTMLElement & { origin: [number, number] }).origin = origin;
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => {
      const rows = Math.max(1, Math.ceil(container.children.length / cols));
      return new DOMRect(origin[0], origin[1], cols * w, rows * h);
    });
    for (const child of Array.from(container.children)) place(child as HTMLElement);
    // Placeholders are created during the drag: lay them out too.
    new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => n instanceof HTMLElement && !vi.isMockFunction(n.getBoundingClientRect) && place(n)))).observe(container, { childList: true });
  }

  it('drags with a pointer: the item stays in its container and lands where the placeholder is', async () => {
    const ul = list();
    layout(ul, [0, 0]);
    const onEnd = vi.fn();
    const moves = vi.fn();
    ul.addEventListener('sortable:move', e => moves((e as CustomEvent).detail.index));
    sortableMixin(ul, { onEnd, animation: 0 });
    const [a] = Array.from(ul.children) as HTMLElement[];
    pointer(a, 'pointerdown', 50, 20);
    pointer(document.body, 'pointermove', 50, 23); // under the activation distance: still a click
    expect(document.querySelector('.sortable-placeholder')).toBeNull();
    pointer(document.body, 'pointermove', 50, 30);
    // Lifted, but never re-parented (components inside keep their state).
    expect(a.parentElement).toBe(ul);
    expect(a.classList.contains('is-sorting')).toBe(true);
    expect(a.style.position).toBe('fixed');
    expect(document.documentElement.classList.contains('is-sorting-active')).toBe(true);
    pointer(document.body, 'pointermove', 50, 110); // over the bottom half of "c"
    await frame();
    expect(order(ul)).toEqual(['a', 'b', 'c', null]); // a (lifted), b, c, then the placeholder
    expect(moves).toHaveBeenLastCalledWith(2);
    pointer(document.body, 'pointerup', 50, 110);
    expect(order(ul)).toEqual(['b', 'c', 'a']);
    expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ oldIndex: 0, newIndex: 2 }));
    expect(a.getAttribute('style')).toBeNull(); // styles restored
    expect(document.documentElement.classList.contains('is-sorting-active')).toBe(false);
    // A click without movement doesn't sort.
    pointer(ul.children[0], 'pointerdown', 50, 5);
    pointer(document.body, 'pointerup', 50, 5);
    expect(order(ul)).toEqual(['b', 'c', 'a']);
    // A cancelled drag leaves everything where it was.
    pointer(ul.children[0], 'pointerdown', 50, 5);
    pointer(document.body, 'pointermove', 50, 90);
    await frame();
    pointer(document.body, 'pointercancel', 50, 90);
    expect(order(ul)).toEqual(['b', 'c', 'a']);
    expect(document.querySelector('.sortable-placeholder')).toBeNull();
  });

  it('finds the drop position in two dimensions, for grids and wrapping rows', async () => {
    const grid = html('<div>' + 'abcdef'.split('').map(id => `<div data-id="${id}">${id}</div>`).join('') + '</div>');
    layout(grid, [0, 0], 3); // a b c / d e f
    sortableMixin(grid, { direction: 'horizontal', animation: 0 });
    const a = grid.querySelector<HTMLElement>('[data-id=a]')!;
    pointer(a, 'pointerdown', 50, 20);
    pointer(document.body, 'pointermove', 60, 20);
    // Over the right half of "e" (second row, middle).
    pointer(document.body, 'pointermove', 170, 60);
    await frame();
    pointer(document.body, 'pointerup', 170, 60);
    expect(order(grid)).toEqual(['b', 'c', 'd', 'e', 'a', 'f']);
    // Just below the last item: the end.
    const b = grid.querySelector<HTMLElement>('[data-id=b]')!;
    pointer(b, 'pointerdown', 50, 20);
    pointer(document.body, 'pointermove', 60, 20);
    pointer(document.body, 'pointermove', 270, 100);
    await frame();
    pointer(document.body, 'pointerup', 270, 100);
    expect(order(grid)).toEqual(['c', 'd', 'e', 'a', 'f', 'b']);
  });

  it('drops into the closest container in a group, even from the gap between them', async () => {
    const todo = list('To do');
    const done = html('<ul aria-label="Done"><li data-id="x">X</li></ul>');
    const empty = html('<ul aria-label="Later"></ul>');
    layout(todo, [0, 0]);
    layout(done, [140, 0]);
    layout(empty, [400, 0]);
    sortableMixin(todo, { group: 'gap', animation: 0 });
    sortableMixin(done, { group: 'gap', animation: 0 });
    sortableMixin(empty, { group: 'gap', animation: 0 });
    const end = vi.fn();
    todo.addEventListener('sortable:end', e => end((e as CustomEvent).detail));
    const b = todo.querySelector<HTMLElement>('[data-id=b]')!;
    pointer(b, 'pointerdown', 50, 60);
    pointer(document.body, 'pointermove', 60, 60);
    // In the 40px gap between the lists, nearer "Done", below its only item.
    pointer(document.body, 'pointermove', 125, 30);
    await frame();
    pointer(document.body, 'pointerup', 125, 30);
    expect(order(done)).toEqual(['x', 'b']);
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', from: todo, to: done, newIndex: 1 }));
    // Far from every list: nothing changes.
    const c = todo.querySelector<HTMLElement>('[data-id=c]')!;
    pointer(c, 'pointerdown', 50, 60);
    pointer(document.body, 'pointermove', 60, 60);
    pointer(document.body, 'pointermove', 50, 900);
    await frame();
    pointer(document.body, 'pointerup', 50, 900);
    expect(order(todo)).toEqual(['a', 'c']);
    // An empty list accepts a drop.
    pointer(c, 'pointerdown', 50, 60);
    pointer(document.body, 'pointermove', 60, 60);
    pointer(document.body, 'pointermove', 420, 10);
    await frame();
    pointer(document.body, 'pointerup', 420, 10);
    expect(order(empty)).toEqual(['c']);
  });

  it('keeps the slot while the pointer is over it, and prefers the item under the pointer', async () => {
    // A wrapping row of mixed sizes: a wide item "w" (200px) and small ones.
    const row = html('<div><div data-id="s1">1</div><div data-id="w">W</div><div data-id="s2">2</div><div data-id="s3">3</div></div>');
    const boxes: Record<string, [number, number, number, number]> = { s1: [0, 0, 100, 40], w: [100, 0, 200, 40], s2: [0, 40, 100, 40], s3: [100, 40, 100, 40] };
    for (const el of Array.from(row.children) as HTMLElement[]) {
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => {
        if (el.style.position === 'fixed') return new DOMRect(parseFloat(el.style.left), parseFloat(el.style.top), 100, 40);
        return new DOMRect(...boxes[el.dataset.id!]);
      });
    }
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 80));
    sortableMixin(row, { direction: 'horizontal', animation: 0 });
    const moves = vi.fn();
    row.addEventListener('sortable:move', e => moves((e as CustomEvent).detail.index));
    const s3 = row.querySelector<HTMLElement>('[data-id=s3]')!;
    pointer(s3, 'pointerdown', 150, 60);
    pointer(document.body, 'pointermove', 160, 60);
    const placeholder = row.querySelector<HTMLElement>('.sortable-placeholder')!;
    vi.spyOn(placeholder, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 40, 100, 40));
    // Still over its own slot: nothing moves.
    pointer(document.body, 'pointermove', 120, 70);
    await frame();
    expect(moves).not.toHaveBeenCalled();
    // Over the right half of the wide item, whose centre is far away: lands after it.
    pointer(document.body, 'pointermove', 280, 10);
    await frame();
    expect(moves).toHaveBeenLastCalledWith(2);
    pointer(document.body, 'pointerup', 280, 10);
    expect(order(row)).toEqual(['s1', 'w', 's3', 's2']);
  });

  it('ignores tiny movements right after a reorder, so items do not flicker', async () => {
    const ul = list();
    layout(ul, [0, 0]);
    const moves = vi.fn();
    ul.addEventListener('sortable:move', moves);
    sortableMixin(ul, { animation: 0 });
    pointer(ul.children[0], 'pointerdown', 50, 20);
    pointer(document.body, 'pointermove', 50, 30);
    pointer(document.body, 'pointermove', 50, 70); // over b's lower half
    await frame();
    expect(moves).toHaveBeenCalledTimes(1);
    pointer(document.body, 'pointermove', 50, 66); // back across the boundary by 4px
    await frame();
    expect(moves).toHaveBeenCalledTimes(1);
    pointer(document.body, 'pointerup', 50, 66);
  });

  it('on touch, starts after a press and lets a quick swipe scroll', async () => {
    vi.useFakeTimers();
    const ul = list();
    layout(ul, [0, 0]);
    sortableMixin(ul, { animation: 0, touchDelay: 200 });
    const a = ul.children[0] as HTMLElement;
    const touch = { pointerType: 'touch' };
    // Swiping straight away is a scroll, not a drag.
    pointer(a, 'pointerdown', 50, 20, touch);
    pointer(document.body, 'pointermove', 50, 60, touch);
    vi.advanceTimersByTime(300);
    expect(a.style.position).toBe('');
    pointer(document.body, 'pointerup', 50, 60, touch);
    // Press and hold, then drag.
    pointer(a, 'pointerdown', 50, 20, touch);
    vi.advanceTimersByTime(150);
    expect(a.style.position).toBe('');
    vi.advanceTimersByTime(60);
    expect(a.style.position).toBe('fixed');
    // While dragging, the page doesn't scroll under the finger.
    const touchmove = new Event('touchmove', { cancelable: true });
    document.dispatchEvent(touchmove);
    expect(touchmove.defaultPrevented).toBe(true);
    pointer(document.body, 'pointermove', 50, 110, touch);
    vi.advanceTimersByTime(20);
    pointer(document.body, 'pointerup', 50, 110, touch);
    expect(order(ul)).toEqual(['b', 'c', 'a']);
    // A press released before the delay is a tap.
    pointer(ul.children[0], 'pointerdown', 50, 20, touch);
    pointer(document.body, 'pointerup', 50, 20, touch);
    vi.advanceTimersByTime(300);
    expect((ul.children[0] as HTMLElement).style.position).toBe('');
  });

  it('auto-scrolls a scrollable container near its edges', async () => {
    const ul = list();
    layout(ul, [0, 0]);
    Object.assign(ul.style, { overflowY: 'auto', height: '200px' });
    Object.defineProperty(ul, 'scrollHeight', { value: 600 });
    Object.defineProperty(ul, 'clientHeight', { value: 200 });
    let scrollTop = 0;
    Object.defineProperty(ul, 'scrollTop', { get: () => scrollTop, set: v => (scrollTop = v) });
    const scrollBy = vi.fn((_x: number, y: number) => { scrollTop += y; });
    ul.scrollBy = scrollBy as unknown as typeof ul.scrollBy;
    vi.spyOn(ul, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 200));
    sortableMixin(ul, { animation: 0 });
    pointer(ul.children[0], 'pointerdown', 50, 20);
    pointer(document.body, 'pointermove', 50, 30);
    pointer(document.body, 'pointermove', 50, 196); // 4px from the bottom edge
    await frame();
    await frame();
    expect(scrollBy).toHaveBeenCalled();
    expect(scrollBy.mock.calls[0][1]).toBeGreaterThan(10); // fast, close to the edge
    pointer(document.body, 'pointermove', 50, 100); // away from the edge: stops
    await frame();
    const calls = scrollBy.mock.calls.length;
    await frame();
    await frame();
    expect(scrollBy.mock.calls.length).toBe(calls);
    pointer(document.body, 'pointerup', 50, 100);
  });

  it('animates neighbours and the drop, unless the user prefers reduced motion', async () => {
    const ul = list();
    layout(ul, [0, 0]);
    const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
    for (const li of Array.from(ul.children)) (li as HTMLElement).animate = animate as unknown as HTMLElement['animate'];
    const end = vi.fn();
    ul.addEventListener('sortable:end', end);
    sortableMixin(ul, { animation: 180 });
    const a = ul.children[0] as HTMLElement;
    pointer(a, 'pointerdown', 50, 20);
    pointer(document.body, 'pointermove', 50, 30);
    pointer(document.body, 'pointermove', 50, 110);
    await frame();
    expect(animate).toHaveBeenCalled(); // b and c slide up
    const cancel = vi.fn();
    const glide = { finished: Promise.resolve(), cancel };
    a.animate = vi.fn(() => glide) as unknown as HTMLElement['animate'];
    end.mockImplementation(() => expect(cancel).toHaveBeenCalled()); // settled before sortable:end
    pointer(document.body, 'pointerup', 50, 110);
    expect(end).not.toHaveBeenCalled(); // still gliding into place
    await flush();
    expect(end).toHaveBeenCalled();
    expect(order(ul)).toEqual(['b', 'c', 'a']);

    // Reduced motion: no animation, and the drop is immediate.
    animate.mockClear();
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    pointer(ul.children[0], 'pointerdown', 50, 20);
    pointer(document.body, 'pointermove', 50, 30);
    pointer(document.body, 'pointermove', 50, 110);
    await frame();
    pointer(document.body, 'pointerup', 50, 110);
    expect(animate).not.toHaveBeenCalled();
    expect(order(ul)).toEqual(['c', 'a', 'b']);
    media.mockRestore();
  });

  it('respects handles and ignores interactive children', () => {
    const ul = html('<ul><li data-id="a"><span class="grip">≡</span><button>b</button>A</li><li data-id="b">B</li></ul>');
    const m = sortableMixin(ul, { handle: '.grip', group: 'g2' });
    pointer(ul.querySelector('button')!, 'pointerdown', 0, 0);
    pointer(document.body, 'pointermove', 0, 50);
    expect(document.querySelector('.sortable-placeholder')).toBeNull();
    pointer(ul.querySelector('li')!, 'pointerdown', 0, 0);
    pointer(document.body, 'pointermove', 0, 50);
    expect(document.querySelector('.sortable-placeholder')).toBeNull();
    m.destroy();
  });
});

describe('resizable', () => {
  it('resizes with pointer and keyboard within limits', () => {
    const el = html('<div style="width:100px;height:50px"></div>');
    let size = { width: 100, height: 50 };
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, size.width, size.height));
    const onEnd = vi.fn();
    const m = resizableMixin(el, { handles: ['e', 'se', 'n', 'w'], minWidth: 80, maxWidth: 200, onEnd });
    const east = el.querySelector<HTMLElement>('.resize-handle--e')!;
    expect(east.getAttribute('role')).toBe('separator');
    expect(east.getAttribute('aria-orientation')).toBe('vertical');
    expect(east.getAttribute('aria-valuenow')).toBe('100');
    pointer(east, 'pointerdown', 100, 0);
    pointer(east, 'pointermove', 400, 0);
    expect(el.style.width).toBe('200px');
    size = { width: 200, height: 50 };
    pointer(east, 'pointerup', 400, 0);
    expect(onEnd).toHaveBeenCalledWith({ width: 200, height: 50 });
    key(east, 'ArrowLeft', { shiftKey: true });
    expect(el.style.width).toBe('150px');
    key(east, 'x');
    const se = el.querySelector<HTMLElement>('.resize-handle--se')!;
    pointer(se, 'pointerdown', 0, 0);
    pointer(se, 'pointermove', -500, 30);
    expect(el.style.width).toBe('80px');
    pointer(se, 'pointercancel', 0, 0);
    const west = el.querySelector<HTMLElement>('.resize-handle--w')!;
    pointer(west, 'pointerdown', 0, 0);
    pointer(west, 'pointermove', -20, 0);
    pointer(west, 'pointerup', 0, 0);
    const north = el.querySelector<HTMLElement>('.resize-handle--n')!;
    pointer(north, 'pointerdown', 0, 0);
    pointer(north, 'pointermove', 0, -10);
    expect(el.style.height).toBe('60px');
    pointer(north, 'pointerdown', 0, 0, { button: 1 });
    expect((m.size as () => unknown)()).toEqual({ width: 200, height: 50 });
    m.destroy();
    expect(el.querySelector('.resize-handle')).toBeNull();
  });

  it('fixes a flex item\'s basis so a new width sticks, within its container', () => {
    const row = html('<div style="display:flex;flex-direction:row"><section style="flex:1"></section><section style="flex:1"></section></div>');
    const panel = row.querySelector<HTMLElement>('section')!;
    vi.spyOn(row, 'clientWidth', 'get').mockReturnValue(600);
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 100));
    resizableMixin(panel, { handles: ['e', 's'], minWidth: 100 });
    const east = panel.querySelector<HTMLElement>('.resize-handle--e')!;
    pointer(east, 'pointerdown', 0, 0);
    pointer(east, 'pointermove', 50, 0);
    expect(panel.style.flex).toBe('0 0 auto');
    expect(panel.style.width).toBe('350px');
    pointer(east, 'pointermove', 5000, 0);
    expect(panel.style.width).toBe('600px'); // never wider than the row
    pointer(east, 'pointerup', 0, 0);

    // Height is the cross axis of a row: the flex basis is left alone.
    const other = row.querySelectorAll<HTMLElement>('section')[1];
    vi.spyOn(other, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 100));
    resizableMixin(other, { handles: ['s'] });
    const south = other.querySelector<HTMLElement>('.resize-handle--s')!;
    pointer(south, 'pointerdown', 0, 0);
    pointer(south, 'pointermove', 0, 40);
    expect(other.style.height).toBe('140px');
    expect(other.style.flex).toBe('1 1 0%');
  });
});

describe('dropdown', () => {
  const select = () => html('<select aria-label="Role"><option value="">Pick</option><option value="dev">Developer</option><option value="des">Designer</option><option value="pm" disabled>PM</option></select>') as HTMLSelectElement;

  it('builds an ARIA combobox that filters and selects', async () => {
    const sel = select();
    const changes = vi.fn();
    sel.addEventListener('change', changes);
    const m = dropdownMixin(sel, { emptyText: 'Nothing' });
    const input = document.querySelector<HTMLInputElement>('.dropdown__input')!;
    const list = document.querySelector<HTMLElement>('.dropdown__list')!;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-label')).toBe('Role');
    expect(sel.getAttribute('aria-hidden')).toBe('true');
    input.value = 'des';
    input.dispatchEvent(new Event('input'));
    expect(list.hidden).toBe(false);
    expect(list.querySelectorAll('[role=option]')).toHaveLength(1);
    key(input, 'Enter');
    expect(sel.value).toBe('des');
    expect(input.value).toBe('Designer');
    expect(changes).toHaveBeenCalledTimes(1);
    key(input, 'ArrowDown');
    expect(list.hidden).toBe(false);
    key(input, 'ArrowDown');
    key(input, 'End');
    key(input, 'Home');
    key(input, 'ArrowUp');
    expect(input.getAttribute('aria-activedescendant')).toMatch(/opt-3$/);
    key(input, 'Escape');
    expect(list.hidden).toBe(true);
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    expect(list.textContent).toBe('Nothing');
    key(input, 'Tab');
    expect(input.value).toBe('Designer');
    input.click();
    list.querySelectorAll<HTMLElement>('[role=option]')[1].click();
    expect(sel.value).toBe('dev');
    input.click();
    input.click();
    key(input, 'ArrowUp');
    input.dispatchEvent(new Event('blur'));
    sel.value = 'des';
    sel.dispatchEvent(new Event('change'));
    expect(input.value).toBe('Designer');
    (m.refresh as () => void)();
    sel.setAttribute('aria-invalid', 'true');
    sel.classList.add('is-invalid');
    await Promise.resolve();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.classList.contains('is-invalid')).toBe(true);
    expect(sel.previousElementSibling?.classList.contains('dropdown')).toBe(true);
    m.destroy();
    expect(document.querySelector('.dropdown')).toBeNull();
    expect(sel.hasAttribute('aria-hidden')).toBe(false);
  });

  it('requires a select and links labels', () => {
    expect(() => dropdownMixin(html('<div></div>'))).toThrow();
    const wrap = html('<div><label for="s">Team</label><select id="s"><option>a</option></select></div>');
    dropdownMixin(wrap.querySelector('select')!, { searchable: false });
    const input = wrap.querySelector('input')!;
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('aria-labelledby')).toBe(wrap.querySelector('label')!.id);
    key(input, 'Enter');
    expect(wrap.querySelector<HTMLElement>('.dropdown__list')!.hidden).toBe(false);
  });
});

describe('tooltip', () => {
  it('shows on hover after a delay and on focus, hides on Escape', () => {
    vi.useFakeTimers();
    const btn = html('<button title="Save changes">S</button>');
    const m = tooltipMixin(btn, { delay: 100 });
    expect(btn.hasAttribute('title')).toBe(false);
    const tipId = btn.getAttribute('aria-describedby')!;
    btn.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(99);
    expect(document.getElementById(tipId)).toBeNull();
    vi.advanceTimersByTime(1);
    const tip = document.getElementById(tipId)!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toBe('Save changes');
    expect(tip.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tip.hidden).toBe(true);
    btn.dispatchEvent(new FocusEvent('focus'));
    expect(tip.hidden).toBe(false);
    (m.setContent as (s: string) => void)('Saved!');
    expect(tip.textContent).toBe('Saved!');
    btn.dispatchEvent(new FocusEvent('blur'));
    btn.dispatchEvent(new PointerEvent('pointerenter'));
    btn.dispatchEvent(new PointerEvent('pointerleave'));
    vi.advanceTimersByTime(200);
    expect(tip.hidden).toBe(true);
    m.destroy();
    expect(btn.getAttribute('title')).toBe('Save changes');
    expect(btn.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps existing describedby and skips empty content', () => {
    const el = html('<span aria-describedby="x" data-tooltip=""></span>');
    const m = tooltipMixin(el);
    (m.show as () => void)();
    expect(document.querySelector('.tooltip')).toBeNull();
    m.destroy();
    expect(el.getAttribute('aria-describedby')).toBe('x');
  });
});

describe('context-menu', () => {
  const items = [{ label: 'Open', action: 'open', shortcut: '↵' }, { separator: true }, { label: 'Archive', action: 'archive', disabled: true }, { label: 'Delete', action: 'delete', danger: true }];

  it('opens on right-click, navigates with the keyboard and selects', () => {
    const host = html('<ul><li data-id="1">One</li><li data-id="2">Two</li></ul>');
    const selected = vi.fn();
    host.addEventListener('context-menu:select', e => selected((e as CustomEvent).detail));
    const m = contextMenuMixin(host, { items, target: 'li' });
    const li = host.querySelector('[data-id="2"]')!;
    li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const menu = document.querySelector<HTMLElement>('[role=menu]')!;
    expect(menu).not.toBeNull();
    expect(menu.querySelectorAll('[role=menuitem]')).toHaveLength(3);
    expect(document.activeElement?.textContent).toContain('Open');
    key(menu, 'ArrowDown'); // skips the disabled item
    expect(document.activeElement?.textContent).toBe('Delete');
    key(menu, 'ArrowDown');
    key(menu, 'End');
    key(menu, 'Home');
    key(menu, 'ArrowUp');
    key(menu, 'o'); // typeahead
    expect(document.activeElement?.textContent).toContain('Open');
    key(menu, 'Enter');
    expect(selected).toHaveBeenCalledWith({ action: 'open', target: li });
    expect((m.isOpen as () => boolean)()).toBe(false);
  });

  it('opens from the keyboard, closes on Escape/outside click, and supports click selection', () => {
    const host = html('<div tabindex="0">Card</div>');
    const onSelect = vi.fn();
    const m = contextMenuMixin(host, { items, onSelect });
    expect(host.getAttribute('aria-haspopup')).toBe('menu');
    key(host, 'F10', { shiftKey: true });
    expect(host.getAttribute('aria-expanded')).toBe('true');
    key(document.querySelector('[role=menu]')!, 'Escape');
    expect(document.querySelector('[role=menu]')).toBeNull();
    key(host, 'ContextMenu');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.querySelector('[role=menu]')).toBeNull();
    (m.open as (x: number, y: number) => void)(0, 0);
    document.querySelector<HTMLElement>('.is-danger')!.click();
    expect(onSelect).toHaveBeenCalledWith('delete', host);
    (m.open as (x: number, y: number) => void)(0, 0);
    document.querySelector<HTMLElement>('[aria-disabled=true]')!.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('resize'));
    expect(document.querySelector('[role=menu]')).toBeNull();
    key(host, 'a');
    m.destroy();
    expect(host.hasAttribute('aria-haspopup')).toBe(false);
  });
});

describe('mixin utils', () => {
  it('announces and positions floating elements', () => {
    vi.useFakeTimers();
    announce('Hello');
    vi.advanceTimersByTime(50);
    expect(document.querySelector('[aria-live]')!.textContent).toBe('Hello');
    const tip = html('<div></div>');
    vi.spyOn(tip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 20));
    expect(placeFloating(tip, new DOMRect(100, 5, 10, 10), 'top')).toBe('bottom'); // flips: no room above
    expect(placeFloating(tip, new DOMRect(100, 300, 10, 10), 'left')).toBe('left');
    expect(placeFloating(tip, new DOMRect(100, 300, 10, 10), 'right')).toBe('right');
    expect(placeFloating(tip, new DOMRect(100, 300, 10, 10), 'bottom')).toBe('bottom');
  });
});

describe('listbox', () => {
  it('moves through options without committing, then picks', async () => {
    const { listboxMixin } = await import('../listbox');
    const el = html('<div aria-label="Fruit"></div>');
    const changes: string[] = [];
    const commits: string[] = [];
    el.addEventListener('listbox:change', e => changes.push((e as CustomEvent).detail.value));
    el.addEventListener('listbox:commit', e => commits.push((e as CustomEvent).detail.key));
    const m = listboxMixin(el, { options: ['apple', { value: 'b', label: 'banana' }, { value: 'c', label: 'cherry', disabled: true }, 'date'], value: 'b' });
    expect(el.getAttribute('role')).toBe('combobox');
    expect(el.textContent).toBe('banana');
    const list = document.getElementById(el.getAttribute('aria-controls')!)!;
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.hidden).toBe(true);
    key(el, 'ArrowDown'); // opens
    expect(el.getAttribute('aria-expanded')).toBe('true');
    key(el, 'ArrowDown'); // skips the disabled cherry
    expect((m.getActiveValue as () => string)()).toBe('date');
    expect(changes).toEqual([]);
    key(el, 'Home');
    expect((m.getActiveValue as () => string)()).toBe('apple');
    key(el, 'd'); // type-ahead
    expect((m.getActiveValue as () => string)()).toBe('date');
    key(el, 'Enter');
    expect(changes).toEqual(['date']);
    expect(commits).toEqual(['Enter']);
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(el.textContent).toBe('date');

    key(el, ' ');
    key(el, 'ArrowUp');
    key(el, 'Escape');
    expect((m.getValue as () => string)()).toBe('date');
    // Clicking an option picks it.
    (m.open as () => void)();
    (list.children[0] as HTMLElement).click();
    expect((m.getValue as () => string)()).toBe('apple');
    expect(commits.at(-1)).toBe('click');
    m.destroy();
    expect(list.isConnected).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
  });
});

describe('editable select', () => {
  it("doesn't save when arrow keys change a closed select", async () => {
    const el = html('<div>a</div>');
    const saved = vi.fn();
    el.addEventListener('editable:save', saved);
    editableMixin(el, { type: 'select', choices: ['a', 'b', 'c'] });
    key(el, 'F2');
    const select = el.querySelector('select')!;
    key(select, 'ArrowDown');
    select.value = 'b';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(saved).not.toHaveBeenCalled();
    expect(el.querySelector('select')).not.toBeNull();
    key(select, 'Enter');
    await flush();
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ detail: { value: 'b', previous: 'a' } }));
  });
});
