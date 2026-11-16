/**
 * `<a-form>`: progressive enhancement for a plain `<form>`.
 *
 * Wrap an ordinary form. Validation rules come from native attributes
 * (`required`, `type="email"`, `minlength`, `maxlength`, `min`, `max`,
 * `pattern`) plus `data-rules` (JSON) for anything else, including async
 * validators. Submitting validates every field, shows an accessible error
 * summary, sends the data to an endpoint, maps server-side field errors
 * (HTTP 422 `{ errors: { field: message } }`) back onto the inputs, and writes
 * the result to the store.
 *
 * ```html
 * <a-form data-endpoint="createAccount" data-type="Account">
 *   <form>
 *     <div data-error-summary hidden></div>
 *     <label>Email <input name="email" type="email" required></label>
 *     <label>Username <input name="username" required minlength="3"
 *            data-rules='[{"type":"usernameAvailable"}]'></label>
 *     <button>Create account</button>
 *   </form>
 * </a-form>
 * ```
 *
 * Events: `submit-success` (detail `{ data, result }`), `submit-error` (detail `{ error }`).
 * Without `data-endpoint`, it emits `submit-valid` (cancelable) with the values instead.
 *
 * @module kit/form
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import { getRuntime } from '../components/runtime';
import type { BindConfig, FieldBindConfig, FieldValidationConfig, ValidationRule } from '../binding/types';
import type { BindingHandle } from '../binding/data-binder';
import { HttpError } from '../http/http-error';
import { getArethesis } from '../core/arethesis';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export class Form extends Component {
  #handle: BindingHandle | null = null;
  #form: HTMLFormElement | null = null;
  #submitting = false;

  protected override onConnected(): void {
    this.#form = this.querySelector('form');
    if (!this.#form) {
      console.error('<a-form> needs a <form> child');
      return;
    }
    this.#form.noValidate = true;
    this.#bindForm();
    this.listen(this.#form, 'submit', (e: Event) => {
      e.preventDefault();
      void this.submit();
    });
  }

  /** Values of every named field. */
  values(): Record<string, unknown> {
    return this.#handle?.values() ?? {};
  }

  /** Validate every field; resolves to whether the form is valid. */
  async validate(): Promise<boolean> {
    return (await this.#handle?.validate())?.valid ?? true;
  }

  #controls(): Control[] {
    return Array.from(this.#form?.elements ?? []).filter((el): el is Control =>
      (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) &&
      !!el.name && el.type !== 'submit' && el.type !== 'button');
  }

  #rulesFor(control: Control): ValidationRule[] {
    const rules: ValidationRule[] = [];
    if (control.required) rules.push({ type: 'required' });
    if (control instanceof HTMLInputElement) {
      if (control.type === 'email') rules.push({ type: 'email' });
      if (control.type === 'url') rules.push({ type: 'url' });
      if (control.type === 'tel') rules.push({ type: 'phone' });
      if (control.minLength > 0) rules.push({ type: 'minLength', params: { min: control.minLength } });
      if (control.maxLength > 0 && control.hasAttribute('maxlength')) rules.push({ type: 'maxLength', params: { max: control.maxLength } });
      if (control.min !== '' && control.type !== 'date') rules.push({ type: 'min', params: { min: Number(control.min) } });
      if (control.max !== '' && control.type !== 'date') rules.push({ type: 'max', params: { max: Number(control.max) } });
      if (control.pattern) rules.push({ type: 'pattern', params: { pattern: `^(?:${control.pattern})$` } });
    }
    if (control instanceof HTMLTextAreaElement && control.minLength > 0) rules.push({ type: 'minLength', params: { min: control.minLength } });
    const extra = control.getAttribute('data-rules');
    if (extra) {
      try {
        rules.push(...(JSON.parse(extra) as ValidationRule[]));
      } catch {
        console.error(`<a-form>: invalid data-rules on "${control.name}"`);
      }
    }
    return rules;
  }

  #bindForm(): void {
    const fields: Record<string, FieldBindConfig> = {};
    for (const control of this.#controls()) {
      if (control.name in fields) continue;
      const rules = this.#rulesFor(control);
      const label = control.labels?.[0]?.textContent?.trim().replace(/\s*\*$/, '');
      const validation: FieldValidationConfig | undefined = rules.length ? { rules, label } : undefined;
      fields[control.name] = {
        selector: `[name="${control.name}"]`,
        inputType: control instanceof HTMLInputElement && control.type === 'checkbox' ? 'checkbox'
          : control.hasAttribute('data-rich-text') ? 'rich-text' : undefined,
        validation,
      };
      if (control.required) control.setAttribute('aria-required', 'true');
    }
    const config: BindConfig = {
      fields,
      showErrorSummary: '[data-error-summary]',
      validateOn: ['blur', 'change'],
    };
    const source = this.getAttribute('data-source');
    const initial = source?.includes(':')
      ? getRuntime().store.getData(source.slice(0, source.indexOf(':')), source.slice(source.indexOf(':') + 1)) ?? {}
      : Object.fromEntries(this.#controls().map(c => [c.name, c instanceof HTMLInputElement && c.type === 'checkbox' ? c.checked : c.value]));
    this.#handle = getRuntime().binder.bind(this.#form!, initial, config);
  }

  /** Validate and submit. */
  async submit(): Promise<void> {
    if (this.#submitting || !this.#handle || !this.#form) return;
    const button = this.#form.querySelector<HTMLButtonElement>('button:not([type=button]), [type=submit]');
    this.#submitting = true;
    this.#form.setAttribute('aria-busy', 'true');
    button?.setAttribute('aria-disabled', 'true');
    try {
      const result = await this.#handle.validate();
      if (!result.valid) {
        this.querySelector<HTMLElement>('[data-error-summary] a')?.focus();
        return;
      }
      const data = this.#handle.values();
      const endpoint = this.getAttribute('data-endpoint');
      if (!endpoint) {
        this.emit('submit-valid', { data });
        return;
      }
      await this.#send(endpoint, data);
    } finally {
      this.#submitting = false;
      this.#form.removeAttribute('aria-busy');
      button?.removeAttribute('aria-disabled');
    }
  }

  async #send(endpointName: string, data: Record<string, unknown>): Promise<void> {
    const app = getArethesis();
    const endpoint = app.http.getEndpoint(endpointName);
    if (!endpoint) throw new Error(`<a-form>: unknown endpoint "${endpointName}"`);
    const source = this.getAttribute('data-source');
    const id = source?.slice(source.indexOf(':') + 1);
    try {
      const response = await app.http.request<unknown>({
        url: endpoint.url,
        method: endpoint.method ?? (id ? 'PATCH' : 'POST'),
        params: id ? { id } : {},
        body: data,
        retry: endpoint.retry,
      });
      const result = response === undefined ? undefined : app.http.ingest({ ...endpoint, type: endpoint.type ?? this.getAttribute('data-type') ?? undefined, list: false }, response).data;
      this.emit('submit-success', { data, result });
      if (this.hasAttribute('data-reset')) {
        this.#form!.reset();
        this.#bindForm();
      }
    } catch (error) {
      if (error instanceof HttpError && (error.status === 422 || error.status === 400)) this.#showServerErrors(error.body);
      this.emit('submit-error', { error });
    }
  }

  #showServerErrors(body: unknown): void {
    const errors = (body as { errors?: Record<string, string | string[]> } | undefined)?.errors;
    if (!errors || typeof errors !== 'object') return;
    const { binder } = getRuntime();
    for (const [field, message] of Object.entries(errors)) {
      const control = this.#form!.querySelector(`[name="${field}"]`);
      if (control) binder.showFieldError(control, { field, rule: 'server', message: Array.isArray(message) ? message.join(' ') : message });
    }
    (this.#form!.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus();
  }

  protected override onDisconnected(): void {
    if (this.#form) getRuntime().binder.unbind(this.#form);
    this.#handle = null;
  }
}

defineComponent({ tag: 'a-form' })(Form);
