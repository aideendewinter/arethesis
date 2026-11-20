/**
 * `<a-combobox>`: a text field with a list of suggestions (the WAI-ARIA
 * combobox pattern with list autocomplete). It's a form control: its value is
 * submitted under its `name`, and `required` works as on an input.
 *
 * Options can be written in the markup, so it works before scripts run:
 *
 * ```html
 * <label for="city">City</label>
 * <a-combobox id="city" name="city" required>
 *   <option value="ath">Athens</option>
 *   <option value="spa">Sparta</option>
 * </a-combobox>
 * ```
 *
 * Or come from a function or an endpoint, searched as you type:
 *
 * ```ts
 * combobox.configure({ source: { endpoint: 'searchPeople', param: 'q' }, valueField: 'id', labelField: 'name' });
 * ```
 *
 * Keys: Down/Up open the list and move through it, Enter picks, Escape closes
 * (and a second Escape clears the text), Alt+Down opens without moving.
 * Typing filters; matched letters are highlighted. Results are announced.
 *
 * Event: `combobox:select` (`{ value, label, data }`), as well as `input` and `change`.
 *
 * @module components/combobox
 */

import { FormAssociatedComponent } from '../components/form-associated';
import { defineComponent } from '../components/decorators';
import { getRuntime } from '../components/runtime';
import { attachPopup, type Popup } from '../mixins/popup';
import { announce } from '../mixins/utils';
import { fuzzyFilter, highlightMatch } from '../utils/fuzzy';
import { getPath } from '../utils/path';
import type { Params } from '../http/types';
import { uniqueId } from '../utils/dom';

export interface ComboboxOption {
  value: string;
  label?: string;
  /** Extra text that matches (shown nowhere). */
  keywords?: string;
  disabled?: boolean;
  /** The object it came from, for a search source. */
  data?: unknown;
}

export type ComboboxSource =
  | Array<string | ComboboxOption>
  | ((query: string, signal: AbortSignal) => Promise<Array<string | ComboboxOption | Record<string, unknown>>>)
  | { endpoint: string; param?: string; params?: Params };

export interface ComboboxConfig {
  /** Options, a search function, or an endpoint to search. @default the `<option>` children */
  source?: ComboboxSource;
  /** For objects from a search: the field holding the value. @default 'id' */
  valueField?: string;
  /** For objects from a search: the field shown. @default 'name', then 'label', 'title' */
  labelField?: string;
  /** Wait this long after typing before searching. @default 200 (0 for local options) */
  debounce?: number;
  /** Characters needed before searching. @default 1 (0 for local options) */
  minChars?: number;
  /** Accept text that isn't one of the options as the value. @default false */
  allowCustom?: boolean;
  /** Most options shown. @default 50 */
  limit?: number;
  /** Shown when nothing matches. @default 'No matches' */
  emptyText?: string;
}

export class Combobox extends FormAssociatedComponent<string> {
  #config: ComboboxConfig = {};
  #input: HTMLInputElement | null = null;
  #list: HTMLUListElement | null = null;
  #popup: Popup | null = null;
  #options: ComboboxOption[] = [];
  #shown: Array<{ option: ComboboxOption; indices?: number[] }> = [];
  #active = -1;
  #label = '';
  #timer: ReturnType<typeof setTimeout> | null = null;
  #search: AbortController | null = null;
  #escapes = 0;

  /** Set the source and options. Can be called before or after it's connected. */
  configure(config: ComboboxConfig): void {
    this.#config = { ...this.#config, ...config };
    if (Array.isArray(config.source)) this.#options = config.source.map(normalize);
    if (this.#input) this.#syncLabel();
  }

  /** The options currently in the list. */
  get options(): ComboboxOption[] {
    return this.#shown.map(s => s.option);
  }

  /** The text shown for the current value. */
  get label(): string {
    return this.#label;
  }

  get open(): boolean {
    return this.#popup?.isOpen() ?? false;
  }

  protected get focusTarget(): HTMLElement {
    return this.#input!;
  }

  protected serialize(value: string): string | null {
    return value === '' ? null : value;
  }

  protected parse(state: string): string {
    return state;
  }

  protected emptyValue(): string {
    return '';
  }

  protected override onConnected(): void {
    if (!this.#input) this.#build();
  }

  protected override onDisconnected(): void {
    this.#close();
    this.#search?.abort();
  }

  protected override onValueChange(value: string): void {
    if (!this.#input) return;
    const option = this.#find(value);
    this.#label = option ? labelOf(option) : value;
    if (document.activeElement !== this.#input || !this.open) this.#input.value = this.#label;
  }

  protected override onDisabledChange(disabled: boolean): void {
    if (this.#input) this.#input.disabled = disabled;
    if (disabled) this.#close();
  }

  static get observedAttributes(): string[] {
    return ['disabled', 'placeholder'];
  }

  attributeChangedCallback(name: string): void {
    if (!this.#input) return;
    if (name === 'disabled') this.onDisabledChange(this.disabled);
    if (name === 'placeholder') this.#input.placeholder = this.getAttribute('placeholder') ?? '';
  }

  // ── Building ─────────────────────────────────────────────────────────────

  #build(): void {
    const id = this.id || uniqueId('ar-combobox');
    // Options written in the markup.
    const markup = Array.from(this.querySelectorAll('option')).map(o => ({ value: o.value, label: o.textContent?.trim() || o.value, disabled: o.disabled }));
    if (!this.#config.source && markup.length) this.#options = markup;
    const initial = this.getAttribute('value') ?? this.querySelector<HTMLOptionElement>('option[selected]')?.value ?? '';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ar-combobox__input input';
    input.id = `${id}-input`;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', `${id}-list`);
    input.placeholder = this.getAttribute('placeholder') ?? '';
    input.disabled = this.disabled;
    const ariaLabel = this.getAttribute('aria-label');
    if (ariaLabel) input.setAttribute('aria-label', ariaLabel);
    if (this.required) input.setAttribute('aria-required', 'true');

    const list = document.createElement('ul');
    list.className = 'ar-combobox__list';
    list.id = `${id}-list`;
    list.setAttribute('role', 'listbox');
    if (ariaLabel) list.setAttribute('aria-label', ariaLabel);

    this.replaceChildren(input, list);
    this.#input = input;
    this.#list = list;
    this.#popup = attachPopup(list, { anchor: () => input, placement: 'bottom', gap: 4, matchWidth: true });

    const signal = this.signal;
    input.addEventListener('input', e => {
      // The form value only changes on a pick (or on commit with allowCustom).
      e.stopPropagation();
      this.#escapes = 0;
      this.#query(input.value);
    }, { signal });
    // The inner input's own `change` isn't the component's.
    input.addEventListener('change', e => e.stopPropagation(), { signal });
    input.addEventListener('keydown', e => this.#onKey(e), { signal });
    input.addEventListener('blur', () => this.#onBlur(), { signal });
    input.addEventListener('click', () => {
      if (!this.open) this.#query(input.value === this.#label ? '' : input.value);
    }, { signal });
    // Keep focus in the input while picking with the mouse.
    list.addEventListener('pointerdown', e => e.preventDefault(), { signal });
    list.addEventListener('click', e => {
      const li = (e.target as Element).closest<HTMLElement>('[role="option"]');
      if (li && li.getAttribute('aria-disabled') !== 'true') this.#pick(Number(li.dataset.index));
    }, { signal });

    this.value = initial;
    this.#syncLabel();
  }

  #syncLabel(): void {
    this.onValueChange(this.value);
  }

  #find(value: string): ComboboxOption | undefined {
    return this.#options.find(o => o.value === value) ?? this.#shown.find(s => s.option.value === value)?.option;
  }

  // ── Searching ────────────────────────────────────────────────────────────

  #isLocal(): boolean {
    return !this.#config.source || Array.isArray(this.#config.source);
  }

  #query(text: string): void {
    if (this.#timer) clearTimeout(this.#timer);
    const local = this.#isLocal();
    const minChars = this.#config.minChars ?? (local ? 0 : 1);
    if (text.trim().length < minChars) {
      this.#search?.abort();
      if (local) this.#show(this.#filter(''));
      else this.#close();
      return;
    }
    if (local) {
      this.#show(this.#filter(text));
      return;
    }
    const delay = this.#config.debounce ?? 200;
    this.#timer = setTimeout(() => void this.#remote(text), delay);
  }

  #filter(text: string): Array<{ option: ComboboxOption; indices?: number[] }> {
    const limit = this.#config.limit ?? 50;
    if (!text.trim()) return this.#options.slice(0, limit).map(option => ({ option }));
    return fuzzyFilter(text, this.#options, o => [labelOf(o), o.keywords ?? ''])
      .slice(0, limit)
      .map(r => ({ option: r.item, indices: r.field === 0 ? r.match.indices : undefined }));
  }

  async #remote(text: string): Promise<void> {
    this.#search?.abort();
    const controller = new AbortController();
    this.#search = controller;
    this.#input?.setAttribute('aria-busy', 'true');
    try {
      const source = this.#config.source!;
      let items: unknown[];
      if (typeof source === 'function') {
        items = await source(text, controller.signal);
      } else {
        const s = source as { endpoint: string; param?: string; params?: Params };
        const result = await getRuntime().http.fetchEndpoint<unknown>(s.endpoint, { ...s.params, [s.param ?? 'q']: text }, { signal: controller.signal });
        items = Array.isArray(result.data) ? result.data : [];
      }
      // A newer search started meanwhile: drop these results.
      if (controller.signal.aborted || this.#search !== controller) return;
      this.#options = items.map(item => this.#toOption(item));
      const limit = this.#config.limit ?? 50;
      this.#show(this.#options.slice(0, limit).map(option => ({ option, indices: fuzzyFilter(text, [option], labelOf)[0]?.match.indices })));
    } catch (error) {
      if (controller.signal.aborted) return;
      this.emit('combobox:error', { error });
      this.#show([]);
    } finally {
      if (this.#search === controller) this.#input?.removeAttribute('aria-busy');
    }
  }

  #toOption(item: unknown): ComboboxOption {
    if (typeof item === 'string') return { value: item };
    const obj = item as Record<string, unknown>;
    if (typeof obj.value === 'string' && !this.#config.valueField) return normalize(obj as unknown as ComboboxOption);
    const value = getPath(obj, this.#config.valueField ?? 'id');
    const labelField = this.#config.labelField;
    const label = labelField ? getPath(obj, labelField) : obj.name ?? obj.label ?? obj.title;
    return { value: String(value ?? ''), label: label === undefined ? undefined : String(label), data: item };
  }

  // ── The list ─────────────────────────────────────────────────────────────

  #show(results: Array<{ option: ComboboxOption; indices?: number[] }>): void {
    const list = this.#list!;
    this.#shown = results;
    list.replaceChildren();
    results.forEach(({ option, indices }, index) => {
      const li = document.createElement('li');
      li.id = `${list.id}-${index}`;
      li.className = 'ar-combobox__option';
      li.setAttribute('role', 'option');
      li.dataset.index = String(index);
      li.setAttribute('aria-selected', String(option.value === this.value));
      if (option.disabled) li.setAttribute('aria-disabled', 'true');
      li.append(...highlightMatch(labelOf(option), indices));
      list.append(li);
    });
    if (!results.length) {
      const li = document.createElement('li');
      li.className = 'ar-combobox__empty';
      li.setAttribute('role', 'presentation');
      li.textContent = this.#config.emptyText ?? 'No matches';
      list.append(li);
    }
    this.#popup!.show();
    this.#input!.setAttribute('aria-expanded', 'true');
    const selected = results.findIndex(r => r.option.value === this.value);
    this.#setActive(selected >= 0 && !this.#input!.value.trim() ? selected : -1);
    this.#popup!.reposition();
    announce(results.length ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : this.#config.emptyText ?? 'No matches');
  }

  #setActive(index: number): void {
    this.#active = index;
    const items = Array.from(this.#list!.querySelectorAll<HTMLElement>('[role="option"]'));
    items.forEach((li, i) => li.classList.toggle('is-active', i === index));
    if (index >= 0 && items[index]) {
      this.#input!.setAttribute('aria-activedescendant', items[index].id);
      items[index].scrollIntoView?.({ block: 'nearest' });
    } else {
      this.#input!.removeAttribute('aria-activedescendant');
    }
  }

  #move(delta: number): void {
    const n = this.#shown.length;
    if (!n) return;
    let i = this.#active;
    for (let step = 0; step < n; step++) {
      i = i < 0 ? (delta > 0 ? 0 : n - 1) : (i + delta + n) % n;
      if (!this.#shown[i].option.disabled) break;
    }
    this.#setActive(i);
  }

  #close(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#popup?.hide();
    this.#input?.setAttribute('aria-expanded', 'false');
    this.#input?.removeAttribute('aria-activedescendant');
    this.#active = -1;
  }

  #pick(index: number): void {
    const entry = this.#shown[index];
    if (!entry || entry.option.disabled) return;
    const { option } = entry;
    if (!this.#options.includes(option)) this.#options.push(option);
    this.#close();
    this.#input!.value = labelOf(option);
    if (option.value !== this.value) this.commitValue(option.value);
    else this.onValueChange(option.value);
    this.emit('combobox:select', { value: option.value, label: labelOf(option), data: option.data });
  }

  #onKey(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!this.open) {
          this.#query(this.#input!.value === this.#label ? '' : this.#input!.value);
          if (!e.altKey) this.#move(1);
        } else {
          this.#move(1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (this.open) this.#move(-1);
        break;
      case 'Enter':
        if (this.open && this.#active >= 0) {
          e.preventDefault();
          this.#pick(this.#active);
        } else if (this.#config.allowCustom) {
          this.#commitText();
        }
        break;
      case 'Escape':
        if (this.open) {
          e.preventDefault();
          this.#close();
          this.#escapes = 1;
        } else if (this.#escapes >= 1 || !this.#config.allowCustom) {
          // Second Escape: clear.
          this.#input!.value = '';
          if (this.value !== '') this.commitValue('');
          this.#escapes = 0;
        }
        break;
      case 'Tab':
        this.#close();
        break;
    }
  }

  #onBlur(): void {
    this.#close();
    this.markTouched();
    const text = this.#input!.value.trim();
    if (this.#config.allowCustom) {
      this.#commitText();
    } else if (!text) {
      if (this.value !== '') this.commitValue('');
    } else {
      // Pick an exact match, or go back to the current value's label.
      const exact = this.#options.find(o => labelOf(o).toLowerCase() === text.toLowerCase() && !o.disabled);
      if (exact && exact.value !== this.value) this.commitValue(exact.value);
      this.#input!.value = this.#find(this.value) ? labelOf(this.#find(this.value)!) : this.value;
    }
  }

  #commitText(): void {
    const text = this.#input!.value.trim();
    const exact = this.#options.find(o => labelOf(o).toLowerCase() === text.toLowerCase());
    const next = exact?.value ?? text;
    if (next !== this.value) this.commitValue(next);
  }
}

function normalize(option: string | ComboboxOption): ComboboxOption {
  return typeof option === 'string' ? { value: option } : option;
}

function labelOf(option: ComboboxOption): string {
  return option.label ?? option.value;
}

/** Define `<a-combobox>` (idempotent). `import 'arethesis/components/combobox'` calls this. */
export function defineCombobox(): void {
  defineComponent({ tag: 'a-combobox' })(Combobox);
}
