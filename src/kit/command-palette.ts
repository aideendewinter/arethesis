/**
 * `<a-command-palette>`: a keyboard-first launcher (Ctrl/Cmd+K) that searches
 * commands and data.
 *
 * ```ts
 * palette.addSource({
 *   id: 'pages', label: 'Pages',
 *   commands: () => [{ id: 'home', title: 'Home', run: () => location.assign('/') }],
 * });
 * palette.addSource(storeSource({ type: 'Person', label: 'People', title: p => p.name, run: p => open(p.id) }));
 * ```
 *
 * - A modal `<dialog>`: focus stays inside, the page behind is inert, and
 *   focus returns where it was on close.
 * - The input is a combobox (`aria-activedescendant`) over a grouped
 *   listbox: ↑/↓ move, Page Up/Down jump, Enter runs, Escape closes.
 * - Fuzzy matching ignores case and accents and highlights what matched.
 * - With an empty query it shows recent commands (remembered in
 *   localStorage when available) and then everything.
 * - Sources can be static lists or search functions (sync or async).
 *
 * Attributes: `hotkey` (default `k`; set `hotkey=""` to turn the shortcut
 * off), `placeholder`. Events: `palette:open`, `palette:close`, `palette:run` `{ command }`.
 *
 * @module kit/command-palette
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import { getRuntime } from '../components/runtime';
import { fuzzyFilter, highlightMatch as highlight, type FuzzyMatch } from '../utils/fuzzy';
import { uniqueId } from '../utils/dom';
import { modal, type Modal } from './internal/modal';

export interface PaletteCommand {
  id: string;
  title: string;
  /** Shown under the title, and searched (with less weight). */
  subtitle?: string;
  /** Other words that should find this command. */
  keywords?: string[];
  /** Shortcut hint, e.g. "Ctrl+Shift+L". */
  shortcut?: string;
  /** A short glyph shown before the title. */
  icon?: string;
  run: () => void | Promise<void>;
}

export interface PaletteSource {
  id: string;
  /** Group heading. */
  label: string;
  /** All commands (filtered by the palette). */
  commands?: () => PaletteCommand[];
  /** Or search yourself, for large or remote data: return matches for a query. */
  search?: (query: string) => PaletteCommand[] | Promise<PaletteCommand[]>;
  /** Most items shown from this source. @default 8 */
  limit?: number;
  /** Lower comes first. @default 0 */
  order?: number;
}

const RECENT_KEY = 'ar-palette-recent';

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 8)));
  } catch {
    /* storage unavailable: recents last for this page only */
  }
}

/** A source that searches objects of one type in the store. */
export function storeSource<T>(options: {
  type: string;
  label: string;
  title: (data: T) => string;
  subtitle?: (data: T) => string;
  icon?: string;
  run: (data: T, id: string) => void;
  limit?: number;
  order?: number;
}): PaletteSource {
  return {
    id: `store:${options.type}`,
    label: options.label,
    limit: options.limit ?? 6,
    order: options.order,
    search: query => {
      if (!query.trim()) return [];
      const objects = getRuntime().store.getByType<T>(options.type);
      return fuzzyFilter(query, objects, o => [options.title(o.data), options.subtitle?.(o.data) ?? ''])
        .slice(0, options.limit ?? 6)
        .map(({ item }) => ({
          id: `${options.type}:${item.id}`,
          title: options.title(item.data),
          subtitle: options.subtitle?.(item.data),
          icon: options.icon,
          run: () => options.run(item.data, String(item.id)),
        }));
    },
  };
}

interface Row {
  command: PaletteCommand;
  group: string;
  match?: FuzzyMatch;
  field?: number;
}

export class CommandPalette extends Component {
  #sources = new Map<string, PaletteSource>();
  #dialog!: HTMLDialogElement;
  #input!: HTMLInputElement;
  #list!: HTMLElement;
  #status!: HTMLElement;
  #rows: Row[] = [];
  #active = 0;
  #recent = loadRecent();
  #modal: Modal | null = null;
  #searchToken = 0;
  #built = false;
  #id = uniqueId('ar-palette');

  static get observedAttributes(): string[] {
    return ['placeholder'];
  }

  attributeChangedCallback(): void {
    if (this.#built) this.#input.placeholder = this.getAttribute('placeholder') ?? 'Type a command or search…';
  }

  /** Add (or replace) a source of commands. Returns a function that removes it. */
  addSource(source: PaletteSource): () => void {
    this.#sources.set(source.id, source);
    if (this.isOpen) void this.#update();
    return () => this.#sources.delete(source.id);
  }

  removeSource(id: string): void {
    this.#sources.delete(id);
  }

  get isOpen(): boolean {
    return this.#built && this.#dialog.open;
  }

  protected override onConnected(): void {
    this.#build();
    this.listen(document, 'keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      const hotkey = this.getAttribute('hotkey') ?? 'k';
      if (!hotkey || ke.key.toLowerCase() !== hotkey || !(ke.ctrlKey || ke.metaKey) || ke.altKey || ke.shiftKey) return;
      ke.preventDefault();
      if (this.isOpen) this.close();
      else this.open();
    });
  }

  #build(): void {
    if (this.#built) return;
    this.#built = true;
    this.innerHTML = `
      <dialog class="ar-palette" aria-label="Command palette">
        <div class="ar-palette__search">
          <svg class="ar-palette__icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.6 12.6 17 17"/></svg>
          <input class="ar-palette__input" type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" autocomplete="off" spellcheck="false">
          <kbd class="ar-palette__esc" aria-hidden="true">Esc</kbd>
        </div>
        <div class="ar-palette__list" role="listbox" id="${this.#id}-list" aria-label="Results"></div>
        <p class="ar-palette__status" role="status" aria-live="polite"></p>
        <p class="ar-palette__help" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></p>
      </dialog>`;
    this.#dialog = this.querySelector('dialog')!;
    this.#input = this.querySelector('input')!;
    this.#list = this.querySelector('.ar-palette__list')!;
    this.#status = this.querySelector('.ar-palette__status')!;
    this.#input.setAttribute('aria-controls', this.#list.id);
    this.#input.setAttribute('aria-label', 'Search commands');
    this.#input.placeholder = this.getAttribute('placeholder') ?? 'Type a command or search…';
    this.listen(this.#input, 'input', () => void this.#update());
    this.listen(this.#input, 'keydown', (e: Event) => this.#onKey(e as KeyboardEvent));
    this.#modal?.destroy();
    this.#modal = modal(this.#dialog, { initialFocus: () => this.#input, onClose: () => this.emit('palette:close', {}) });
    this.listen(this.#list, 'mousedown', (e: Event) => e.preventDefault());
    this.listen(this.#list, 'click', (e: Event) => {
      const option = (e.target as Element).closest<HTMLElement>('[role=option]');
      if (option) void this.#run(Number(option.dataset.index));
    });
    this.listen(this.#list, 'mousemove', (e: Event) => {
      const option = (e.target as Element).closest<HTMLElement>('[role=option]');
      if (option && Number(option.dataset.index) !== this.#active) this.#setActive(Number(option.dataset.index), false);
    });
  }

  /** Open the palette, optionally with a query. */
  open(query = ''): void {
    if (this.isOpen) return;
    this.#input.value = query;
    this.#modal!.open();
    void this.#update();
    this.emit('palette:open', {});
  }

  close(): void {
    if (this.isOpen) this.#modal!.close();
  }

  async #update(): Promise<void> {
    const token = ++this.#searchToken;
    const query = this.#input.value;
    const sources = [...this.#sources.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const rows: Row[] = [];
    if (!query.trim()) {
      const all = new Map<string, Row>();
      for (const s of sources) for (const c of s.commands?.() ?? []) all.set(c.id, { command: c, group: s.label });
      const recent = this.#recent.map(id => all.get(id)).filter((r): r is Row => !!r).slice(0, 5);
      rows.push(...recent.map(r => ({ ...r, group: 'Recent' })));
      for (const s of sources) {
        for (const c of (s.commands?.() ?? []).slice(0, s.limit ?? 8)) {
          if (!recent.some(r => r.command.id === c.id)) rows.push({ command: c, group: s.label });
        }
      }
    } else {
      for (const s of sources) {
        let found: Row[] = [];
        if (s.commands) {
          found = fuzzyFilter(query, s.commands(), c => [c.title, [c.subtitle ?? '', ...(c.keywords ?? [])].join(' ')])
            .map(({ item, match, field }) => ({ command: item, group: s.label, match, field }));
        }
        if (s.search) {
          const result = await s.search(query);
          if (token !== this.#searchToken) return;
          found.push(...result.map(c => ({ command: c, group: s.label, match: fuzzyFilter(query, [c], x => x.title)[0]?.match })));
        }
        rows.push(...found.slice(0, s.limit ?? 8));
      }
    }
    if (token !== this.#searchToken) return;
    this.#rows = rows;
    this.#render();
  }

  #render(): void {
    const groups = new Map<string, HTMLElement>();
    this.#list.replaceChildren();
    this.#rows.forEach((row, index) => {
      let group = groups.get(row.group);
      if (!group) {
        group = document.createElement('div');
        group.setAttribute('role', 'group');
        group.className = 'ar-palette__group';
        const heading = document.createElement('div');
        heading.className = 'ar-palette__heading';
        heading.id = uniqueId('ar-palette-group');
        heading.textContent = row.group;
        heading.setAttribute('role', 'presentation');
        group.setAttribute('aria-labelledby', heading.id);
        group.appendChild(heading);
        groups.set(row.group, group);
        this.#list.appendChild(group);
      }
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.className = 'ar-palette__option';
      option.id = `${this.#id}-${index}`;
      option.dataset.index = String(index);
      const { command } = row;
      if (command.icon) {
        const icon = document.createElement('span');
        icon.className = 'ar-palette__glyph';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = command.icon;
        option.appendChild(icon);
      }
      const text = document.createElement('span');
      text.className = 'ar-palette__text';
      const title = document.createElement('span');
      title.className = 'ar-palette__title';
      title.append(...highlight(command.title, row.field === 0 || row.field === undefined ? row.match?.indices : undefined));
      text.appendChild(title);
      if (command.subtitle) {
        const sub = document.createElement('span');
        sub.className = 'ar-palette__subtitle';
        sub.textContent = command.subtitle;
        text.appendChild(sub);
      }
      option.appendChild(text);
      if (command.shortcut) {
        const kbd = document.createElement('kbd');
        kbd.className = 'ar-palette__shortcut';
        kbd.textContent = command.shortcut;
        option.appendChild(kbd);
      }
      group.appendChild(option);
    });
    this.#status.textContent = this.#rows.length ? `${this.#rows.length} result${this.#rows.length === 1 ? '' : 's'}` : 'No results';
    this.#list.toggleAttribute('data-empty', !this.#rows.length);
    this.#setActive(0, true);
  }

  #setActive(index: number, scroll: boolean): void {
    if (!this.#rows.length) {
      this.#input.removeAttribute('aria-activedescendant');
      return;
    }
    this.#active = Math.max(0, Math.min(this.#rows.length - 1, index));
    for (const el of this.#list.querySelectorAll('[role=option]')) {
      const on = Number((el as HTMLElement).dataset.index) === this.#active;
      el.setAttribute('aria-selected', String(on));
      if (on && scroll) el.scrollIntoView?.({ block: 'nearest' });
    }
    this.#input.setAttribute('aria-activedescendant', `${this.#id}-${this.#active}`);
  }

  #onKey(e: KeyboardEvent): void {
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': this.#setActive(this.#active + 1 >= this.#rows.length ? 0 : this.#active + 1, true); break;
      case 'ArrowUp': this.#setActive(this.#active - 1 < 0 ? this.#rows.length - 1 : this.#active - 1, true); break;
      case 'PageDown': this.#setActive(this.#active + 5, true); break;
      case 'PageUp': this.#setActive(this.#active - 5, true); break;
      case 'Enter': void this.#run(this.#active); break;
      case 'Escape':
        // Clear the query first; a second Escape closes.
        if (this.#input.value) {
          this.#input.value = '';
          void this.#update();
        } else this.close();
        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  async #run(index: number): Promise<void> {
    const row = this.#rows[index];
    if (!row) return;
    this.#recent = [row.command.id, ...this.#recent.filter(id => id !== row.command.id)];
    saveRecent(this.#recent);
    this.close();
    this.emit('palette:run', { command: row.command });
    await row.command.run();
  }
}


/** Define `<a-command-palette>` (idempotent). `import 'arethesis/components/command-palette'` calls this. */
export function defineCommandPalette(): void {
  defineComponent({ tag: 'a-command-palette' })(CommandPalette);
}
