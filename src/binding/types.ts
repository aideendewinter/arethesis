/**
 * Binding and validation types.
 *
 * @module binding/types
 */

/** How a value is displayed in a non-input element. */
export type DisplayType =
  | 'text'
  | 'html'
  | 'date'
  | 'datetime'
  | 'time'
  | 'relative'
  | 'currency'
  | 'number'
  | 'percent'
  | 'boolean'
  | 'image'
  | 'link'
  | 'tag'
  | 'badge'
  | 'tags';

/** How a value is edited in an input element. */
export type InputType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'url'
  | 'tel'
  | 'password'
  | 'number'
  | 'range'
  | 'color'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'toggle'
  | 'tags'
  | 'rich-text';

export interface FieldBindConfig {
  /** Dotted path in the data. Defaults to the field's key in `fields`. */
  field?: string;
  /** Target elements. @default `[data-bind="<key>"]` */
  selector?: string;
  displayType?: DisplayType;
  /** Set when the target is an input; inferred from the element otherwise. */
  inputType?: InputType;
  /**
   * A formatter function, or a date pattern (`'MMM D'` style tokens: `YYYY MM DD HH mm ss`)
   * for `date`/`datetime`/`time` display types.
   */
  format?: string | ((value: unknown, data: unknown) => string);
  /** Convert an input's raw value before it is written back. */
  parse?: (raw: unknown) => unknown;
  /** Write the formatted value to this attribute instead of the content. URLs are sanitized. */
  attribute?: string;
  /** Text shown when the value is empty. */
  emptyText?: string;
  /**
   * For `relative`: keep the text current as time passes ("now" becomes
   * "1 minute ago"). One shared timer serves every field. @default true
   */
  live?: boolean;
  /** Hide the target (via the `hidden` attribute) when this returns false. */
  visible?: (value: unknown, data: unknown) => boolean;
  /** `Intl` locale. @default the document language or 'en-US' */
  locale?: string;
  /** ISO currency code for `currency`. @default 'USD' */
  currency?: string;
  /** Extra `Intl` formatting options. */
  intl?: Intl.NumberFormatOptions & Intl.DateTimeFormatOptions;
  /** Labels for `boolean`. @default ['Yes', 'No'] */
  booleanLabels?: [string, string];
  /** For `html`: skip sanitizing. Only for content you fully trust. */
  trusted?: boolean;
  /** For `link`: text shown instead of the URL. */
  linkText?: string;
  /** For `link`: build the URL from the value, e.g. `v => 'mailto:' + v`. The result is sanitized. */
  href?: (value: unknown, data: unknown) => string;
  /** Write input changes back (see `BindConfig.onChange`). */
  twoWay?: boolean;
  validation?: FieldValidationConfig;
}

export type ValidationTrigger = 'blur' | 'input' | 'change' | 'submit';

export interface BindConfig {
  fields: Record<string, FieldBindConfig>;
  /** Collection bindings: `<template>` id rendered for each item. */
  itemTemplate?: string;
  /** Template rendered when the collection is empty. */
  emptyTemplate?: string;
  /** Template rendered while the first page loads. */
  loadingTemplate?: string;
  /** Template rendered when loading fails (supports `[data-error-message]` and `[data-retry]`). */
  errorTemplate?: string;
  /** Container for collection items. @default `[data-items]`, else the component itself */
  itemsSelector?: string;
  /** Load more items when the end of the collection scrolls into view. */
  infiniteScroll?: boolean | { threshold?: number; root?: 'self' | 'viewport' };
  /**
   * Keep long lists light. `'window'` (or `true`) renders only the items on
   * screen plus `overscan`, with spacers for the rest; items must be one
   * height. `'css'` keeps every item but lets the browser skip rendering
   * off-screen ones (`content-visibility`), so find-in-page and screen readers
   * still see them all; it has no effect on table rows.
   */
  virtualize?: boolean | 'window' | 'css' | VirtualizeOptions;
  /** When to validate. @default ['blur', 'change'] (and on input once a field has shown an error) */
  validateOn?: ValidationTrigger[];
  /** Render a list of errors at `[data-error-summary]` (or a selector) when `validate()` fails. */
  showErrorSummary?: boolean | string;
  onValidationError?: (errors: ValidationError[]) => void;
  /** Called for valid input changes on `twoWay` fields. */
  onChange?: (field: string, value: unknown) => void;
}

export interface ValidationRule {
  /** Validator name: built-in (`required`, `email`, `minLength`, ...) or registered. */
  type: string;
  /** Parameters, e.g. `{ min: 2 }`. Also available as `{min}` in messages. */
  params?: Record<string, unknown>;
  message?: string;
  /** Only run this rule when the predicate is true. */
  when?: (data: Record<string, unknown>) => boolean;
}

export interface ValidatorContext {
  field: string;
  rule: ValidationRule;
  /** All current values of the form/object. */
  data: Record<string, unknown>;
  /** Aborted when a newer validation of the same field starts. */
  signal?: AbortSignal;
}

/** `true`/`false`, an error message, or `{ valid, message }`. May be async. */
export type ValidatorResult = boolean | string | { valid: boolean; message?: string };

export type ValidatorFn = (
  value: unknown,
  params: Record<string, unknown>,
  context: ValidatorContext
) => ValidatorResult | Promise<ValidatorResult>;

export interface FieldValidationConfig {
  rules: ValidationRule[];
  /** Debounce for input-triggered validation, in ms. @default 300 */
  debounce?: number;
  /** Human-readable name used as `{label}` in messages. */
  label?: string;
}

export interface VirtualizeOptions {
  mode?: 'window' | 'css';
  /** Item height in px. @default measured from the first item */
  itemSize?: number;
  /** Items rendered beyond each edge of the screen. @default 8 */
  overscan?: number;
  /**
   * What scrolls: a selector inside the component, `'self'`, or `'viewport'`
   * (the page). @default `'viewport'`
   */
  scroller?: string;
}

export interface ValidationError {
  field: string;
  rule: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
