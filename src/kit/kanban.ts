/**
 * `<a-kanban>`: a board of cards in columns. Cards are objects of one type,
 * grouped into columns by a field and ordered by another. Drag a card with a
 * mouse, a finger or the keyboard (Space to pick up, arrows, Space to drop),
 * or use its menu (right-click, Shift+F10). Moves are optimistic: the card
 * moves at once, the change is saved in the background, and it goes back if
 * the server refuses.
 *
 * ```ts
 * const board = document.querySelector('a-kanban');
 * board.configure({
 *   type: 'Task',
 *   list: { type: 'Task', endpoint: 'listTasks' },
 *   groupBy: 'status',
 *   columns: [{ value: 'todo', label: 'To do' }, { value: 'done', label: 'Done', limit: 10 }],
 *   card: { html: '<p data-bind="title"></p>', fields: { title: {} } },
 *   save: { endpoint: 'updateTask' },
 * });
 * ```
 *
 * The board is drawn from the store, so a change from anywhere (another tab
 * over SSE, an edit elsewhere on the page) moves the card here too.
 *
 * Events: `kanban:move` (cancelable, before a move: `{ id, from, to, index }`),
 * `kanban:moved` and `kanban:move-error` (`{ id, from, to, error }`),
 * `kanban:create`, `kanban:delete` and `kanban:error` (`{ action, error }`).
 *
 * @module components/kanban
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import { getRuntime } from '../components/runtime';
import type { BindConfig } from '../binding/types';
import type { ListView, ListViewConfig, StoredObject } from '../data/types';
import type { ContextMenuItem } from '../mixins/types';
import type { HttpMethod } from '../http/types';
import { mixinRegistry } from '../mixins/registry';
import { sortableMixin } from '../mixins/sortable';
import { contextMenuMixin } from '../mixins/context-menu';
import { announce } from '../mixins/utils';
import { cssEscape } from '../utils/dom';

export interface KanbanColumn {
  /** The `groupBy` field's value for cards in this column. */
  value: string;
  label: string;
  /** A work-in-progress limit: the count shows "3 / 5", and the column gets `data-over-limit` past it. */
  limit?: number;
}

type Request<A extends unknown[], R> = { endpoint: string; method?: HttpMethod } | ((...args: A) => Promise<R>);

export interface KanbanConfig<T extends Record<string, unknown> = Record<string, unknown>> {
  /** The type of the cards. */
  type: string;
  /** Loaded to fill the store. Leave it out if the cards are already there. */
  list?: ListView | ListViewConfig;
  /** The field that says which column a card is in. */
  groupBy: string;
  columns: KanbanColumn[];
  /** The field cards are sorted by within a column. @default 'order' */
  orderField?: string;
  /** Only show cards that pass. */
  filter?: (data: T) => boolean;
  card?: {
    /** The card's inner HTML (bound with `fields`). @default a title */
    html?: string;
    fields?: BindConfig['fields'];
    /** The card's accessible name. @default its `title` field */
    label?: (data: T) => string;
    /** Called whenever a card renders, to add details (tooltips, colors). */
    render?: (element: HTMLElement, obj: StoredObject<T>) => void;
  };
  /** Persist moves: an endpoint gets `PATCH /…/:id` with the changed fields. */
  save?: Request<[id: string, changes: Partial<T>], T | void>;
  /** Enables adding cards; the new card's fields come from `defaults` and the title typed. */
  create?: Request<[data: Partial<T>], T>;
  /** Field the typed text goes into when adding a card. @default 'title' */
  titleField?: string;
  defaults?: Partial<T>;
  /** Enables deleting cards, from the menu or the Delete key. */
  remove?: Request<[id: string], unknown>;
  /** Extra items for each card's menu, reported in `kanban:action` (`{ id, action }`). */
  menu?: ContextMenuItem[] | false;
}

const DEFAULT_CARD = '<p class="ar-kanban__title" data-bind="title"></p>';

export class Kanban extends Component {
  #config: KanbanConfig | null = null;
  #cards = new Map<string, HTMLElement>();
  #scheduled = false;
  #unsubscribe: Array<() => void> = [];
  #started = false;

  /** Set up the board. */
  configure<T extends Record<string, unknown>>(config: KanbanConfig<T>): void {
    this.#config = config as unknown as KanbanConfig;
    this.#teardown();
    this.#started = false;
    for (const el of this.#cards.values()) getRuntime().binder.unbind(el);
    this.#cards.clear();
    if (this.isConnected) this.#start();
    if (config.list) {
      const { listViews } = getRuntime();
      const view = 'ids' in config.list ? config.list : listViews.getOrCreate(config.list);
      if (view.status === 'idle' || view.status === 'stale') {
        listViews.load(view).catch(error => this.emit('kanban:error', { action: 'load', error }));
      }
    }
  }

  protected override onConnected(): void {
    if (this.#config && !this.#started) this.#start();
  }

  #start(): void {
    this.#started = true;
    const config = this.#config!;
    const { store, optimistic } = getRuntime();
    this.#build();
    this.#unsubscribe.push(store.subscribeToType(config.type, () => this.#schedule()));
    // A new card keeps its element when the server gives it its real id.
    this.#unsubscribe.push(optimistic.on('commit', e => {
      if (e.kind !== 'create' || e.type !== config.type || !e.resultId || e.resultId === e.objectId) return;
      const el = this.#cards.get(e.objectId);
      if (!el) return;
      this.#cards.delete(e.objectId);
      if (this.#cards.has(e.resultId)) {
        getRuntime().binder.unbind(el);
        el.remove();
      } else {
        this.#cards.set(e.resultId, el);
        el.dataset.id = e.resultId;
      }
    }));
    this.#render();
  }

  get config(): KanbanConfig | null {
    return this.#config;
  }

  /** The card element for an id. */
  cardElement(id: string): HTMLElement | undefined {
    return this.#cards.get(id);
  }

  protected override onDisconnected(): void {
    this.#teardown();
    this.#started = false;
  }

  #teardown(): void {
    for (const off of this.#unsubscribe.splice(0)) off();
  }

  #build(): void {
    const config = this.#config!;
    const board = document.createElement('div');
    board.className = 'ar-kanban';
    for (const column of config.columns) {
      const id = `${this.id || 'ar-kanban'}-col-${column.value}`;
      const section = document.createElement('section');
      section.className = 'ar-kanban__column';
      section.dataset.column = column.value;
      section.setAttribute('aria-labelledby', id);
      section.innerHTML = `<header class="ar-kanban__header"><h2 class="ar-kanban__heading"></h2><span class="ar-kanban__count"></span></header><ul class="ar-kanban__cards"></ul>`;
      const heading = section.querySelector('h2')!;
      heading.id = id;
      heading.textContent = column.label;
      section.querySelector('.ar-kanban__count')!.setAttribute('data-count', column.value);
      const list = section.querySelector('ul')!;
      list.dataset.column = column.value;
      list.setAttribute('aria-label', column.label);
      if (config.create) {
        const input = document.createElement('input');
        input.className = 'ar-kanban__new input';
        input.dataset.new = column.value;
        input.placeholder = 'Title';
        input.setAttribute('aria-label', `New card in ${column.label}`);
        input.hidden = true;
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'ar-kanban__add';
        add.dataset.add = column.value;
        add.textContent = '+ Add a card';
        section.append(input, add);
      }
      board.append(section);
    }
    this.replaceChildren(board);

    mixinRegistry.ensure('sortable', sortableMixin).ensure('context-menu', contextMenuMixin);
    const menu = this.#menuItems();
    for (const list of this.querySelectorAll<HTMLElement>('.ar-kanban__cards')) {
      this.useMixin('sortable', { group: `kanban-${this.id || 'board'}` }, list);
      if (menu.length) this.useMixin('context-menu', { target: 'li[data-id]', items: menu }, list);
    }
    this.listen(this, 'sortable:end', e => {
      const { id, to, newIndex } = (e as CustomEvent<{ id: string | null; to: HTMLElement; newIndex: number }>).detail;
      // The card is already where it was dropped; the store follows (or it goes back).
      if (id && to.dataset.column) void this.move(id, to.dataset.column, newIndex);
    });
    this.listen(this, 'context-menu:select', e => {
      const { action, target } = (e as CustomEvent<{ action: string; target: HTMLElement }>).detail;
      const id = target.dataset.id!;
      if (action === 'kanban:delete') void this.deleteCard(id);
      else if (action.startsWith('kanban:move:')) void this.move(id, action.slice('kanban:move:'.length), Infinity);
      else this.emit('kanban:action', { id, action });
    });
    this.delegate('keydown', 'li[data-id]', (e, el) => {
      if ((e as KeyboardEvent).key === 'Delete' && config.remove) void this.deleteCard((el as HTMLElement).dataset.id!);
    });
    this.delegate('click', '[data-add]', (_e, el) => {
      const input = this.querySelector<HTMLInputElement>(`input[data-new="${cssEscape((el as HTMLElement).dataset.add!)}"]`)!;
      input.hidden = false;
      input.value = '';
      input.focus();
    });
    this.delegate('keydown', 'input[data-new]', (e, el) => {
      const input = el as HTMLInputElement;
      const key = (e as KeyboardEvent).key;
      if (key === 'Enter') this.#createFrom(input);
      if (key === 'Escape') {
        input.value = '';
        input.hidden = true;
        this.querySelector<HTMLElement>(`[data-add="${cssEscape(input.dataset.new!)}"]`)?.focus();
      }
    });
    this.delegate('focusout', 'input[data-new]', (_e, el) => {
      if (!(el as HTMLInputElement).hidden) this.#createFrom(el as HTMLInputElement);
    });
  }

  #menuItems(): ContextMenuItem[] {
    const config = this.#config!;
    if (config.menu === false) return [];
    const items: ContextMenuItem[] = config.columns.map(c => ({ label: `Move to ${c.label}`, action: `kanban:move:${c.value}` }));
    if (config.menu?.length) items.push({ separator: true }, ...config.menu);
    if (config.remove) items.push({ separator: true }, { label: 'Delete', action: 'kanban:delete', danger: true, shortcut: 'Del' });
    return items;
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      // Don't move cards under the user's pointer mid-drag.
      if (this.querySelector('.is-sorting, [aria-grabbed="true"]')) {
        setTimeout(() => this.#schedule(), 200);
        return;
      }
      this.#render();
    });
  }

  #columnOf(data: Record<string, unknown>): string {
    return String(data[this.#config!.groupBy] ?? '');
  }

  #orderOf(data: Record<string, unknown>): number {
    return Number(data[this.#config!.orderField ?? 'order'] ?? 0);
  }

  #objects(): Array<StoredObject<Record<string, unknown>>> {
    const config = this.#config!;
    return getRuntime().store.getByType<Record<string, unknown>>(config.type).filter(o => !config.filter || config.filter(o.data));
  }

  #render(): void {
    const config = this.#config;
    if (!config) return;
    const objects = this.#objects();
    const seen = new Set<string>();
    // Moving an element in the DOM loses its focus; put it back afterwards.
    const focused = this.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    for (const column of config.columns) {
      const list = this.querySelector<HTMLElement>(`ul[data-column="${cssEscape(column.value)}"]`);
      if (!list) continue;
      const cards = objects.filter(o => this.#columnOf(o.data) === column.value).sort((a, b) => this.#orderOf(a.data) - this.#orderOf(b.data));
      const count = this.querySelector(`[data-count="${cssEscape(column.value)}"]`)!;
      count.textContent = column.limit ? `${cards.length} / ${column.limit}` : String(cards.length);
      list.closest('section')!.toggleAttribute('data-over-limit', !!column.limit && cards.length > column.limit);
      cards.forEach((obj, index) => {
        seen.add(obj.id);
        const el = this.#card(obj);
        if (list.children[index] !== el) list.insertBefore(el, list.children[index] ?? null);
      });
    }
    for (const [id, el] of this.#cards) {
      if (!seen.has(id)) {
        getRuntime().binder.unbind(el);
        el.remove();
        this.#cards.delete(id);
      }
    }
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  #card(obj: StoredObject<Record<string, unknown>>): HTMLElement {
    const config = this.#config!;
    const { binder, optimistic } = getRuntime();
    let el = this.#cards.get(obj.id);
    if (!el) {
      el = document.createElement('li');
      el.className = 'ar-kanban__card';
      el.dataset.id = obj.id;
      el.innerHTML = config.card?.html ?? DEFAULT_CARD;
      this.#cards.set(obj.id, el);
      binder.bind(el, obj.data, { fields: config.card?.fields ?? { title: {} } });
    } else {
      binder.update(el, obj.data);
    }
    const label = config.card?.label?.(obj.data) ?? String(obj.data.title ?? obj.id);
    el.setAttribute('aria-label', label);
    el.toggleAttribute('data-pending', optimistic.isPending(config.type, obj.id));
    config.card?.render?.(el, obj);
    return el;
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  /** The order value that places a card at `index` in a column (between its new neighbours). */
  orderAt(column: string, index: number, movingId = ''): number {
    const orders = this.#objects().filter(o => this.#columnOf(o.data) === column && o.id !== movingId).map(o => this.#orderOf(o.data)).sort((a, b) => a - b);
    const i = Math.min(Math.max(0, index), orders.length);
    const before = orders[i - 1];
    const after = orders[i];
    if (before === undefined && after === undefined) return 1000;
    if (before === undefined) return after - 1000;
    if (after === undefined) return before + 1000;
    return (before + after) / 2;
  }

  /** Move a card to a column, at an index (`Infinity` for the end). Resolves to whether it was saved. */
  async move(id: string, column: string, index: number): Promise<boolean> {
    const config = this.#config;
    if (!config) return false;
    const { store, optimistic } = getRuntime();
    const data = store.getData<Record<string, unknown>>(config.type, id);
    if (!data) return false;
    const from = this.#columnOf(data);
    const target = config.columns.find(c => c.value === column);
    if (!target) return false;
    if (optimistic.isPending(config.type, id)) {
      announce('Still saving that card. Try again in a moment.');
      this.#render();
      return false;
    }
    if (!this.emit('kanban:move', { id, from, to: column, index })) {
      this.#render();
      return false;
    }
    const changes = { [config.groupBy]: column, [config.orderField ?? 'order']: this.orderAt(column, index, id) };
    try {
      await optimistic.update(config.type, id, changes, () => this.#call(config.save, [id, changes]) as Promise<Record<string, unknown> | void>);
      if (from !== column) announce(`Moved to ${target.label}`);
      this.emit('kanban:moved', { id, from, to: column });
      return true;
    } catch (error) {
      announce(`Couldn't move the card. It's back in ${config.columns.find(c => c.value === from)?.label ?? 'its column'}.`);
      this.emit('kanban:move-error', { id, from, to: column, error });
      return false;
    } finally {
      this.#schedule();
    }
  }

  /** Delete a card (needs `remove`). */
  async deleteCard(id: string): Promise<boolean> {
    const config = this.#config;
    if (!config?.remove) return false;
    const { optimistic } = getRuntime();
    if (optimistic.isPending(config.type, id)) return false;
    // Keep focus on the board: move it to a neighbouring card first.
    const el = this.#cards.get(id);
    if (el?.contains(document.activeElement)) ((el.nextElementSibling ?? el.previousElementSibling) as HTMLElement | null)?.focus();
    try {
      await optimistic.delete(config.type, id, () => this.#call(config.remove, [id]));
      announce('Card deleted');
      this.emit('kanban:delete', { id });
      return true;
    } catch (error) {
      this.emit('kanban:error', { action: 'delete', id, error });
      return false;
    }
  }

  /** Add a card to a column (needs `create`). */
  async createCard(column: string, fields: Record<string, unknown>): Promise<string | null> {
    const config = this.#config;
    if (!config?.create) return null;
    const { store, optimistic } = getRuntime();
    const data = { ...config.defaults, ...fields, [config.groupBy]: column, [config.orderField ?? 'order']: this.orderAt(column, Infinity) };
    try {
      const result = await optimistic.create(config.type, data, () => this.#call(config.create, [data]) as Promise<Record<string, unknown>>);
      const id = store.getId(config.type, result) ?? null;
      this.emit('kanban:create', { id, data: result });
      return id;
    } catch (error) {
      this.emit('kanban:error', { action: 'create', error });
      return null;
    }
  }

  #createFrom(input: HTMLInputElement): void {
    const title = input.value.trim();
    input.value = '';
    input.hidden = true;
    if (title) void this.createCard(input.dataset.new!, { [this.#config!.titleField ?? 'title']: title });
  }

  async #call<A extends unknown[]>(request: Request<A, unknown> | undefined, args: A): Promise<unknown> {
    if (!request) return undefined;
    if (typeof request === 'function') return request(...args);
    const { http } = getRuntime();
    const endpoint = http.getEndpoint(request.endpoint);
    if (!endpoint) throw new Error(`Unknown endpoint "${request.endpoint}"`);
    const [first, second] = args as unknown[];
    const isId = typeof first === 'string';
    return http.request({
      url: endpoint.url,
      method: request.method ?? endpoint.method ?? (isId ? (second === undefined ? 'DELETE' : 'PATCH') : 'POST'),
      params: isId ? { id: first } : undefined,
      body: isId ? second : first,
    });
  }
}

/** Define `<a-kanban>` (idempotent). `import 'arethesis/components/kanban'` calls this. */
export function defineKanban(): void {
  defineComponent({ tag: 'a-kanban' })(Kanban);
}
