/**
 * A base class for components that are form controls. They take part in a
 * native `<form>` like an `<input>`: their value is submitted under their
 * `name`, `required` and custom errors show up in `validity`, and a form
 * `reset`, a disabled `<fieldset>` and back/forward restore all work.
 *
 * ```ts
 * class StarRating extends FormAssociatedComponent<number> {
 *   protected get focusTarget() { return this.querySelector('[role=slider]')!; }
 *   protected serialize(value: number) { return String(value); }
 *   protected parse(state: string) { return Number(state); }
 * }
 * ```
 *
 * The component is in the Light DOM, so its inner input must not have a
 * `name` of its own (or the form would submit it twice). Labels that point
 * at the component (`<label for>`) name its `focusTarget`.
 *
 * @module components/form-associated
 */

import { Component } from './component';
import { uniqueId } from '../utils/dom';

export abstract class FormAssociatedComponent<V = string> extends Component {
  static formAssociated = true;

  /** `null` where `attachInternals` isn't supported; the component then works without a form. */
  protected readonly internals: ElementInternals | null =
    typeof (this as Partial<HTMLElement>).attachInternals === 'function' ? this.attachInternals() : null;

  #value: V | undefined;
  #default: V | undefined;
  #customError = '';
  #errorMessage = '';

  /** The element that takes focus and carries the accessible name and `aria-invalid`. */
  protected abstract get focusTarget(): HTMLElement;
  /** How the value is submitted. `null` submits nothing. */
  protected abstract serialize(value: V): string | FormData | null;
  /** Read back a value saved by back/forward restore (the string `serialize` produced). */
  protected abstract parse(state: string): V;
  /** The value when nothing is chosen. */
  protected abstract emptyValue(): V;

  get name(): string {
    return this.getAttribute('name') ?? '';
  }
  set name(value: string) {
    this.setAttribute('name', value);
  }

  get form(): HTMLFormElement | null {
    return this.internals?.form ?? this.closest('form');
  }

  get value(): V {
    return this.#value ?? this.emptyValue();
  }
  set value(next: V) {
    this.#default ??= next;
    this.commitValue(next, { silent: true });
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }
  set disabled(value: boolean) {
    this.toggleAttribute('disabled', value);
  }

  get required(): boolean {
    return this.hasAttribute('required');
  }
  set required(value: boolean) {
    this.toggleAttribute('required', value);
    this.#revalidate();
  }

  get validity(): ValidityState | undefined {
    return this.internals?.validity;
  }

  get validationMessage(): string {
    return this.internals?.validationMessage ?? this.#errorMessage;
  }

  get willValidate(): boolean {
    return this.internals?.willValidate ?? !this.disabled;
  }

  checkValidity(): boolean {
    return this.internals ? this.internals.checkValidity() : !this.#errorMessage;
  }

  reportValidity(): boolean {
    return this.internals ? this.internals.reportValidity() : !this.#errorMessage;
  }

  /** Set (or with `''`, clear) an error of your own, as on a native input. */
  setCustomValidity(message: string): void {
    this.#customError = message;
    this.#revalidate();
  }

  override focus(options?: FocusOptions): void {
    this.focusTarget.focus(options);
  }

  /**
   * Set the value from the user: updates the form value and validity, and
   * fires `input` and `change` (unless `silent`).
   */
  protected commitValue(next: V, { silent = false }: { silent?: boolean } = {}): void {
    this.#value = next;
    const submitted = this.serialize(next);
    this.internals?.setFormValue(submitted, typeof submitted === 'string' ? submitted : null);
    this.#revalidate();
    this.onValueChange(next);
    if (!silent) {
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /** Called whenever the value changes; render it here. */
  protected onValueChange(_value: V): void {}

  /** Whether the value counts as empty for `required`. */
  protected isEmpty(value: V): boolean {
    const submitted = this.serialize(value);
    return submitted === null || submitted === '';
  }

  /** Extra validation of your own; return a message, or `''` if valid. */
  protected validate(_value: V): string {
    return '';
  }

  #revalidate(): void {
    const value = this.value;
    let flags: ValidityStateFlags = {};
    let message: string;
    if (this.#customError) {
      flags = { customError: true };
      message = this.#customError;
    } else if (this.required && this.isEmpty(value)) {
      flags = { valueMissing: true };
      message = 'Please fill in this field.';
    } else {
      message = this.validate(value);
      if (message) flags = { customError: true };
    }
    this.#errorMessage = message;
    this.focusTargetOrNull()?.setAttribute('aria-invalid', String(!!message && this.#touched));
    if (!this.internals) return;
    const anchor = message ? this.focusTargetOrNull() ?? undefined : undefined;
    this.internals.setValidity(flags, message, anchor);
  }

  #touched = false;

  /** Mark as interacted with, so `aria-invalid` shows (call on blur). */
  protected markTouched(): void {
    this.#touched = true;
    this.#revalidate();
  }

  protected focusTargetOrNull(): HTMLElement | null {
    try {
      return this.focusTarget;
    } catch {
      return null;
    }
  }

  override connectedCallback(): Promise<void> {
    const done = super.connectedCallback();
    void this.ready.then(() => {
      this.#linkLabels();
      this.#revalidate();
    });
    return done;
  }

  /** `<label for="this-id">` names the inner control (no `delegatesFocus` in the Light DOM). */
  #linkLabels(): void {
    const labels = Array.from(this.internals?.labels ?? (this.id ? document.querySelectorAll(`label[for="${CSS.escape(this.id)}"]`) : []));
    if (!labels.length) return;
    const target = this.focusTarget;
    const ids = labels.map(label => {
      const el = label as HTMLElement;
      if (!el.id) el.id = uniqueId('ar-label');
      el.addEventListener('click', () => this.focus(), { signal: this.signal });
      return el.id;
    });
    target.setAttribute('aria-labelledby', ids.join(' '));
  }

  // ── Form callbacks ───────────────────────────────────────────────────────

  formResetCallback(): void {
    this.#touched = false;
    this.commitValue(this.#default ?? this.emptyValue(), { silent: true });
  }

  formDisabledCallback(disabled: boolean): void {
    this.toggleAttribute('data-form-disabled', disabled);
    this.onDisabledChange(disabled || this.disabled);
  }

  /** Called when the component, or the fieldset around it, is enabled or disabled. */
  protected onDisabledChange(_disabled: boolean): void {}

  formStateRestoreCallback(state: unknown): void {
    if (typeof state === 'string') this.commitValue(this.parse(state), { silent: true });
  }
}
