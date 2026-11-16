/**
 * `<a-data-table>`: a ListView-backed table with sorting, infinite scroll,
 * inline editing with validation and optimistic saves, resizable columns and
 * spreadsheet-style keyboard navigation.
 *
 * ```ts
 * const table = document.querySelector('a-data-table');
 * table.configure({
 *   list: { type: 'Person', endpoint: 'listPeople', pageSize: 50 },
 *   columns: [
 *     { field: 'name', label: 'Name', sortable: true, editable: { validation: { rules: [{ type: 'required' }] } } },
 *     { field: 'role', label: 'Role', displayType: 'badge' },
 *     { field: 'salary', label: 'Salary', displayType: 'currency', align: 'end' },
 *   ],
 *   save: { endpoint: 'updatePerson' },
 * });
 * table.on('row-select', ({ id }) => card.bind({ type: 'Person', id }));
 * ```
 *
 * @module kit/data-table
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import { getRuntime } from '../components/runtime';
import type { BindConfig, DisplayType, FieldBindConfig, FieldValidationConfig } from '../binding/types';
import type { ListView, ListViewConfig, SortConfig, StoredObject } from '../data/types';
import type { MixinInstance } from '../mixins/types';
import { mixinRegistry } from '../mixins/registry';
import { getArethesis } from '../core/arethesis';
import { cssEscape } from '../utils/dom';

export interface DataTableColumn {
  field: string;
  label: string;
  displayType?: DisplayType;
  /** Extra binding options (format, currency, locale, …). */
  bind?: Omit<FieldBindConfig, 'selector' | 'field'>;
  sortable?: boolean;
  /** Allow inline editing (Enter, F2, double-click, or typing). */
  editable?: boolean | { type?: 'text' | 'number' | 'date' | 'email' | 'url' | 'select'; choices?: string[]; validation?: FieldValidationConfig };
  /** Initial width, e.g. `'12rem'`. */
  width?: string;
  align?: 'start' | 'center' | 'end';
}

export interface DataTableConfig {
  columns: DataTableColumn[];
  /** A ListView, or a config to create one. */
  list: ListView | ListViewConfig;
  /**
   * Persist inline edits. With `endpoint`, sends `PATCH` (or `method`) to that
   * registered endpoint with `{ [field]: value }` and `:id` filled in. Edits are
   * applied optimistically and rolled back on failure.
   */
  save?: { endpoint: string; method?: 'PATCH' | 'PUT' | 'POST' } | ((id: string, changes: Record<string, unknown>) => Promise<unknown>);
  /** Accessible table caption. */
  caption?: string;
  /** Text when the list is empty. @default 'No results' */
  emptyText?: string;
  /** Infinite scroll threshold in px. @default 400 */
  threshold?: number;
}

const HTML = `
<template id="main">
  <div class="ar-table">
    <div class="ar-table__scroll" tabindex="-1">
      <table role="grid" aria-rowcount="-1">
        <caption class="ar-visually-hidden"></caption>
        <thead><tr></tr></thead>
        <tbody data-items></tbody>
      </table>
    </div>
    <div class="ar-table__status" role="status" aria-live="polite"></div>
  </div>
</template>
<template id="empty"><tr class="ar-table__empty"><td colspan="999"></td></tr></template>
<template id="loading"><tr class="ar-table__loading" aria-hidden="true"><td colspan="999"><div class="ar-skeleton"></div><div class="ar-skeleton"></div><div class="ar-skeleton"></div></td></tr></template>
<template id="error"><tr class="ar-table__error"><td colspan="999"><span data-error-message></span> <button type="button" class="ar-button" data-retry>Retry</button></td></tr></template>
`;

export class DataTable extends Component {
  #config: DataTableConfig | null = null;
  #view: ListView | null = null;
  #instances: MixinInstance[] = [];
  #selected: string | null = null;

  /** Configure columns and the data source. */
  configure(config: DataTableConfig): void {
    this.#config = config;
    const { listViews } = getRuntime();
    this.#view = 'ids' in config.list ? config.list : listViews.getOrCreate(config.list);
    void this.ready.then(() => this.#setup());
  }

  get view(): ListView | null {
    return this.#view;
  }

  /** Currently selected row id. */
  get selected(): string | null {
    return this.#selected;
  }

  /** Change filters (reloads from the first page). */
  setFilters(filters: Record<string, unknown>): Promise<void> {
    if (!this.#view) return Promise.resolve();
    return getRuntime().listViews.update(this.#view.id, { filters });
  }

  /** Change the sort (reloads from the first page). */
  setSort(sort: SortConfig[]): Promise<void> {
    if (!this.#view) return Promise.resolve();
    const done = getRuntime().listViews.update(this.#view.id, { sort });
    this.#renderHeader();
    return done;
  }

  #setup(): void {
    const config = this.#config!;
    for (const m of this.#instances.splice(0)) m.destroy();
    const table = this.querySelector('table')!;
    const caption = this.querySelector('caption')!;
    caption.textContent = config.caption ?? '';
    table.setAttribute('aria-label', config.caption ?? 'Data table');
    this.#renderHeader();

    const fields: Record<string, FieldBindConfig> = {};
    for (const col of config.columns) {
      fields[col.field] = { ...col.bind, displayType: col.displayType ?? col.bind?.displayType, selector: `[data-col="${cssEscape(col.field)}"]` };
    }
    const bindConfig: BindConfig = {
      fields,
      itemTemplate: 'item',
      emptyTemplate: 'empty',
      loadingTemplate: 'loading',
      errorTemplate: 'error',
      infiniteScroll: { threshold: config.threshold ?? 400, root: 'self' },
    };
    this.bind(this.#view!, bindConfig);

    const grid = mixinRegistry.apply(table, 'grid-navigation', { cellSelector: 'td[data-col], th[data-col]', rowSelector: 'tr' });
    if (grid) this.#instances.push(grid);
    this.listen(table, 'grid:edit', (e: Event) => {
      const { cell, key } = (e as CustomEvent<{ cell: HTMLElement; key?: string }>).detail;
      this.#edit(cell, key);
    });
    this.listen(table, 'click', (e: Event) => {
      const row = (e.target as Element).closest('tbody tr[data-id]');
      if (row) this.#select(row.getAttribute('data-id')!);
    });
    this.listen(table, 'keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === ' ' && (ke.target as Element).closest('tbody td')) {
        const row = (ke.target as Element).closest('tr[data-id]');
        if (row) {
          ke.preventDefault();
          this.#select(row.getAttribute('data-id')!);
        }
      }
    });
  }

  #renderHeader(): void {
    const config = this.#config;
    const row = this.querySelector('thead tr');
    if (!config || !row) return;
    const sort = this.#view?.sort[0];
    row.replaceChildren(...config.columns.map((col, index) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.dataset.col = col.field;
      th.setAttribute('aria-colindex', String(index + 1));
      if (col.width) th.style.width = col.width;
      if (col.align) th.dataset.align = col.align;
      if (col.sortable) {
        const active = sort?.field === col.field;
        th.setAttribute('aria-sort', active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ar-table__sort';
        button.textContent = col.label;
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.className = 'ar-table__sort-icon';
        icon.textContent = active ? (sort!.direction === 'asc' ? '▲' : '▼') : '↕';
        button.appendChild(icon);
        button.addEventListener('click', () => {
          const direction: SortConfig['direction'] = active && sort!.direction === 'asc' ? 'desc' : 'asc';
          void this.setSort([{ field: col.field, direction }]);
        });
        th.appendChild(button);
      } else {
        th.textContent = col.label;
      }
      const resize = mixinRegistry.apply(th, 'resizable', { handles: ['e'], minWidth: 60 });
      if (resize) this.#instances.push(resize);
      return th;
    }));
  }

  protected override async loadTemplate(templateId: string): Promise<DocumentFragment | null> {
    if (templateId === 'item' && this.#config) {
      const tr = document.createElement('tr');
      for (const [i, col] of this.#config.columns.entries()) {
        const td = document.createElement('td');
        td.dataset.col = col.field;
        td.setAttribute('aria-colindex', String(i + 1));
        if (col.align) td.dataset.align = col.align;
        if (col.editable) td.setAttribute('aria-readonly', 'false');
        tr.appendChild(td);
      }
      const fragment = document.createDocumentFragment();
      fragment.appendChild(tr);
      return fragment;
    }
    const fragment = await super.loadTemplate(templateId);
    if (fragment && templateId === 'empty') {
      const td = fragment.querySelector('td');
      if (td) td.textContent = this.#config?.emptyText ?? 'No results';
    }
    return fragment;
  }

  protected override onItemRender(element: Element, obj: StoredObject): void {
    element.setAttribute('aria-selected', String(obj.id === this.#selected));
  }

  protected override onListChange(view: ListView): void {
    const status = this.querySelector('.ar-table__status');
    const table = this.querySelector('table');
    if (table) table.setAttribute('aria-rowcount', String(view.totalCount ?? -1));
    (mixinRegistry.get(table as HTMLElement, 'grid-navigation')?.refresh as (() => void) | undefined)?.();
    if (!status) return;
    const shown = view.ids.length;
    status.textContent = view.status === 'loading' ? 'Loading…'
      : view.status === 'loading-more' ? `Showing ${shown}${view.totalCount !== undefined ? ` of ${view.totalCount}` : ''}, loading more…`
        : view.status === 'error' ? 'Could not load data.'
          : `Showing ${shown}${view.totalCount !== undefined ? ` of ${view.totalCount}` : ''}`;
  }

  #select(id: string): void {
    this.#selected = id;
    this.querySelectorAll('tbody tr[data-id]').forEach(tr => tr.setAttribute('aria-selected', String(tr.getAttribute('data-id') === id)));
    this.emit('row-select', { id });
  }

  #edit(cell: HTMLElement, key?: string): void {
    const config = this.#config;
    const field = cell.dataset.col;
    const id = cell.closest('tr')?.getAttribute('data-id');
    const col = config?.columns.find(c => c.field === field);
    if (!config || !field || !id || !col?.editable || cell.classList.contains('is-editing')) return;
    const opts = typeof col.editable === 'object' ? col.editable : {};
    const { store } = getRuntime();
    const type = this.#view!.type;
    const raw = store.getData<Record<string, unknown>>(type, id)?.[field];
    // Edit the raw value, not the formatted one (e.g. 1234 rather than "$1,234.00").
    cell.textContent = raw === null || raw === undefined ? '' : String(raw);
    const editor = mixinRegistry.apply(cell, 'editable', {
      type: opts.type ?? (col.displayType === 'number' || col.displayType === 'currency' ? 'number' : col.displayType === 'date' ? 'date' : 'text'),
      choices: opts.choices,
      label: `Edit ${col.label}`,
      validate: opts.validation
        ? async (value: string) => {
          const error = await getRuntime().binder.validationEngine.validateField(field, value, opts.validation!, { ...store.getData(type, id) });
          return error ? error.message : true;
        }
        : undefined,
    });
    if (!editor) return;
    const finish = (): void => {
      mixinRegistry.remove(cell, 'editable');
      const current = store.getData<Record<string, unknown>>(type, id);
      // Re-render the formatted value.
      getRuntime().binder.applyValue(cell, current?.[field], { ...col.bind, displayType: col.displayType ?? col.bind?.displayType }, current);
      cell.focus();
    };
    cell.addEventListener('editable:save', (e: Event) => {
      e.preventDefault(); // we render the formatted value ourselves
      const detail = (e as CustomEvent<{ value: string }>).detail;
      const value = opts.type === 'number' || col.displayType === 'number' || col.displayType === 'currency' ? Number(detail.value) : detail.value;
      void this.#save(type, id, { [field]: value }).finally(finish);
    }, { once: true });
    cell.addEventListener('editable:cancel', finish, { once: true });
    (editor.start as () => void)();
    const input = cell.querySelector('input');
    if (input && key && key.length === 1) input.value = key; // type-to-edit replaces the value
  }

  async #save(type: string, id: string, changes: Record<string, unknown>): Promise<void> {
    const save = this.#config?.save;
    const app = getArethesis();
    const apiCall = async (): Promise<Record<string, unknown> | void> => {
      if (!save) return;
      if (typeof save === 'function') return (await save(id, changes)) as Record<string, unknown> | void;
      const endpoint = app.http.getEndpoint(save.endpoint);
      if (!endpoint) throw new Error(`Unknown endpoint "${save.endpoint}"`);
      return app.http.request<Record<string, unknown> | void>({ url: endpoint.url, method: save.method ?? endpoint.method ?? 'PATCH', params: { id }, body: changes });
    };
    try {
      await app.optimistic.update(type, id, changes, apiCall);
      this.emit('save', { id, changes });
    } catch (error) {
      this.emit('save-error', { id, changes, error });
      const row = this.itemElement(id);
      row?.classList.add('is-error');
      setTimeout(() => row?.classList.remove('is-error'), 1500);
    }
  }

  protected override onDisconnected(): void {
    for (const m of this.#instances.splice(0)) m.destroy();
  }
}

defineComponent({ tag: 'a-data-table', html: HTML })(DataTable);
