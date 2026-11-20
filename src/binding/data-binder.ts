/**
 * DataBinder: render data into the DOM, patch only what changed, and wire up
 * validation and two-way editing.
 *
 * Targets are found by `[data-bind="<field>"]` unless a field gives a `selector`.
 * Display values go through safe DOM APIs: `textContent` for text, sanitized
 * URLs for links and images, and sanitized markup for `html`.
 *
 * @example
 * ```ts
 * const handle = binder.bind(card, person, {
 *   fields: {
 *     name: {},
 *     salary: { displayType: 'currency', currency: 'EUR' },
 *     email: { twoWay: true, validation: { rules: [{ type: 'required' }, { type: 'email' }] } },
 *   },
 *   onChange: (field, value) => store.upsert('Person', person.id, { [field]: value }),
 * });
 * handle.update(nextPerson);
 * ```
 *
 * @module binding/data-binder
 */

import type {
  BindConfig,
  FieldBindConfig,
  FieldValidationConfig,
  InputType,
  ValidationError,
  ValidationResult,
  ValidationTrigger,
} from './types';
import { ValidationEngine } from './validation-engine';
import { getPath, deepEqual } from '../utils/path';
import { formatDatePattern, parseDate, toDateInputValue, toDateTimeInputValue } from '../utils/dates';
import { sanitizeUrl } from '../utils/url';
import { sanitizeHtml } from '../utils/sanitize';
import { cssEscape, uniqueId } from '../utils/dom';

/** A form-associated custom element (`static formAssociated = true`), such as `<a-combobox>`. */
interface FormValueElement extends HTMLElement {
  value: string;
  readonly type?: string;
}
type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | FormValueElement;

/** Whether `el` is a form-associated custom element with a value. */
export function isFormAssociated(el: Element): el is FormValueElement {
  return el instanceof HTMLElement && (el.constructor as { formAssociated?: boolean }).formAssociated === true && 'value' in el;
}

interface FieldBinding {
  key: string;
  path: string;
  targets: Element[];
  config: FieldBindConfig;
  lastValue: unknown;
  initialized: boolean;
}

/** A live binding returned by `DataBinder.bind()`. */
export interface BindingHandle {
  /** Patch the DOM with new data (unchanged fields are skipped). */
  update(data: unknown): void;
  /** Validate every field with rules; shows errors and the summary. */
  validate(): Promise<ValidationResult>;
  /** Current values of the bound inputs. */
  values(): Record<string, unknown>;
  /** Remove listeners and timers. */
  unbind(): void;
}

interface BindingState {
  root: Element;
  fields: FieldBinding[];
  config: BindConfig;
  data: unknown;
  controller: AbortController;
  handle: BindingHandle;
}

const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href', 'srcset', 'background', 'ping']);

function isControl(el: Element): el is FormControl {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || isFormAssociated(el);
}

function isEditableHost(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && (el.isContentEditable || el.getAttribute('contenteditable') === 'true');
}

function defaultLocale(): string {
  return (typeof document !== 'undefined' && document.documentElement.lang) || 'en-US';
}

export class DataBinder {
  readonly validationEngine: ValidationEngine;
  private bindings = new WeakMap<Element, BindingState>();
  private timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  private validationRuns = new WeakMap<Element, AbortController>();
  private touched = new WeakSet<Element>();

  constructor(validationEngine?: ValidationEngine) {
    this.validationEngine = validationEngine ?? new ValidationEngine();
  }

  /**
   * Bind data to an element. Rebinding the same element replaces the previous
   * binding (its listeners are removed first).
   */
  bind(element: Element, data: unknown, config: BindConfig): BindingHandle {
    this.unbind(element);
    const controller = new AbortController();
    const fields: FieldBinding[] = [];

    for (const [key, fieldConfig] of Object.entries(config.fields)) {
      const selector = fieldConfig.selector ?? `[data-bind="${cssEscape(key)}"]`;
      const targets = Array.from(element.querySelectorAll(selector));
      if (element.matches?.(selector)) targets.unshift(element);
      fields.push({ key, path: fieldConfig.field ?? key, targets, config: fieldConfig, lastValue: undefined, initialized: false });
    }

    const handle: BindingHandle = {
      update: next => this.update(element, next),
      validate: () => this.validate(element),
      values: () => this.values(element),
      unbind: () => this.unbind(element),
    };
    const state: BindingState = { root: element, fields, config, data, controller, handle };
    this.bindings.set(element, state);

    for (const field of fields) {
      for (const target of field.targets) this.listen(state, field, target);
    }
    this.update(element, data);
    return handle;
  }

  /** The live handle for an element, if bound. */
  getHandle(element: Element): BindingHandle | undefined {
    return this.bindings.get(element)?.handle;
  }

  /** Patch bound targets with new data; unchanged values are skipped. */
  update(element: Element, data: unknown): void {
    const state = this.bindings.get(element);
    if (!state) return;
    state.data = data;
    for (const field of state.fields) {
      const value = getPath(data, field.path);
      if (field.initialized && deepEqual(value, field.lastValue)) continue;
      field.lastValue = value;
      field.initialized = true;
      for (const target of field.targets) {
        // Don't clobber what the user is typing.
        if (target === document.activeElement && (isControl(target) || isEditableHost(target)) && field.config.twoWay) continue;
        this.applyValue(target, value, field.config, data);
      }
    }
  }

  /** Remove listeners, timers and errors for an element. */
  unbind(element: Element): void {
    const state = this.bindings.get(element);
    if (!state) return;
    state.controller.abort();
    for (const field of state.fields) {
      for (const target of field.targets) {
        const t = this.timers.get(target);
        if (t) clearTimeout(t);
        this.validationRuns.get(target)?.abort();
      }
    }
    this.bindings.delete(element);
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /** Write one value to one target. */
  applyValue(target: Element, value: unknown, config: FieldBindConfig, data?: unknown): void {
    if (config.visible) {
      (target as HTMLElement).hidden = !config.visible(value, data);
    }
    if (config.attribute) {
      this.applyAttribute(target, config.attribute, this.format(value, config, data));
      return;
    }
    if (isControl(target)) {
      this.applyToControl(target, value, config);
      return;
    }
    if (config.inputType === 'rich-text' && isEditableHost(target)) {
      target.innerHTML = sanitizeHtml(value);
      return;
    }
    this.applyToDisplay(target, value, config, data);
  }

  private applyAttribute(target: Element, attribute: string, formatted: string): void {
    const name = attribute.toLowerCase();
    if (name.startsWith('on') || name === 'style' && /expression|url\s*\(/i.test(formatted)) return;
    if (URL_ATTRIBUTES.has(name)) {
      const safe = sanitizeUrl(formatted, name === 'href' || name === 'action' || name === 'formaction' || name === 'ping' ? 'link' : 'image');
      if (safe) target.setAttribute(attribute, safe);
      else target.removeAttribute(attribute);
      return;
    }
    target.setAttribute(attribute, formatted);
  }

  /** Format a value for display. */
  format(value: unknown, config: FieldBindConfig, data?: unknown): string {
    if (typeof config.format === 'function') return config.format(value, data);
    if (value === null || value === undefined || value === '') return config.emptyText ?? '';
    const locale = config.locale ?? defaultLocale();
    const type = config.displayType ?? 'text';
    switch (type) {
      case 'date':
      case 'datetime':
      case 'time': {
        const date = parseDate(value);
        if (!date) return config.emptyText ?? '';
        if (typeof config.format === 'string') return formatDatePattern(date, config.format);
        if (type === 'date') return date.toLocaleDateString(locale, config.intl);
        if (type === 'time') return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', ...config.intl });
        return date.toLocaleString(locale, config.intl);
      }
      case 'relative': {
        const date = parseDate(value);
        return date ? formatRelative(date, locale) : config.emptyText ?? '';
      }
      case 'currency':
      case 'number':
      case 'percent': {
        const num = typeof value === 'number' ? value : Number(value);
        if (isNaN(num)) return config.emptyText ?? '';
        const style = type === 'currency' ? 'currency' : type === 'percent' ? 'percent' : 'decimal';
        return new Intl.NumberFormat(locale, { style, currency: config.currency ?? 'USD', ...config.intl }).format(num);
      }
      case 'boolean': {
        const [yes, no] = config.booleanLabels ?? ['Yes', 'No'];
        return value ? yes : no;
      }
      case 'tags':
        return Array.isArray(value) ? value.join(', ') : String(value);
      default:
        return String(value);
    }
  }

  private applyToDisplay(target: Element, value: unknown, config: FieldBindConfig, data: unknown): void {
    const type = config.displayType ?? 'text';
    const formatted = this.format(value, config, data);

    switch (type) {
      case 'html':
        target.innerHTML = config.trusted ? String(value ?? '') : sanitizeHtml(value);
        return;

      case 'image': {
        const src = sanitizeUrl(value, 'image');
        if (target instanceof HTMLImageElement) {
          if (src) target.src = src;
          else target.removeAttribute('src');
          return;
        }
        target.replaceChildren();
        if (src) {
          const img = document.createElement('img');
          img.src = src;
          img.alt = '';
          img.loading = 'lazy';
          target.appendChild(img);
        }
        return;
      }

      case 'link': {
        const href = sanitizeUrl(config.href ? config.href(value, data) : value, 'link');
        const text = config.linkText ?? formatted;
        if (target instanceof HTMLAnchorElement) {
          if (href) target.href = href;
          else target.removeAttribute('href');
          if (config.linkText !== undefined || !target.dataset.keepText) target.textContent = text;
          return;
        }
        target.replaceChildren();
        if (href) {
          const a = document.createElement('a');
          a.href = href;
          a.textContent = text;
          target.appendChild(a);
        } else {
          target.textContent = text;
        }
        return;
      }

      case 'tag':
      case 'badge': {
        target.replaceChildren();
        if (formatted) {
          const span = document.createElement('span');
          span.className = type;
          span.dataset.value = String(value);
          span.textContent = formatted;
          target.appendChild(span);
        }
        return;
      }

      case 'tags': {
        const items = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : String(value).split(',').map(s => s.trim());
        target.replaceChildren(...items.filter(v => v !== '').map(v => {
          const span = document.createElement('span');
          span.className = 'tag';
          span.dataset.value = String(v);
          span.textContent = String(v);
          return span;
        }));
        return;
      }

      case 'relative': {
        target.textContent = formatted;
        const date = typeof config.format === 'function' ? null : parseDate(value);
        if (date) {
          const locale = config.locale ?? defaultLocale();
          if (target instanceof HTMLTimeElement) target.dateTime = date.toISOString();
          // The exact time on hover, unless the template set its own title.
          if (!target.hasAttribute('title') || target.hasAttribute('data-relative-title')) {
            target.setAttribute('title', date.toLocaleString(locale));
            target.setAttribute('data-relative-title', '');
          }
          if (config.live !== false) relativeTimes.watch(target, date, locale);
          else relativeTimes.unwatch(target);
        } else {
          relativeTimes.unwatch(target);
        }
        return;
      }

      default:
        target.textContent = formatted;
    }
  }

  private inputTypeOf(control: FormControl, config: FieldBindConfig): InputType {
    if (config.inputType) return config.inputType;
    if (control instanceof HTMLSelectElement) return control.multiple ? 'multiselect' : 'select';
    if (control instanceof HTMLTextAreaElement) return 'textarea';
    const t = control.type;
    if (t === 'checkbox') return 'checkbox';
    if (t === 'number' || t === 'range') return 'number';
    if (t === 'date') return 'date';
    if (t === 'datetime-local') return 'datetime';
    return 'text';
  }

  private applyToControl(control: FormControl, value: unknown, config: FieldBindConfig): void {
    switch (this.inputTypeOf(control, config)) {
      case 'checkbox':
      case 'toggle':
        (control as HTMLInputElement).checked = Boolean(value);
        return;
      case 'multiselect': {
        const values = Array.isArray(value) ? value.map(String) : [];
        for (const option of Array.from((control as HTMLSelectElement).options)) option.selected = values.includes(option.value);
        return;
      }
      case 'date': {
        const d = parseDate(value);
        control.value = d ? toDateInputValue(d) : '';
        return;
      }
      case 'datetime': {
        const d = parseDate(value);
        control.value = d ? toDateTimeInputValue(d) : '';
        return;
      }
      case 'tags':
        control.value = Array.isArray(value) ? value.join(', ') : String(value ?? '');
        return;
      default:
        control.value = value === null || value === undefined ? '' : String(value);
    }
  }

  /** Read the current value of a bound target. */
  readValue(target: Element, config: FieldBindConfig): unknown {
    let raw: unknown;
    if (isControl(target)) {
      switch (this.inputTypeOf(target, config)) {
        case 'checkbox':
        case 'toggle':
          raw = (target as HTMLInputElement).checked;
          break;
        case 'multiselect':
          raw = Array.from((target as HTMLSelectElement).selectedOptions).map(o => o.value);
          break;
        case 'number':
        case 'range':
          raw = target.value === '' ? null : Number(target.value);
          break;
        case 'tags':
          raw = target.value.split(',').map(s => s.trim()).filter(Boolean);
          break;
        default:
          raw = target.value;
      }
    } else if (isEditableHost(target)) {
      raw = config.inputType === 'rich-text' ? sanitizeHtml(target.innerHTML) : target.textContent;
    } else {
      raw = target.textContent;
    }
    return config.parse ? config.parse(raw) : raw;
  }

  /** Current values of every bound input (by field key). */
  values(element: Element): Record<string, unknown> {
    const state = this.bindings.get(element);
    const out: Record<string, unknown> = {};
    if (!state) return out;
    for (const field of state.fields) {
      const target = field.targets.find(t => isControl(t) || isEditableHost(t));
      out[field.key] = target ? this.readValue(target, field.config) : getPath(state.data, field.path);
    }
    return out;
  }

  // ── Events & validation ──────────────────────────────────────────────────

  private triggers(state: BindingState): Set<ValidationTrigger> {
    return new Set(state.config.validateOn ?? ['blur', 'change']);
  }

  private listen(state: BindingState, field: FieldBinding, target: Element): void {
    const editable = isControl(target) || isEditableHost(target);
    if (!editable) return;
    const { signal } = state.controller;
    const validation = field.config.validation;
    const triggers = this.triggers(state);

    const onEdit = (kind: 'input' | 'change'): void => {
      const value = this.readValue(target, field.config);
      const commit = (): void => {
        if (!field.config.twoWay) return;
        field.lastValue = value;
        state.config.onChange?.(field.path, value);
      };
      if (!validation) {
        commit();
        return;
      }
      const shouldValidate = triggers.has(kind) || (kind === 'input' && this.touched.has(target));
      if (!shouldValidate) {
        // Still commit valid values; validation runs on the next trigger.
        const sync = this.validationEngine.validateFieldSync(field.key, value, validation, this.values(state.root));
        if (!sync) commit();
        return;
      }
      const delay = kind === 'input' ? validation.debounce ?? 300 : 0;
      this.scheduleValidation(state, field, target, delay, valid => {
        if (valid) commit();
      });
    };

    target.addEventListener('input', () => onEdit('input'), { signal });
    target.addEventListener('change', () => onEdit('change'), { signal });
    if (validation && triggers.has('blur')) {
      target.addEventListener('blur', () => {
        this.touched.add(target);
        this.scheduleValidation(state, field, target, 0);
      }, { signal });
    }
  }

  private scheduleValidation(state: BindingState, field: FieldBinding, target: Element, delay: number, done?: (valid: boolean) => void): void {
    const existing = this.timers.get(target);
    if (existing) clearTimeout(existing);
    const run = (): void => {
      this.timers.delete(target);
      void this.validateTarget(state, field, target).then(error => done?.(error === null));
    };
    if (delay > 0) this.timers.set(target, setTimeout(run, delay));
    else run();
  }

  private async validateTarget(state: BindingState, field: FieldBinding, target: Element): Promise<ValidationError | null | undefined> {
    const validation = field.config.validation as FieldValidationConfig;
    this.validationRuns.get(target)?.abort();
    const run = new AbortController();
    this.validationRuns.set(target, run);
    const value = this.readValue(target, field.config);
    target.setAttribute('aria-busy', 'true');
    const error = await this.validationEngine.validateField(field.key, value, validation, this.values(state.root), run.signal);
    if (run.signal.aborted) return undefined; // superseded by a newer run
    target.removeAttribute('aria-busy');
    if (error) {
      this.touched.add(target);
      this.showFieldError(target, error);
    } else {
      this.clearFieldError(target);
    }
    return error;
  }

  /** Validate every field that has rules. */
  async validate(element: Element): Promise<ValidationResult> {
    const state = this.bindings.get(element);
    if (!state) return { valid: true, errors: [] };
    const errors: ValidationError[] = [];
    for (const field of state.fields) {
      if (!field.config.validation) continue;
      const target = field.targets.find(t => isControl(t) || isEditableHost(t));
      if (target) {
        this.touched.add(target);
        const error = await this.validateTarget(state, field, target);
        if (error) errors.push(error);
      } else {
        const error = await this.validationEngine.validateField(field.key, getPath(state.data, field.path), field.config.validation, (state.data ?? {}) as Record<string, unknown>);
        if (error) errors.push(error);
      }
    }
    this.renderSummary(element, state, errors);
    if (errors.length) state.config.onValidationError?.(errors);
    return { valid: errors.length === 0, errors };
  }

  private renderSummary(element: Element, state: BindingState, errors: ValidationError[]): void {
    const option = state.config.showErrorSummary;
    if (!option) return;
    const selector = typeof option === 'string' ? option : '[data-error-summary]';
    let summary = element.querySelector<HTMLElement>(selector);
    if (!summary) {
      summary = document.createElement('div');
      summary.setAttribute('data-error-summary', '');
      element.prepend(summary);
    }
    summary.setAttribute('role', 'alert');
    summary.hidden = errors.length === 0;
    summary.replaceChildren();
    if (!errors.length) return;
    const heading = document.createElement('p');
    heading.className = 'error-summary__title';
    heading.textContent = errors.length === 1 ? 'Please fix 1 error:' : `Please fix ${errors.length} errors:`;
    const list = document.createElement('ul');
    for (const err of errors) {
      const li = document.createElement('li');
      const field = state.fields.find(f => f.key === err.field);
      const label = field?.config.validation?.label;
      // Name the field unless the message already does.
      const text = label && !err.message.toLowerCase().includes(label.toLowerCase()) ? `${label}: ${err.message}` : err.message;
      const target = field?.targets.find(t => isControl(t) || isEditableHost(t)) as HTMLElement | undefined;
      if (target) {
        if (!target.id) target.id = uniqueId('field');
        const a = document.createElement('a');
        a.href = `#${target.id}`;
        a.textContent = text;
        a.addEventListener('click', e => {
          e.preventDefault();
          target.focus();
        });
        li.appendChild(a);
      } else {
        li.textContent = text;
      }
      list.appendChild(li);
    }
    summary.append(heading, list);
  }

  /** Mark a field invalid and show the message next to it. */
  showFieldError(element: Element, error: ValidationError): void {
    element.classList.add('is-invalid');
    element.setAttribute('aria-invalid', 'true');
    const errorEl = this.errorElementFor(element, error.field, true)!;
    errorEl.textContent = error.message;
    errorEl.hidden = false;
  }

  /** Clear a field's error state. */
  clearFieldError(element: Element): void {
    element.classList.remove('is-invalid');
    element.removeAttribute('aria-invalid');
    const errorEl = this.errorElementFor(element, '', false);
    if (errorEl) {
      if (errorEl.hasAttribute('data-generated')) errorEl.remove();
      else {
        errorEl.textContent = '';
        errorEl.hidden = true;
      }
      const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== errorEl.id);
      if (ids.length) element.setAttribute('aria-describedby', ids.join(' '));
      else element.removeAttribute('aria-describedby');
    }
  }

  private errorElementFor(element: Element, field: string, create: boolean): HTMLElement | null {
    const describedBy = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    for (const id of describedBy) {
      const el = element.ownerDocument.getElementById(id);
      if (el?.classList.contains('field-error')) return el;
    }
    const explicit = field ? element.closest('form, [data-form], body')?.querySelector<HTMLElement>(`[data-error-for="${cssEscape(field)}"]`) : null;
    let errorEl = explicit ?? null;
    if (!errorEl) {
      if (!create) return null;
      errorEl = document.createElement('div');
      errorEl.className = 'field-error';
      errorEl.setAttribute('data-generated', '');
      element.insertAdjacentElement('afterend', errorEl);
    }
    errorEl.classList.add('field-error');
    if (!errorEl.id) errorEl.id = uniqueId('error');
    errorEl.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-describedby', [...describedBy, errorEl.id].join(' '));
    return errorEl;
  }
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/**
 * How long a relative time stays accurate enough: refresh often while it is
 * recent ("now", "20 seconds ago"), and rarely once it reads in days.
 */
function relativeRefreshDelay(date: Date, now: number): number {
  const age = Math.abs(now - date.getTime()) / 1000;
  if (age < 60) return 5_000;
  if (age < 3600) return 15_000;
  if (age < 24 * 3600) return 5 * 60_000;
  return 60 * 60_000;
}

/**
 * Keeps every rendered `relative` value current with one shared timer. The
 * timer only runs while there is something to update, waits for the soonest
 * label that can change, drops elements once they leave the document, and
 * catches up as soon as a hidden tab becomes visible again.
 */
export class RelativeTimeTicker {
  private targets = new Map<Element, { date: Date; locale: string }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listening = false;
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') this.tick();
  };

  /** Number of elements being kept current. */
  get size(): number {
    return this.targets.size;
  }

  watch(target: Element, date: Date, locale: string): void {
    this.targets.set(target, { date, locale });
    this.schedule();
  }

  unwatch(target: Element): void {
    if (this.targets.delete(target) && this.targets.size === 0) this.stop();
  }

  /** Re-format every watched element now. */
  tick(now = Date.now()): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const [target, { date, locale }] of this.targets) {
      if (!target.isConnected) {
        this.targets.delete(target);
        continue;
      }
      const text = formatRelative(date, locale, now);
      if (target.textContent !== text) target.textContent = text;
    }
    if (this.targets.size) this.schedule(now);
    else this.stop();
  }

  /** Stop the timer and forget every element. */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.targets.clear();
    if (this.listening) document.removeEventListener('visibilitychange', this.onVisibility);
    this.listening = false;
  }

  private schedule(now = Date.now()): void {
    if (this.timer || this.targets.size === 0) return;
    let delay = Infinity;
    for (const { date } of this.targets.values()) delay = Math.min(delay, relativeRefreshDelay(date, now));
    this.timer = setTimeout(() => this.tick(), delay);
    if (!this.listening && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      this.listening = true;
    }
  }
}

/** The ticker shared by every DataBinder. */
export const relativeTimes = new RelativeTimeTicker();

/** "3 minutes ago", "in 2 days". */
export function formatRelative(date: Date, locale = 'en-US', now = Date.now()): string {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, 'second');
}
