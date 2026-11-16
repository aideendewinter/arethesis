import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Arethesis, getArethesis } from '../../core/arethesis';
import '../index';
import type { DataTable } from '../data-table';
import type { FlexView } from '../flex-view';
import type { List } from '../list';
import type { Form } from '../form';
import { Component } from '../../components/component';
import { defineComponent } from '../../components/decorators';
import { flush, mockFetch, type RouteHandler } from '../../../test/helpers';
import { MockIntersectionObserver } from '../../../test/intersection';

function setup(handler: RouteHandler) {
  Arethesis.resetInstance();
  const app = getArethesis();
  const fetch = mockFetch(handler);
  app.http.configure({ baseUrl: '/api', fetch, retry: false });
  return { app, fetch };
}

beforeEach(() => MockIntersectionObserver.install());
afterEach(() => Arethesis.resetInstance());

const people = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}`, salary: 1000 * (i + 1), role: i % 2 ? 'dev' : 'design' }));

describe('<a-data-table>', () => {
  function tableApp(saveStatus = 200) {
    const ctx = setup((url, init) => {
      if (url.pathname.startsWith('/api/people/') && init.method === 'PATCH') {
        if (saveStatus !== 200) return { status: saveStatus };
        const body = JSON.parse(String(init.body));
        return { body: { ...people[0], ...body } };
      }
      const sort = url.searchParams.get('sort');
      const items = sort === 'name:desc' ? [...people].reverse() : people;
      const cursor = url.searchParams.get('cursor');
      return { body: { items: cursor ? items.slice(3) : items.slice(0, 3), next: cursor ? null : 'p2', total: 5 } };
    });
    ctx.app.defineEndpoint('listPeople', { url: '/people', type: 'Person', list: true, mapping: { dataPath: 'items' }, pagination: { cursorPath: 'next', totalCountPath: 'total' } });
    ctx.app.defineEndpoint('updatePerson', { url: '/people/:id', method: 'PATCH' });
    return ctx;
  }

  async function mountTable(app: Arethesis, extra: Partial<Parameters<DataTable['configure']>[0]> = {}) {
    const table = document.createElement('a-data-table') as DataTable;
    document.body.appendChild(table);
    table.configure({
      caption: 'People',
      list: { type: 'Person', endpoint: 'listPeople', pageSize: 3 },
      columns: [
        { field: 'name', label: 'Name', sortable: true, editable: { validation: { rules: [{ type: 'required' }, { type: 'minLength', params: { min: 2 } }] } } },
        { field: 'role', label: 'Role', displayType: 'badge' },
        { field: 'salary', label: 'Salary', displayType: 'currency', align: 'end', editable: true, bind: { locale: 'en-US' } },
      ],
      save: { endpoint: 'updatePerson' },
      ...extra,
    });
    await table.ready;
    await flush(8);
    void app;
    return table;
  }

  const names = (table: Element) => Array.from(table.querySelectorAll('tbody td[data-col=name]')).map(td => td.textContent);

  it('renders headers, rows, status and pages with infinite scroll', async () => {
    const { app } = tableApp();
    const table = await mountTable(app);
    expect(table.querySelector('table')!.getAttribute('aria-label')).toBe('People');
    expect(Array.from(table.querySelectorAll('thead th')).map(th => th.textContent?.replace(/[↕▲▼]/g, ''))).toEqual(['Name', 'Role', 'Salary']);
    expect(names(table)).toEqual(['Person 1', 'Person 2', 'Person 3']);
    expect(table.querySelector('tbody td[data-col=salary]')!.textContent).toBe('$1,000.00');
    expect(table.querySelector('tbody td[data-col=role] .badge')!.textContent).toBe('design');
    expect(table.querySelector('.ar-table__status')!.textContent).toBe('Showing 3 of 5');
    expect(table.querySelector('table')!.getAttribute('aria-rowcount')).toBe('5');
    MockIntersectionObserver.latest()!.trigger();
    await flush(8);
    expect(names(table)).toHaveLength(5);
    expect(table.view!.hasMore).toBe(false);
  });

  it('sorts from the header and reflects aria-sort', async () => {
    const { app, fetch } = tableApp();
    const table = await mountTable(app);
    table.querySelector<HTMLButtonElement>('th[data-col=name] button')!.click();
    await flush(8);
    expect(table.querySelector('th[data-col=name]')!.getAttribute('aria-sort')).toBe('ascending');
    table.querySelector<HTMLButtonElement>('th[data-col=name] button')!.click();
    await flush(8);
    expect(table.querySelector('th[data-col=name]')!.getAttribute('aria-sort')).toBe('descending');
    expect(fetch.calls.at(-1)!.url).toContain('sort=name%3Adesc');
    expect(names(table)[0]).toBe('Person 5');
    await table.setFilters({ role: 'dev' });
    expect(fetch.calls.at(-1)!.url).toContain('role=dev');
  });

  it('selects rows with click and Space', async () => {
    const { app } = tableApp();
    const table = await mountTable(app);
    const selected = vi.fn();
    table.on('row-select', selected);
    table.querySelectorAll<HTMLElement>('tbody td')[3].click();
    expect(selected).toHaveBeenCalledWith({ id: '2' }, expect.anything());
    expect(table.selected).toBe('2');
    expect(table.querySelector('tbody tr[data-id="2"]')!.getAttribute('aria-selected')).toBe('true');
    const cell = table.querySelector<HTMLElement>('tbody tr[data-id="3"] td')!;
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(table.selected).toBe('3');
  });

  it('edits inline with validation and saves optimistically', async () => {
    const { app, fetch } = tableApp();
    const table = await mountTable(app);
    const saved = vi.fn();
    table.on('save', saved);
    const cell = table.querySelector<HTMLElement>('tbody tr[data-id="1"] td[data-col=name]')!;
    cell.focus();
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    let input = cell.querySelector('input')!;
    expect(input.value).toBe('Person 1');
    input.value = 'A';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush(5);
    expect(cell.querySelector('.editable-error')!.textContent).toBe('Must be at least 2 characters');
    input = cell.querySelector('input')!;
    input.value = 'Alice';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush(8);
    expect(cell.textContent).toBe('Alice');
    expect(app.store.getData('Person', '1')).toMatchObject({ name: 'Alice' });
    const patch = fetch.calls.find(c => c.init.method === 'PATCH')!;
    expect(patch.url).toContain('/api/people/1');
    expect(JSON.parse(String(patch.init.body))).toEqual({ name: 'Alice' });
    expect(saved).toHaveBeenCalled();

    // Numbers edit the raw value and re-render formatted; typing starts editing.
    const salary = table.querySelector<HTMLElement>('tbody tr[data-id="2"] td[data-col=salary]')!;
    salary.focus();
    salary.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true, cancelable: true }));
    const num = salary.querySelector('input')!;
    expect(num.type).toBe('number');
    expect(num.value).toBe('5');
    num.value = '2500';
    num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush(8);
    expect(salary.textContent).toBe('$2,500.00');
    // Escape cancels.
    salary.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    salary.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(salary.textContent).toBe('$2,500.00');
    // Read-only columns can't be edited.
    const role = table.querySelector<HTMLElement>('tbody tr[data-id="2"] td[data-col=role]')!;
    role.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(role.querySelector('input')).toBeNull();
  });

  it('rolls back failed saves', async () => {
    const { app } = tableApp(500);
    const table = await mountTable(app);
    const failed = vi.fn();
    table.on('save-error', failed);
    const cell = table.querySelector<HTMLElement>('tbody tr[data-id="1"] td[data-col=name]')!;
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = cell.querySelector('input')!;
    input.value = 'Nope';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush(10);
    expect(failed).toHaveBeenCalled();
    expect(app.store.getData('Person', '1')).toMatchObject({ name: 'Person 1' });
    expect(cell.textContent).toBe('Person 1');
    expect(table.querySelector('tr[data-id="1"]')!.classList.contains('is-error')).toBe(true);
  });

  it('supports function savers, an existing ListView and empty lists', async () => {
    const { app } = setup(() => ({ body: [] }));
    app.defineEndpoint('empty', { url: '/empty', type: 'Thing', list: true });
    const view = app.list({ type: 'Thing', endpoint: 'empty' });
    const save = vi.fn(async () => undefined);
    const table = document.createElement('a-data-table') as DataTable;
    document.body.appendChild(table);
    table.configure({ list: view, columns: [{ field: 'x', label: 'X', editable: true }], save, emptyText: 'Nothing yet' });
    await flush(8);
    expect(table.querySelector('.ar-table__empty td')!.textContent).toBe('Nothing yet');
    app.store.upsert('Thing', 'a', { x: 'one' });
    app.listViews.populate(view.id, ['a']);
    await flush(5);
    const cell = table.querySelector<HTMLElement>('td[data-col=x]')!;
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    cell.querySelector('input')!.value = 'two';
    cell.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(5);
    expect(save).toHaveBeenCalledWith('a', { x: 'two' });
    table.remove();
  });
});

describe('<a-flex-view>', () => {
  /** Lay panels out by hand: happy-dom has no layout engine. */
  function layout(view: FlexView, rects: Record<string, [left: number, top: number, width: number]>, containerWidth = 1000) {
    vi.spyOn(view.querySelector('.ar-flex')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, containerWidth, 500));
    for (const [key, [left, top, width]] of Object.entries(rects)) {
      const panel = view.querySelector<HTMLElement>(`[data-key=${key}]`)!;
      vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => new DOMRect(left, top, width, 200));
    }
  }

  async function splitView(children: Array<{ key: string; resizable?: boolean; flex?: string; minWidth?: string }>) {
    const { app } = setup(() => ({ body: {} }));
    const view = document.createElement('a-flex-view') as FlexView;
    document.body.appendChild(view);
    view.configure({ id: 'split', children: children.map(c => ({ title: c.key.toUpperCase(), component: 'div', minWidth: '100px', ...c })) });
    await flush(5);
    return { app, view, splitter: (key: string) => view.querySelector<HTMLElement>(`[data-key=${key}] > .ar-flex__splitter`)! };
  }

  const pointer = (el: Element, type: string, x: number) =>
    el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: 10, pointerId: 1, button: 0, bubbles: true, cancelable: true }));

  it('shares space between two neighbours with a splitter, keeping their total and the rest of the row', async () => {
    const { app, view, splitter } = await splitView([{ key: 'a' }, { key: 'b', flex: '3' }, { key: 'c' }]);
    // a | b | c on one row: 200 + 600 + 200 (flex 1 : 3 : 1).
    layout(view, { a: [0, 0, 200], b: [200, 0, 600], c: [800, 0, 200] });
    // Re-run the row check now that the mocked layout is in place.
    view.querySelector('.ar-flex')!.dispatchEvent(new CustomEvent('sortable:end'));
    await flush(2);

    const ab = splitter('a');
    expect(ab.hidden).toBe(false);
    expect(ab.getAttribute('role')).toBe('separator');
    expect(ab.getAttribute('aria-label')).toBe('Resize A and B');
    expect(ab.getAttribute('aria-controls')).toBe('split-panel-a split-panel-b');
    expect(ab.getAttribute('aria-valuenow')).toBe('25'); // 200 of 800
    expect(splitter('c').hidden).toBe(true); // nothing after the last panel

    // Drag the a|b boundary 200px right: a goes 200 → 400, b 600 → 400.
    pointer(ab, 'pointerdown', 200);
    pointer(ab, 'pointermove', 400);
    const grow = (k: string) => view.querySelector<HTMLElement>(`[data-key=${k}]`)!.style.flexGrow;
    expect(grow('a')).toBe('2');
    expect(grow('b')).toBe('2'); // the pair's total flex (4) is unchanged…
    expect(grow('c')).toBe('1'); // …and the rest of the row is untouched
    // b can't go below its 100px min-width: a stops at 700.
    pointer(ab, 'pointermove', 5000);
    expect(grow('a')).toBe('3.5');
    expect(grow('b')).toBe('0.5');
    pointer(ab, 'pointerup', 5000);
    expect(app.store.getData<{ sizes: Record<string, unknown> }>('ArLayout', 'split')!.sizes).toEqual({ a: { grow: 3.5 }, b: { grow: 0.5 } });
  });

  it('resizes the last panel in a row from its left edge, and hides splitters across row breaks', async () => {
    const { view, splitter } = await splitView([{ key: 'a' }, { key: 'b' }, { key: 'c' }]);
    // a | b on the first row, c alone on the second.
    layout(view, { a: [0, 0, 500], b: [500, 0, 500], c: [0, 216, 1000] });
    view.querySelector('.ar-flex')!.dispatchEvent(new CustomEvent('sortable:end'));
    await flush(2);
    expect(splitter('a').hidden).toBe(false); // b's left edge
    expect(splitter('b').hidden).toBe(true); // b ends its row: no splitter on its right
    expect(splitter('c').hidden).toBe(true);
  });

  it('resizes from the keyboard: arrows, Shift for bigger steps, Home and End', async () => {
    const { view, splitter } = await splitView([{ key: 'a' }, { key: 'b' }, { key: 'x', resizable: false }]);
    layout(view, { a: [0, 0, 400], b: [400, 0, 400], x: [800, 0, 200] });
    view.querySelector('.ar-flex')!.dispatchEvent(new CustomEvent('sortable:end'));
    await flush(2);
    expect(splitter('b').hidden).toBe(true); // x isn't resizable
    const ab = splitter('a');
    const resized = vi.fn();
    view.on('panel-resize', resized);
    const key = (k: string, shiftKey = false) => ab.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
    const grow = (k: string) => view.querySelector<HTMLElement>(`[data-key=${k}]`)!.style.flexGrow;
    key('ArrowRight'); // 400 → 416 of 800
    expect(grow('a')).toBe('1.04');
    expect(resized).toHaveBeenCalledWith({ key: 'a', neighbour: 'b' }, expect.anything());
    key('ArrowLeft', true); // 400 → 336
    expect(grow('a')).toBe('0.84');
    key('Home'); // a at its 100px minimum
    expect(grow('a')).toBe('0.25');
    key('End'); // b at its minimum
    expect(grow('a')).toBe('1.75');
    key('Tab');
    expect(grow('a')).toBe('1.75');
  });

  it('restores saved widths as flex-grow ratios', async () => {
    const { app } = setup(() => ({ body: {} }));
    app.store.upsert('ArLayout', 'saved', { order: ['b', 'a'], sizes: { a: { grow: 2.5 }, b: { height: 240 } } });
    const view = document.createElement('a-flex-view') as FlexView;
    document.body.appendChild(view);
    view.configure({ id: 'saved', children: [{ key: 'a', component: 'div' }, { key: 'b', component: 'div' }] });
    await flush(5);
    const a = view.querySelector<HTMLElement>('[data-key=a]')!;
    expect(a.style.flexGrow).toBe('2.5');
    expect(a.dataset.grow).toBe('2.5');
    expect(view.querySelector<HTMLElement>('[data-key=b]')!.style.height).toBe('240px');
    view.resetLayout();
    expect(view.querySelector<HTMLElement>('[data-key=a]')!.dataset.grow).toBeUndefined();
  });

  it('renders configured panels, binds children and remembers the layout', async () => {
    const { app } = setup(() => ({ body: {} }));
    class StatCard extends Component {
      static override bindConfig = { fields: { value: { displayType: 'number' as const, locale: 'en-US' } } };
    }
    defineComponent({ tag: 'kit-stat-card', html: '<template id="main"><strong data-bind="value"></strong></template>' })(StatCard);
    app.store.upsert('Stat', 'users', { value: 1234 });
    const view = document.createElement('a-flex-view') as FlexView;
    document.body.appendChild(view);
    view.configure({
      id: 'dash',
      children: [
        { key: 'a', title: 'Users', component: 'kit-stat-card', binding: { type: 'Stat', id: 'users' }, attributes: { 'data-x': 1 } },
        { key: 'b', title: 'Other', component: 'kit-stat-card', resizable: false },
        { key: 'c', component: 'kit-stat-card', list: { type: 'Stat', endpoint: 'none' }, scrollable: true },
      ],
    });
    await flush(8);
    const panels = () => Array.from(view.querySelectorAll<HTMLElement>('.ar-flex__panel')).map(p => p.dataset.key);
    expect(panels()).toEqual(['a', 'b', 'c']);
    expect(view.querySelector('.ar-flex__panel h2')!.textContent).toBe('Users');
    expect(view.querySelector('kit-stat-card strong')!.textContent).toBe('1,234');
    expect(view.querySelector('kit-stat-card')!.getAttribute('data-x')).toBe('1');
    expect(view.querySelector('[data-key=c] .ar-flex__body')!.getAttribute('role')).toBe('region');
    const layoutChange = vi.fn();
    view.on('layout-change', layoutChange);
    // Reorder with the keyboard: pick up "a", move right twice, drop.
    const a = view.querySelector<HTMLElement>('.ar-flex__panel[data-key=a]')!;
    const key = (k: string) => a.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key(' ');
    key('ArrowRight');
    key('ArrowRight');
    key(' ');
    await flush();
    expect(panels()).toEqual(['b', 'c', 'a']);
    expect(layoutChange).toHaveBeenCalled();
    expect(app.store.getData('ArLayout', 'dash')).toMatchObject({ order: ['b', 'c', 'a'] });
    // Resizing stores the size.
    // Height comes from the bottom edge; width from splitters (tested below).
    expect(a.querySelector('.resize-handle--s')).not.toBeNull();
    expect(view.querySelector('[data-key=b] .ar-flex__splitter')).toBeNull(); // not resizable
    a.style.height = '320px'; // as the resizable mixin leaves it
    a.dispatchEvent(new CustomEvent('resizable:end', { bubbles: true }));
    expect(app.store.getData<{ sizes: Record<string, unknown> }>('ArLayout', 'dash')!.sizes.a).toEqual({ height: 320 });
    // A new instance restores order and size.
    view.remove();
    const again = document.createElement('a-flex-view') as FlexView;
    document.body.appendChild(again);
    again.configure({ id: 'dash', children: [{ key: 'a', component: 'kit-stat-card' }, { key: 'b', component: 'kit-stat-card' }, { key: 'c', component: 'kit-stat-card' }] });
    await flush(5);
    expect(Array.from(again.querySelectorAll<HTMLElement>('.ar-flex__panel')).map(p => p.dataset.key)).toEqual(['b', 'c', 'a']);
    expect(again.querySelector<HTMLElement>('[data-key=a]')!.style.height).toBe('320px');
    again.resetLayout();
    expect(Array.from(again.querySelectorAll<HTMLElement>('.ar-flex__panel')).map(p => p.dataset.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('<a-list>', () => {
  it('renders a declarative list from child templates', async () => {
    const { app } = setup(url => ({ body: url.searchParams.get('team') === 'none' ? [] : people.slice(0, 2) }));
    app.defineEndpoint('people', { url: '/people', type: 'Person', list: true });
    document.body.innerHTML = `
      <a-list data-list="people" infinite aria-label="People">
        <template data-item><li><b data-bind="name"></b> <span data-bind="salary" data-display="currency"></span><a data-bind="name" data-attribute="title"></a></li></template>
        <template data-empty><li class="none">Nobody</li></template>
        <template data-loading><li class="wait">…</li></template>
      </a-list>
      <a-list data-list="people" data-filters='{"team":"none"}' data-tag="ol">
        <template data-item><div data-bind="name"></div></template>
        <template data-empty><p class="none">Nobody</p></template>
        <template data-error><p>Error</p></template>
      </a-list>`;
    await flush(10);
    const [first, second] = Array.from(document.querySelectorAll<List>('a-list'));
    expect(first.querySelector('ul.ar-list')!.getAttribute('aria-label')).toBe('People');
    expect(Array.from(first.querySelectorAll('li b')).map(b => b.textContent)).toEqual(['Person 1', 'Person 2']);
    expect(first.querySelector('li a')!.getAttribute('title')).toBe('Person 1');
    expect(first.querySelector('li span')!.textContent).toMatch(/1,000/);
    expect(second.querySelector('ol.ar-list .none')!.textContent).toBe('Nobody');
    app.store.upsert('Person', '1', { name: 'Renamed' });
    expect(first.querySelector('li b')!.textContent).toBe('Renamed');
  });
});

describe('<a-form>', () => {
  function formApp(handler: RouteHandler = () => ({ body: { id: 9, email: 'alice@example.com' } })) {
    const ctx = setup(handler);
    ctx.app.defineEndpoint('createAccount', { url: '/accounts', method: 'POST', type: 'Account' });
    return ctx;
  }

  const FORM = `
    <a-form data-endpoint="createAccount">
      <form>
        <div data-error-summary hidden></div>
        <label for="email">Email *</label><input id="email" name="email" type="email" required>
        <label for="username">Username</label><input id="username" name="username" required minlength="3" maxlength="12" pattern="[a-z]+" data-rules='[{"type":"equals","params":{"field":"confirm"}}]'>
        <input name="confirm">
        <input name="age" type="number" min="18" max="120">
        <input name="site" type="url"><input name="phone" type="tel">
        <input name="terms" type="checkbox" required>
        <textarea name="bio" minlength="5"></textarea>
        <input name="broken" data-rules="{bad">
        <button>Create</button>
      </form>
    </a-form>`;

  it('derives rules from attributes, shows a summary and submits', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, fetch } = formApp();
    document.body.innerHTML = FORM;
    await flush(5);
    const form = document.querySelector('a-form') as Form;
    const success = vi.fn();
    form.on('submit-success', success);
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(5);
    const summary = document.querySelector<HTMLElement>('[data-error-summary]')!;
    expect(summary.hidden).toBe(false);
    expect(summary.textContent).toContain('Email is required'.replace('Email is required', 'This field is required'));
    expect(document.activeElement).toBe(summary.querySelector('a'));
    expect(fetch.calls).toHaveLength(0);
    expect(err).toHaveBeenCalled(); // bad data-rules JSON

    const set = (name: string, value: string) => {
      const el = document.querySelector<HTMLInputElement>(`[name=${name}]`)!;
      if (el.type === 'checkbox') el.checked = value === 'true';
      else el.value = value;
    };
    set('email', 'alice@example.com');
    set('username', 'alice');
    set('confirm', 'alice');
    set('age', '30');
    set('terms', 'true');
    expect(await form.validate()).toBe(true);
    await form.submit();
    await flush(5);
    expect(JSON.parse(String(fetch.calls[0].init.body))).toMatchObject({ email: 'alice@example.com', username: 'alice', terms: true, age: 30 });
    expect(success).toHaveBeenCalled();
    expect(app.store.getData('Account', '9')).toEqual({ id: 9, email: 'alice@example.com' });
    expect(form.values().email).toBe('alice@example.com');
  });

  it('maps server-side validation errors onto fields', async () => {
    formApp(() => ({ status: 422, body: { errors: { email: ['Already registered'], missing: 'x' } } }));
    document.body.innerHTML = `<a-form data-endpoint="createAccount"><form><input name="email" value="alice@example.com"><button>Go</button></form></a-form>`;
    await flush(5);
    const form = document.querySelector('a-form') as Form;
    const failed = vi.fn();
    form.on('submit-error', failed);
    await form.submit();
    const email = document.querySelector('[name=email]')!;
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(email.getAttribute('aria-describedby')!)!.textContent).toBe('Already registered');
    expect(failed).toHaveBeenCalled();
  });

  it('emits submit-valid without an endpoint, edits existing objects and resets', async () => {
    const { app, fetch } = formApp(() => ({ status: 204 }));
    app.defineEndpoint('updateAccount', { url: '/accounts/:id', method: 'PATCH' });
    app.store.upsert('Account', '3', { email: 'old@example.com' });
    document.body.innerHTML = `
      <a-form id="plain"><form><input name="email" type="email"><button>Go</button></form></a-form>
      <a-form id="edit" data-source="Account:3" data-endpoint="updateAccount" data-reset><form><input name="email"><button>Save</button></form></a-form>
      <a-form id="nothing"></a-form>`;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await flush(5);
    expect(err).toHaveBeenCalledWith('<a-form> needs a <form> child');
    const plain = document.getElementById('plain') as Form;
    const valid = vi.fn();
    plain.on('submit-valid', valid);
    await plain.submit();
    expect(valid).toHaveBeenCalledWith({ data: { email: '' } }, expect.anything());
    const edit = document.getElementById('edit') as Form;
    expect(document.querySelector<HTMLInputElement>('#edit [name=email]')!.value).toBe('old@example.com');
    await edit.submit();
    expect(fetch.calls[0].url).toContain('/api/accounts/3');
    expect(fetch.calls[0].init.method).toBe('PATCH');
    document.getElementById('nothing')!.remove();
    edit.remove();
  });
});
