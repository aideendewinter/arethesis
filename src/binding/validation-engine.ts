/**
 * ValidationEngine: named validators, sync or async.
 *
 * @example
 * ```ts
 * engine.registerValidator('companyEmail', v => !v || String(v).endsWith('@example.org'),
 *   { message: 'Use your company email' });
 * await engine.validateField('email', 'alice@example.com', { rules: [{ type: 'required' }, { type: 'companyEmail' }] });
 * ```
 *
 * @module binding/validation-engine
 */

import type {
  FieldValidationConfig,
  ValidationError,
  ValidationResult,
  ValidationRule,
  ValidatorContext,
  ValidatorFn,
  ValidatorResult,
} from './types';
import { parseDate } from '../utils/dates';

interface RegisteredValidator {
  fn: ValidatorFn;
  message: string;
}

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

// Linear-time patterns (no overlapping quantifiers).
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const PHONE = /^\+?[\d\s\-().]+$/;

export class ValidationEngine {
  private validators = new Map<string, RegisteredValidator>();

  constructor() {
    this.registerBuiltIns();
  }

  private registerBuiltIns(): void {
    const len = (v: unknown): number => (Array.isArray(v) ? v.length : String(v).length);

    this.registerValidator('required', v => {
      if (typeof v === 'string') return v.trim().length > 0;
      if (typeof v === 'boolean') return v;
      return !isEmpty(v);
    }, { message: 'This field is required' });

    this.registerValidator('email', v => isEmpty(v) || EMAIL.test(String(v)), { message: 'Enter a valid email address' });

    this.registerValidator('url', v => {
      if (isEmpty(v)) return true;
      try {
        const u = new URL(String(v));
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    }, { message: 'Enter a valid URL' });

    this.registerValidator('phone', v => {
      if (isEmpty(v)) return true;
      const s = String(v);
      const digits = s.replace(/\D/g, '').length;
      return PHONE.test(s) && digits >= 7 && digits <= 15;
    }, { message: 'Enter a valid phone number' });

    this.registerValidator('minLength', (v, p) => isEmpty(v) || len(v) >= Number(p.min), { message: 'Must be at least {min} characters' });
    this.registerValidator('maxLength', (v, p) => isEmpty(v) || len(v) <= Number(p.max), { message: 'Must be at most {max} characters' });

    const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
    this.registerValidator('numeric', v => isEmpty(v) || !isNaN(num(v)), { message: 'Must be a number' });
    this.registerValidator('integer', v => isEmpty(v) || Number.isInteger(num(v)), { message: 'Must be a whole number' });
    this.registerValidator('min', (v, p) => isEmpty(v) || (!isNaN(num(v)) && num(v) >= Number(p.min)), { message: 'Must be at least {min}' });
    this.registerValidator('max', (v, p) => isEmpty(v) || (!isNaN(num(v)) && num(v) <= Number(p.max)), { message: 'Must be at most {max}' });
    this.registerValidator('between', (v, p) => isEmpty(v) || (!isNaN(num(v)) && num(v) >= Number(p.min) && num(v) <= Number(p.max)), { message: 'Must be between {min} and {max}' });

    this.registerValidator('pattern', (v, p) => {
      if (isEmpty(v)) return true;
      const re = p.pattern instanceof RegExp ? p.pattern : new RegExp(String(p.pattern), typeof p.flags === 'string' ? p.flags : undefined);
      re.lastIndex = 0;
      return re.test(String(v));
    }, { message: 'Invalid format' });

    this.registerValidator('oneOf', (v, p) => isEmpty(v) || (Array.isArray(p.values) && p.values.includes(v)), { message: 'Choose a valid option' });

    this.registerValidator('equals', (v, p, ctx) => v === ctx.data[String(p.field)], { message: 'Must match {field}' });

    this.registerValidator('date', v => isEmpty(v) || parseDate(v) !== null, { message: 'Enter a valid date' });

    this.registerValidator('custom', (v, p, ctx) => {
      const fn = p.fn as ((value: unknown, ctx: ValidatorContext) => ValidatorResult | Promise<ValidatorResult>) | undefined;
      return fn ? fn(v, ctx) : true;
    }, { message: 'Invalid value' });
  }

  /** Register (or replace) a validator. */
  registerValidator(name: string, fn: ValidatorFn, options: { message?: string } = {}): void {
    this.validators.set(name, { fn, message: options.message ?? 'Invalid value' });
  }

  hasValidator(name: string): boolean {
    return this.validators.has(name);
  }

  /** Change a validator's default message (e.g. for translations). */
  setMessage(name: string, message: string): void {
    const v = this.validators.get(name);
    if (v) v.message = message;
  }

  /** Run a field's rules in order; resolves to the first error or null. */
  async validateField(
    field: string,
    value: unknown,
    config: FieldValidationConfig,
    data: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<ValidationError | null> {
    for (const rule of config.rules) {
      if (rule.when && !rule.when(data)) continue;
      const validator = this.validators.get(rule.type);
      if (!validator) {
        console.warn(`Unknown validator "${rule.type}"`);
        continue;
      }
      let result: ValidatorResult;
      try {
        result = await validator.fn(value, rule.params ?? {}, { field, rule, data, signal });
      } catch (err) {
        if (signal?.aborted) return null;
        result = err instanceof Error ? err.message : 'Validation failed';
      }
      if (signal?.aborted) return null;
      const error = this.toError(field, rule, validator, result, config);
      if (error) return error;
    }
    return null;
  }

  /** Synchronous variant; async validators are skipped with a warning. */
  validateFieldSync(field: string, value: unknown, config: FieldValidationConfig, data: Record<string, unknown> = {}): ValidationError | null {
    for (const rule of config.rules) {
      if (rule.when && !rule.when(data)) continue;
      const validator = this.validators.get(rule.type);
      if (!validator) continue;
      let result: ValidatorResult | Promise<ValidatorResult>;
      try {
        result = validator.fn(value, rule.params ?? {}, { field, rule, data });
      } catch (err) {
        result = err instanceof Error ? err.message : 'Validation failed';
      }
      if (result instanceof Promise) {
        console.warn(`Validator "${rule.type}" is async; use validateField()`);
        continue;
      }
      const error = this.toError(field, rule, validator, result, config);
      if (error) return error;
    }
    return null;
  }

  /** Validate several fields. Errors keep the order of `fields`. */
  async validateAll(data: Record<string, unknown>, fields: Record<string, FieldValidationConfig>): Promise<ValidationResult> {
    const entries = Object.entries(fields);
    const results = await Promise.all(entries.map(([field, config]) => this.validateField(field, data[field], config, data)));
    const errors = results.filter((e): e is ValidationError => e !== null);
    return { valid: errors.length === 0, errors };
  }

  private toError(field: string, rule: ValidationRule, validator: RegisteredValidator, result: ValidatorResult, config: FieldValidationConfig): ValidationError | null {
    let valid: boolean;
    let message: string | undefined;
    if (typeof result === 'boolean') valid = result;
    else if (typeof result === 'string') {
      valid = false;
      message = result;
    } else {
      valid = result.valid;
      message = result.message;
    }
    if (valid) return null;
    return { field, rule: rule.type, message: this.interpolate(rule.message ?? message ?? validator.message, rule, config.label ?? field) };
  }

  private interpolate(message: string, rule: ValidationRule, label: string): string {
    const params: Record<string, unknown> = { label, ...rule.params };
    return message.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
  }
}
