/**
 * `editable`: click-to-edit text.
 *
 * Double-click, Enter or F2 starts editing. Enter saves (Ctrl/Cmd+Enter for
 * textareas), Escape cancels, and leaving the field saves.
 *
 * Events: `editable:start`, `editable:save` (cancelable; detail `{ value, previous }`),
 * `editable:cancel`, `editable:error` (detail `{ error }`).
 *
 * @module mixins/editable
 */

import type { EditableOptions, MixinInstance } from './types';
import { mixinRegistry } from './registry';
import { emit } from './utils';
import { uniqueId } from '../utils/dom';

export function editableMixin(element: HTMLElement, options: EditableOptions = {}): MixinInstance {
  const { type = 'text', placeholder = '', saveOnBlur = true } = options;
  const controller = new AbortController();
  let editing: { input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; previous: string; controller: AbortController; saving: boolean } | null = null;

  if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
  element.classList.add('is-editable');
  element.setAttribute('aria-roledescription', 'editable');

  function createInput(value: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
    let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (type === 'textarea') {
      input = document.createElement('textarea');
    } else if (type === 'select') {
      input = document.createElement('select');
      for (const choice of options.choices ?? []) {
        const opt = document.createElement('option');
        opt.value = typeof choice === 'string' ? choice : choice.value;
        opt.textContent = typeof choice === 'string' ? choice : choice.label;
        input.appendChild(opt);
      }
    } else {
      input = document.createElement('input');
      input.type = type;
      input.placeholder = placeholder;
    }
    input.value = value;
    input.className = 'editable-input';
    input.setAttribute('aria-label', options.label ?? element.getAttribute('aria-label') ?? 'Edit');
    return input;
  }

  function start(): void {
    if (editing) return;
    const previous = element.textContent?.trim() ?? '';
    const input = createInput(previous);
    const local = new AbortController();
    editing = { input, previous, controller: local, saving: false };
    element.classList.add('is-editing');
    element.replaceChildren(input);
    input.focus();
    if ('select' in input && typeof input.select === 'function') input.select();

    // On a closed <select>, arrow keys change the value and fire `change` (on Windows and Linux).
    // That's browsing, not choosing: only a change from the popup or Enter saves.
    let keyboardChange = false;
    input.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      ke.stopPropagation();
      keyboardChange = type === 'select' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(ke.key);
      if (type === 'select' && ke.key.length === 1) keyboardChange = true;
      if (ke.key === 'Escape') {
        ke.preventDefault();
        cancel();
      } else if (ke.key === 'Enter' && (type !== 'textarea' || ke.ctrlKey || ke.metaKey)) {
        ke.preventDefault();
        void save();
      }
    }, { signal: local.signal });
    if (saveOnBlur) input.addEventListener('blur', () => void save(), { signal: local.signal });
    if (type === 'select') {
      input.addEventListener('change', () => {
        if (keyboardChange) keyboardChange = false;
        else void save();
      }, { signal: local.signal });
    }
    emit(element, 'editable:start', { value: previous });
  }

  function finish(text: string, refocus: boolean): void {
    if (!editing) return;
    editing.controller.abort();
    editing = null;
    element.classList.remove('is-editing', 'is-invalid');
    element.removeAttribute('aria-invalid');
    element.textContent = text;
    if (refocus) element.focus();
  }

  function showError(message: string): void {
    if (!editing) return;
    const input = editing.input;
    let errorEl = element.querySelector<HTMLElement>('.editable-error');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'editable-error';
      errorEl.id = uniqueId('editable-error');
      errorEl.setAttribute('role', 'alert');
      element.appendChild(errorEl);
    }
    errorEl.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', errorEl.id);
    element.classList.add('is-invalid');
    input.focus();
  }

  async function save(): Promise<void> {
    if (!editing || editing.saving) return;
    const current = editing;
    const value = current.input.value;
    if (value === current.previous) {
      finish(current.previous, true);
      return;
    }
    if (options.validate) {
      current.saving = true;
      const result = await options.validate(value);
      current.saving = false;
      if (editing !== current) return;
      if (result !== true) {
        showError(typeof result === 'string' ? result : 'Invalid value');
        return;
      }
    }
    if (!emit(element, 'editable:save', { value, previous: current.previous })) {
      finish(current.previous, true);
      return;
    }
    const focused = document.activeElement === current.input;
    finish(value, focused);
    if (options.onSave) {
      element.classList.add('is-saving');
      try {
        await options.onSave(value, element);
      } catch (error) {
        element.textContent = current.previous;
        emit(element, 'editable:error', { error, value });
      } finally {
        element.classList.remove('is-saving');
      }
    }
  }

  function cancel(): void {
    if (!editing) return;
    finish(editing.previous, true);
    options.onCancel?.(element);
    emit(element, 'editable:cancel', {});
  }

  element.addEventListener('dblclick', start, { signal: controller.signal });
  element.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!editing && e.target === element && (e.key === 'Enter' || e.key === 'F2')) {
      e.preventDefault();
      start();
    }
  }, { signal: controller.signal });

  return {
    name: 'editable',
    element,
    options: options as Record<string, unknown>,
    start,
    save,
    cancel,
    isEditing: () => editing !== null,
    destroy: () => {
      if (editing) finish(editing.previous, false);
      controller.abort();
      element.classList.remove('is-editable', 'is-editing', 'is-saving');
      element.removeAttribute('aria-roledescription');
    },
  };
}

mixinRegistry.register('editable', editableMixin);
