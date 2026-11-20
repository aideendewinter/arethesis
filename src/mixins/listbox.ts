/**
 * `listbox`: a select-only combobox (WAI-ARIA APG pattern), a keyboard- and
 * screen-reader-friendly replacement for `<select>` where a native one
 * misbehaves, such as inside a grid cell.
 *
 * Unlike a native select, moving through the options never commits a value:
 * arrows move the active option, and Enter, Tab, Alt+↑ or a click pick it.
 *
 * - Closed: ↓, ↑, Enter, Space or Alt+↓ open it; Home/End open on the first
 *   or last option; typing opens it and jumps to a matching option.
 * - Open: ↑/↓ (and Page Up/Down, Home/End) move; typing jumps (type-ahead);
 *   Enter or Alt+↑ picks; Tab picks and lets focus move on; Escape closes
 *   without changing the value.
 *
 * Events (on the element): `listbox:change` `{ value }` when a value is
 * picked, `listbox:commit` `{ value, key, shiftKey }` for how it was picked
 * (`'Enter'`, `'Tab'`, `'click'`…), `listbox:cancel` when closed with Escape.
 *
 * @module mixins/listbox
 */

import type { MixinInstance } from './types';
import { emit } from './utils';
import { uniqueId } from '../utils/dom';

export interface ListboxOption {
  value: string;
  label?: string;
  disabled?: boolean;
}

export interface ListboxOptions {
  options: Array<string | ListboxOption>;
  /** The selected value. @default the first option */
  value?: string;
  /** Accessible name. @default the element's aria-label */
  label?: string;
  /** Open as soon as it's applied. @default false */
  open?: boolean;
  /** Where to put the popup. @default right after the element */
  container?: HTMLElement;
}

export function listboxMixin(element: HTMLElement, config: ListboxOptions): MixinInstance {
  const controller = new AbortController();
  const { signal } = controller;
  const options: ListboxOption[] = config.options.map(o => (typeof o === 'string' ? { value: o } : o));
  const labelOf = (o: ListboxOption) => o.label ?? o.value;
  let value = config.value ?? options[0]?.value ?? '';
  let active = Math.max(0, options.findIndex(o => o.value === value));
  let isOpen = false;
  let typed = '';
  let typedAt = 0;

  const id = uniqueId('ar-listbox');
  const list = document.createElement('ul');
  list.id = id;
  list.className = 'ar-listbox';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  list.tabIndex = -1;
  const label = config.label ?? element.getAttribute('aria-label');
  if (label) list.setAttribute('aria-label', label);
  options.forEach((o, i) => {
    const li = document.createElement('li');
    li.id = `${id}-${i}`;
    li.className = 'ar-listbox__option';
    li.setAttribute('role', 'option');
    li.textContent = labelOf(o);
    if (o.disabled) li.setAttribute('aria-disabled', 'true');
    list.appendChild(li);
  });
  (config.container ?? element.parentElement ?? document.body).appendChild(list);
  if (!config.container) element.after(list);

  const display = document.createElement('span');
  display.className = 'ar-listbox__value';
  element.replaceChildren(display);
  element.classList.add('ar-listbox__button');
  element.setAttribute('role', 'combobox');
  element.setAttribute('aria-haspopup', 'listbox');
  element.setAttribute('aria-controls', id);
  element.setAttribute('aria-expanded', 'false');
  if (!element.hasAttribute('tabindex')) element.tabIndex = 0;

  const items = () => Array.from(list.children) as HTMLElement[];

  function render(): void {
    display.textContent = labelOf(options.find(o => o.value === value) ?? { value });
    items().forEach((li, i) => {
      li.setAttribute('aria-selected', String(options[i].value === value));
      li.classList.toggle('is-active', i === active && isOpen);
    });
    if (isOpen && items()[active]) {
      element.setAttribute('aria-activedescendant', items()[active].id);
      items()[active].scrollIntoView?.({ block: 'nearest' });
    } else {
      element.removeAttribute('aria-activedescendant');
    }
  }

  /** Make an option active, skipping disabled ones in the direction of travel. */
  function setActive(index: number, direction: 1 | -1 = 1): void {
    const clamp = (i: number) => Math.max(0, Math.min(options.length - 1, i));
    for (const dir of [direction, -direction as 1 | -1]) {
      for (let i = clamp(index); i >= 0 && i < options.length; i += dir) {
        if (!options[i].disabled) {
          active = i;
          render();
          return;
        }
      }
    }
  }

  function open(at = active): void {
    if (isOpen) return;
    isOpen = true;
    list.hidden = false;
    element.setAttribute('aria-expanded', 'true');
    setActive(at);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    list.hidden = true;
    element.setAttribute('aria-expanded', 'false');
    render();
  }

  function pick(index: number, key: string, shiftKey = false): void {
    const option = options[index];
    if (!option || option.disabled) return;
    const changed = option.value !== value;
    value = option.value;
    active = index;
    close();
    if (changed) emit(element, 'listbox:change', { value });
    emit(element, 'listbox:commit', { value, key, shiftKey });
  }

  /** Type-ahead: jump to the next option starting with what was typed. */
  function typeAhead(char: string): void {
    const now = Date.now();
    typed = now - typedAt > 600 ? char : typed + char;
    typedAt = now;
    const search = typed.toLowerCase();
    const start = typed.length === 1 ? active + 1 : active;
    for (let n = 0; n < options.length; n++) {
      const i = (start + n) % options.length;
      if (!options[i].disabled && labelOf(options[i]).toLowerCase().startsWith(search)) {
        setActive(i);
        return;
      }
    }
  }

  element.addEventListener('keydown', (e: KeyboardEvent) => {
    let handled = true;
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') open();
      else if (e.key === 'Home') open(0);
      else if (e.key === 'End') open(options.length - 1);
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        open();
        typeAhead(e.key);
      } else handled = false;
    } else {
      switch (e.key) {
        case 'ArrowDown': if (e.altKey) handled = false; else setActive(Math.min(options.length - 1, active + 1)); break;
        case 'ArrowUp': if (e.altKey) pick(active, 'Enter'); else setActive(Math.max(0, active - 1), -1); break;
        case 'PageDown': setActive(Math.min(options.length - 1, active + 10)); break;
        case 'PageUp': setActive(Math.max(0, active - 10), -1); break;
        case 'Home': setActive(0); break;
        case 'End': setActive(options.length - 1, -1); break;
        case 'Enter': pick(active, 'Enter', e.shiftKey); break;
        case 'Escape':
          close();
          emit(element, 'listbox:cancel', {});
          break;
        case 'Tab':
          pick(active, 'Tab', e.shiftKey);
          handled = false; // let focus move on
          break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeAhead(e.key);
          else handled = false;
      }
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, { signal });

  element.addEventListener('click', () => (isOpen ? close() : open()), { signal });
  // Pick with the mouse without taking focus from the combobox.
  list.addEventListener('mousedown', e => e.preventDefault(), { signal });
  list.addEventListener('click', (e: MouseEvent) => {
    const li = (e.target as HTMLElement).closest('[role=option]');
    if (li) pick(items().indexOf(li as HTMLElement), 'click');
  }, { signal });
  list.addEventListener('mousemove', (e: MouseEvent) => {
    const li = (e.target as HTMLElement).closest('[role=option]');
    const i = li ? items().indexOf(li as HTMLElement) : -1;
    if (i !== -1 && i !== active && !options[i].disabled) setActive(i);
  }, { signal });
  element.addEventListener('blur', () => close(), { signal });

  render();
  if (config.open) open();

  return {
    name: 'listbox',
    element,
    options: config as unknown as Record<string, unknown>,
    open: () => open(),
    close,
    isOpen: () => isOpen,
    /** The selected value. */
    getValue: () => value,
    /** The option that is active (highlighted) while open. */
    getActiveValue: () => options[active]?.value,
    setValue: (next: string) => {
      value = next;
      active = Math.max(0, options.findIndex(o => o.value === next));
      render();
    },
    destroy: () => {
      controller.abort();
      list.remove();
      element.removeAttribute('role');
      element.removeAttribute('aria-haspopup');
      element.removeAttribute('aria-controls');
      element.removeAttribute('aria-expanded');
      element.removeAttribute('aria-activedescendant');
      element.classList.remove('ar-listbox__button');
    },
  };
}
