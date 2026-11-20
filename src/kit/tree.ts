/**
 * `<a-tree>`: a tree whose branches load as they're opened (the WAI-ARIA
 * tree pattern). The top level is a ListView, and so is each node's children,
 * so they page, cache and update like any list.
 *
 * ```ts
 * tree.configure({
 *   root: { type: 'Folder', endpoint: 'listFolders', filters: { parent: null } },
 *   children: folder => ({ type: 'Folder', endpoint: 'listFolders', filters: { parent: folder.id } }),
 *   hasChildren: folder => folder.childCount > 0,
 *   label: 'name',
 *   selection: 'multi',
 * });
 * ```
 *
 * With `selection` and a `name`, it's a form control that submits the
 * selected ids.
 *
 * Keys: Up/Down move, Right opens a node (or moves to its first child), Left
 * closes it (or moves to its parent), Home/End, `*` opens all siblings,
 * typing jumps to a match, Enter activates (and selects), Space toggles
 * selection in a multi-select tree.
 *
 * Events: `tree:select` (`{ ids }`), `tree:toggle` (`{ key, id, expanded }`),
 * `tree:activate` (`{ key, id, data }`).
 *
 * @module components/tree
 */

import { FormAssociatedComponent } from '../components/form-associated';
import { defineComponent } from '../components/decorators';
import { getRuntime } from '../components/runtime';
import type { ListView, ListViewConfig } from '../data/types';
import { uniqueId } from '../utils/dom';
import { getPath } from '../utils/path';

export interface TreeConfig<T = Record<string, unknown>> {
  /** The top-level nodes. */
  root: ListView | ListViewConfig;
  /** The list of a node's children, or null for a leaf. */
  children: (node: T) => ListViewConfig | null;
  /** Whether a node can be opened, before its children are loaded. @default children(node) !== null */
  hasChildren?: (node: T) => boolean;
  /** A field name, or a function, for each node's text. @default 'name' */
  label?: string | ((node: T) => string);
  /** Add details to a node's element (icons, badges). */
  render?: (element: HTMLElement, node: T) => void;
  /** @default 'none' */
  selection?: 'none' | 'single' | 'multi';
  /** Keys of nodes to open at first (`id`s joined by `/` from the top, like `"3/14"`). */
  expanded?: string[];
}

interface Row {
  key: string;
  id: string;
  type: string;
  depth: number;
  parentKey: string | null;
  posinset: number;
  setsize: number;
  /** A "show more" row for a list with more pages. */
  more?: ListView;
}

export class Tree extends FormAssociatedComponent<string[]> {
  #config: TreeConfig | null = null;
  #list: HTMLUListElement | null = null;
  #root: ListView | null = null;
  #views = new Map<string, ListView>();
  #expanded = new Set<string>();
  #rows: Row[] = [];
  #elements = new Map<string, HTMLLIElement>();
  #focusKey: string | null = null;
  #offs: Array<() => void> = [];
  #scheduled = false;
  #typed = '';
  #typedAt = 0;

  /** Set up the tree. */
  configure<T>(config: TreeConfig<T>): void {
    this.#config = config as unknown as TreeConfig;
    for (const off of this.#offs.splice(0)) off();
    this.#views.clear();
    this.#expanded = new Set(config.expanded ?? []);
    const { listViews, store } = getRuntime();
    this.#root = 'ids' in config.root ? config.root : listViews.getOrCreate(config.root);
    this.#watch(this.#root);
    this.#offs.push(store.subscribeToType(this.#root.type, () => this.#schedule()));
    for (const key of this.#expanded) this.#childView(key);
    this.#schedule();
  }

  /** Keys of the open nodes. */
  get expandedKeys(): string[] {
    return [...this.#expanded];
  }

  // ── Form control ─────────────────────────────────────────────────────────

  protected get focusTarget(): HTMLElement {
    return this.#list!;
  }

  protected serialize(value: string[]): string | FormData | null {
    if (!value.length || !this.name) return null;
    if (value.length === 1) return value[0];
    const data = new FormData();
    for (const id of value) data.append(this.name, id);
    return data;
  }

  protected parse(state: string): string[] {
    return state ? [state] : [];
  }

  protected emptyValue(): string[] {
    return [];
  }

  /** Focus the current item (the one in the tab order). */
  override focus(options?: FocusOptions): void {
    (this.#elements.get(this.#focusKey ?? '') ?? this.#list)?.focus(options);
  }

  protected override isEmpty(value: string[]): boolean {
    return value.length === 0;
  }

  protected override onValueChange(): void {
    this.#paintSelection();
  }

  protected override onConnected(): void {
    if (this.#list) return;
    const list = document.createElement('ul');
    list.className = 'ar-tree';
    list.setAttribute('role', 'tree');
    list.id = `${this.id || uniqueId('ar-tree')}-tree`;
    const label = this.getAttribute('aria-label');
    if (label) list.setAttribute('aria-label', label);
    list.addEventListener('keydown', e => this.#onKey(e));
    list.addEventListener('click', e => this.#onClick(e));
    list.addEventListener('dblclick', e => {
      const row = this.#rowFor(e.target as Element);
      if (row && !row.more) this.#activate(row);
    });
    list.addEventListener('focusin', e => {
      const row = this.#rowFor(e.target as Element);
      if (row) this.#focusKey = row.key;
    });
    list.addEventListener('focusout', () => this.markTouched());
    this.replaceChildren(list);
    this.#list = list;
    if (this.#config) this.#render();
  }

  protected override onDisconnected(): void {
    for (const off of this.#offs.splice(0)) off();
  }

  override connectedCallback(): Promise<void> {
    // Subscriptions dropped on disconnect come back when it's moved.
    if (this.#config && !this.#offs.length && this.#root) {
      this.#watch(this.#root);
      for (const view of this.#views.values()) this.#watch(view);
      this.#offs.push(getRuntime().store.subscribeToType(this.#root.type, () => this.#schedule()));
    }
    return super.connectedCallback();
  }

  // ── Data ─────────────────────────────────────────────────────────────────

  #watch(view: ListView): void {
    const { listViews } = getRuntime();
    this.#offs.push(listViews.subscribe(view.id, () => this.#schedule()));
    if (view.status === 'idle' || view.status === 'stale') {
      listViews.load(view).catch(error => this.emit('tree:error', { error }));
    }
  }

  #data(row: { type: string; id: string }): Record<string, unknown> | undefined {
    return getRuntime().store.getData<Record<string, unknown>>(row.type, row.id);
  }

  #label(data: Record<string, unknown> | undefined, id: string): string {
    const label = this.#config?.label ?? 'name';
    if (!data) return id;
    return typeof label === 'function' ? label(data) : String(getPath(data, label) ?? id);
  }

  #hasChildren(data: Record<string, unknown> | undefined): boolean {
    if (!data || !this.#config) return false;
    return this.#config.hasChildren ? this.#config.hasChildren(data) : this.#config.children(data) !== null;
  }

  /** The children of the node at `key`, created (and loaded) on first use. */
  #childView(key: string, data?: Record<string, unknown>): ListView | null {
    const existing = this.#views.get(key);
    if (existing) return existing;
    const node = data ?? this.#findData(key);
    const config = node ? this.#config!.children(node) : null;
    if (!config) return null;
    const view = getRuntime().listViews.getOrCreate(config);
    this.#views.set(key, view);
    this.#watch(view);
    return view;
  }

  #findData(key: string): Record<string, unknown> | undefined {
    const row = this.#rows.find(r => r.key === key);
    if (row) return this.#data(row);
    // Not rendered yet (an initially expanded key): the last id, of the root's type.
    const id = key.split('/').pop()!;
    return this.#root ? getRuntime().store.getData<Record<string, unknown>>(this.#root.type, id) : undefined;
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#render();
    });
  }

  #flatten(): Row[] {
    const rows: Row[] = [];
    const walk = (view: ListView, depth: number, parentKey: string | null): void => {
      const setsize = view.totalCount ?? view.ids.length;
      view.ids.forEach((id, i) => {
        const key = parentKey ? `${parentKey}/${id}` : id;
        rows.push({ key, id, type: view.type, depth, parentKey, posinset: i + 1, setsize });
        if (this.#expanded.has(key)) {
          const data = getRuntime().store.getData<Record<string, unknown>>(view.type, id);
          const children = this.#childView(key, data);
          if (children) walk(children, depth + 1, key);
        }
      });
      if (view.hasMore && view.ids.length) rows.push({ key: `${parentKey ?? ''}/…more`, id: '', type: view.type, depth, parentKey, posinset: 0, setsize, more: view });
    };
    if (this.#root) walk(this.#root, 1, null);
    return rows;
  }

  #render(): void {
    const list = this.#list;
    if (!list || !this.#config) return;
    const focused = list.contains(document.activeElement) ? this.#focusKey : null;
    this.#rows = this.#flatten();
    const seen = new Set<string>();
    let previous: Element | null = null;
    for (const row of this.#rows) {
      seen.add(row.key);
      const li = this.#element(row);
      const expected: ChildNode | null = previous ? previous.nextSibling : list.firstChild;
      if (li !== expected) {
        if (previous) previous.after(li);
        else list.prepend(li);
      }
      previous = li;
    }
    for (const [key, li] of this.#elements) {
      if (!seen.has(key)) {
        li.remove();
        this.#elements.delete(key);
      }
    }
    list.setAttribute('aria-busy', String(this.#root?.status === 'loading'));
    if (this.#config.selection === 'multi') list.setAttribute('aria-multiselectable', 'true');
    else list.removeAttribute('aria-multiselectable');
    // Exactly one item is in the tab order.
    if (!this.#focusKey || !this.#elements.has(this.#focusKey)) this.#focusKey = (this.#rows.find(r => !r.more) ?? this.#rows[0])?.key ?? null;
    for (const [key, li] of this.#elements) li.tabIndex = key === this.#focusKey ? 0 : -1;
    if (focused) {
      const target = this.#elements.get(focused) ?? this.#elements.get(this.#focusKey ?? '');
      if (target && document.activeElement !== target) target.focus({ preventScroll: true });
    }
    this.#paintSelection();
  }

  #element(row: Row): HTMLLIElement {
    let li = this.#elements.get(row.key);
    if (!li) {
      li = document.createElement('li');
      li.setAttribute('role', 'treeitem');
      li.dataset.key = row.key;
      this.#elements.set(row.key, li);
    }
    li.setAttribute('aria-level', String(row.depth));
    li.style.setProperty('--ar-tree-depth', String(row.depth - 1));
    if (row.more) {
      li.className = 'ar-tree__item ar-tree__more';
      li.textContent = row.more.status === 'loading-more' ? 'Loading…' : 'Show more';
      li.removeAttribute('aria-posinset');
      li.removeAttribute('aria-setsize');
      li.toggleAttribute('aria-busy', row.more.status === 'loading-more');
      return li;
    }
    const data = this.#data(row);
    li.className = 'ar-tree__item';
    li.dataset.id = row.id;
    li.setAttribute('aria-posinset', String(row.posinset));
    li.setAttribute('aria-setsize', String(row.setsize));
    const parent = this.#hasChildren(data);
    if (parent) {
      const open = this.#expanded.has(row.key);
      li.setAttribute('aria-expanded', String(open));
      const children = this.#views.get(row.key);
      li.toggleAttribute('aria-busy', open && !!children && children.status === 'loading');
    } else {
      li.removeAttribute('aria-expanded');
      li.removeAttribute('aria-busy');
    }
    let label = li.querySelector<HTMLElement>(':scope > .ar-tree__label');
    if (!label) {
      li.replaceChildren();
      const toggle = document.createElement('span');
      toggle.className = 'ar-tree__toggle';
      toggle.setAttribute('aria-hidden', 'true');
      label = document.createElement('span');
      label.className = 'ar-tree__label';
      li.append(toggle, label);
    }
    label.textContent = this.#label(data, row.id);
    if (data) this.#config!.render?.(li, data);
    return li;
  }

  #paintSelection(): void {
    const mode = this.#config?.selection ?? 'none';
    const selected = new Set(this.value);
    for (const [key, li] of this.#elements) {
      if (mode === 'none' || key.endsWith('…more')) li.removeAttribute('aria-selected');
      else li.setAttribute('aria-selected', String(selected.has(li.dataset.id ?? '')));
    }
  }

  // ── Interaction ──────────────────────────────────────────────────────────

  #rowFor(target: Element): Row | undefined {
    const li = target.closest<HTMLElement>('[role="treeitem"]');
    return li ? this.#rows.find(r => r.key === li.dataset.key) : undefined;
  }

  /** Open or close the node with this key. */
  toggle(key: string, expanded = !this.#expanded.has(key)): void {
    const row = this.#rows.find(r => r.key === key);
    if (!row || row.more || !this.#hasChildren(this.#data(row))) return;
    if (expanded === this.#expanded.has(key)) return;
    if (expanded) {
      this.#expanded.add(key);
      this.#childView(key, this.#data(row));
    } else {
      this.#expanded.delete(key);
      // Focus inside a closing branch moves to the branch.
      if (this.#focusKey?.startsWith(`${key}/`)) this.#focusKey = key;
    }
    this.emit('tree:toggle', { key, id: row.id, expanded });
    this.#render();
  }

  #focus(row: Row | undefined): void {
    if (!row) return;
    this.#focusKey = row.key;
    for (const [key, li] of this.#elements) li.tabIndex = key === row.key ? 0 : -1;
    this.#elements.get(row.key)?.focus();
  }

  #select(row: Row, { toggle = false } = {}): void {
    const mode = this.#config?.selection ?? 'none';
    if (mode === 'none' || row.more) return;
    let next: string[];
    if (mode === 'single') next = [row.id];
    else if (toggle) next = this.value.includes(row.id) ? this.value.filter(id => id !== row.id) : [...this.value, row.id];
    else next = [row.id];
    this.commitValue(next);
    this.emit('tree:select', { ids: next });
  }

  #activate(row: Row): void {
    this.#select(row, { toggle: false });
    this.emit('tree:activate', { key: row.key, id: row.id, data: this.#data(row) });
  }

  #onClick(e: MouseEvent): void {
    const row = this.#rowFor(e.target as Element);
    if (!row) return;
    this.#focus(row);
    if (row.more) {
      void getRuntime().listViews.loadMore(row.more);
      return;
    }
    if ((e.target as Element).closest('.ar-tree__toggle')) {
      this.toggle(row.key);
      return;
    }
    this.#select(row, { toggle: this.#config?.selection === 'multi' && (e.ctrlKey || e.metaKey) });
  }

  #onKey(e: KeyboardEvent): void {
    const index = this.#rows.findIndex(r => r.key === this.#focusKey);
    const row = this.#rows[index];
    if (!row) return;
    const handled = (): void => e.preventDefault();
    switch (e.key) {
      case 'ArrowDown':
        handled();
        this.#focus(this.#rows[index + 1]);
        break;
      case 'ArrowUp':
        handled();
        this.#focus(this.#rows[index - 1]);
        break;
      case 'Home':
        handled();
        this.#focus(this.#rows[0]);
        break;
      case 'End':
        handled();
        this.#focus(this.#rows[this.#rows.length - 1]);
        break;
      case 'ArrowRight': {
        handled();
        if (row.more || !this.#hasChildren(this.#data(row))) break;
        if (!this.#expanded.has(row.key)) this.toggle(row.key, true);
        else {
          const next = this.#rows[index + 1];
          if (next?.parentKey === row.key) this.#focus(next);
        }
        break;
      }
      case 'ArrowLeft':
        handled();
        if (this.#expanded.has(row.key)) this.toggle(row.key, false);
        else this.#focus(this.#rows.find(r => r.key === row.parentKey));
        break;
      case '*':
        handled();
        for (const sibling of this.#rows.filter(r => r.parentKey === row.parentKey && !r.more)) {
          if (this.#hasChildren(this.#data(sibling))) this.#expanded.add(sibling.key);
        }
        this.#render();
        break;
      case 'Enter':
        handled();
        if (row.more) void getRuntime().listViews.loadMore(row.more);
        else this.#activate(row);
        break;
      case ' ':
        handled();
        if (row.more) void getRuntime().listViews.loadMore(row.more);
        else this.#select(row, { toggle: this.#config?.selection === 'multi' });
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) this.#typeahead(e.key, index);
    }
  }

  #typeahead(char: string, from: number): void {
    const now = Date.now();
    this.#typed = now - this.#typedAt > 500 ? char.toLowerCase() : this.#typed + char.toLowerCase();
    this.#typedAt = now;
    const n = this.#rows.length;
    // A single repeated letter cycles; otherwise search from the current item.
    const start = this.#typed.length === 1 ? from + 1 : from;
    for (let k = 0; k < n; k++) {
      const row = this.#rows[(start + k) % n];
      if (!row.more && this.#label(this.#data(row), row.id).toLowerCase().startsWith(this.#typed)) {
        this.#focus(row);
        return;
      }
    }
  }
}

/** Define `<a-tree>` (idempotent). `import 'arethesis/components/tree'` calls this. */
export function defineTree(): void {
  defineComponent({ tag: 'a-tree' })(Tree);
}
