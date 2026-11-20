/**
 * `dropdown`: turn a native `<select>` into an accessible, filterable combobox
 * (WAI-ARIA combobox with a listbox popup). The `<select>` stays in the DOM,
 * visually hidden, so forms and bindings keep working; it receives `change`
 * events as usual.
 *
 * Event: `dropdown:change` (detail `{ value, label }`) on the select.
 *
 * @module mixins/dropdown
 */

import type { DropdownOptions, MixinInstance } from './types';
import { emit } from './utils';
import { attachPopup } from './popup';
import { uniqueId } from '../utils/dom';

export function dropdownMixin(host: HTMLElement, options: DropdownOptions = {}): MixinInstance {
  if (!(host instanceof HTMLSelectElement)) throw new Error('dropdown mixin must be applied to a <select>');
  const select: HTMLSelectElement = host;
  const { searchable = true, emptyText = 'No matches' } = options;
  const controller = new AbortController();
  const { signal } = controller;
  const id = uniqueId('dropdown');

  const wrapper = document.createElement('div');
  wrapper.className = 'dropdown';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dropdown__input';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', `${id}-list`);
  input.setAttribute('aria-autocomplete', searchable ? 'list' : 'none');
  input.autocomplete = 'off';
  input.readOnly = !searchable;
  input.placeholder = options.placeholder ?? select.getAttribute('placeholder') ?? '';
  const labelledBy = select.labels?.[0];
  if (labelledBy) {
    if (!labelledBy.id) labelledBy.id = `${id}-label`;
    input.setAttribute('aria-labelledby', labelledBy.id);
    labelledBy.htmlFor = `${id}-input`;
  } else if (select.getAttribute('aria-label')) {
    input.setAttribute('aria-label', select.getAttribute('aria-label')!);
  }
  input.id = `${id}-input`;
  if (select.disabled) input.disabled = true;

  const list = document.createElement('ul');
  list.className = 'dropdown__list';
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');

  wrapper.append(input, list);
  // In the top layer, so a scrolling table or card can't clip it.
  const popup = attachPopup(list, { anchor: () => input, placement: 'bottom', gap: 4, matchWidth: true });
  // Before the select, so messages placed after the select (validation errors) appear below the combobox.
  select.insertAdjacentElement('beforebegin', wrapper);
  // Mirror validation state from the select onto the combobox.
  const mirror = (): void => {
    for (const attr of ['aria-invalid', 'aria-describedby', 'aria-required']) {
      const value = select.getAttribute(attr);
      if (value === null) input.removeAttribute(attr);
      else input.setAttribute(attr, value);
    }
    input.classList.toggle('is-invalid', select.classList.contains('is-invalid'));
  };
  mirror();
  const attrObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(mirror) : null;
  attrObserver?.observe(select, { attributes: true, attributeFilter: ['aria-invalid', 'aria-describedby', 'aria-required', 'class'] });
  select.classList.add('ar-visually-hidden');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  let activeIndex = -1;
  let visible: HTMLOptionElement[] = [];

  const optionsOf = (): HTMLOptionElement[] => Array.from(select.options).filter(o => !o.hidden);
  const selectedLabel = (): string => select.options[select.selectedIndex]?.textContent ?? '';

  function render(filter = ''): void {
    const q = filter.trim().toLowerCase();
    visible = optionsOf().filter(o => !q || (o.textContent ?? '').toLowerCase().includes(q));
    list.replaceChildren();
    if (!visible.length) {
      const li = document.createElement('li');
      li.className = 'dropdown__empty';
      li.textContent = emptyText;
      list.appendChild(li);
    }
    visible.forEach((opt, i) => {
      const li = document.createElement('li');
      li.id = `${id}-opt-${i}`;
      li.className = 'dropdown__option';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(opt.selected));
      if (opt.disabled) li.setAttribute('aria-disabled', 'true');
      li.dataset.value = opt.value;
      li.textContent = opt.textContent;
      list.appendChild(li);
    });
    setActive(Math.max(0, visible.findIndex(o => o.selected)));
  }

  function setActive(index: number): void {
    activeIndex = visible.length ? (index + visible.length) % visible.length : -1;
    list.querySelectorAll('[role="option"]').forEach((li, i) => li.classList.toggle('is-active', i === activeIndex));
    if (activeIndex >= 0) {
      input.setAttribute('aria-activedescendant', `${id}-opt-${activeIndex}`);
      list.querySelector(`#${id}-opt-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function open(): void {
    if (!list.hidden || input.disabled) return;
    render(searchable ? '' : '');
    popup.show();
    input.setAttribute('aria-expanded', 'true');
    wrapper.classList.add('is-open');
    if (searchable) input.select();
  }

  function close(restore = true): void {
    if (list.hidden) return;
    popup.hide();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    wrapper.classList.remove('is-open');
    if (restore) input.value = selectedLabel();
  }

  function choose(index: number): void {
    const opt = visible[index];
    if (!opt || opt.disabled) return;
    const changed = select.value !== opt.value;
    select.value = opt.value;
    input.value = opt.textContent ?? '';
    close(false);
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      options.onChange?.(opt.value);
      emit(select, 'dropdown:change', { value: opt.value, label: opt.textContent });
    }
  }

  input.value = selectedLabel();
  input.addEventListener('click', () => (list.hidden ? open() : close()), { signal });
  input.addEventListener('input', () => {
    if (list.hidden) open();
    render(input.value);
  }, { signal });
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (list.hidden) open();
        else setActive(activeIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (list.hidden) open();
        else setActive(activeIndex - 1);
        break;
      case 'Home':
        if (!list.hidden) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (!list.hidden) {
          e.preventDefault();
          setActive(visible.length - 1);
        }
        break;
      case 'Enter':
        if (!list.hidden) {
          e.preventDefault();
          choose(activeIndex);
        } else {
          open();
        }
        break;
      case 'Escape':
        if (!list.hidden) {
          e.preventDefault();
          close();
        }
        break;
      case 'Tab':
        close();
        break;
    }
  }, { signal });
  list.addEventListener('pointerdown', e => e.preventDefault(), { signal });
  list.addEventListener('click', (e: MouseEvent) => {
    const li = (e.target as HTMLElement).closest('[role="option"]');
    if (li) choose(Array.from(list.querySelectorAll('[role="option"]')).indexOf(li));
  }, { signal });
  input.addEventListener('blur', () => close(), { signal });
  // Keep in sync when the select changes programmatically or via binding.
  select.addEventListener('change', () => {
    if (list.hidden) input.value = selectedLabel();
  }, { signal });

  return {
    name: 'dropdown',
    element: select,
    options: options as Record<string, unknown>,
    open,
    close,
    /** Re-read options from the select (call after changing them). */
    refresh: () => {
      input.value = selectedLabel();
      if (!list.hidden) render(input.value);
    },
    destroy: () => {
      controller.abort();
      attrObserver?.disconnect();
      popup.destroy();
      wrapper.remove();
      select.classList.remove('ar-visually-hidden');
      select.removeAttribute('tabindex');
      select.removeAttribute('aria-hidden');
    },
  };
}
