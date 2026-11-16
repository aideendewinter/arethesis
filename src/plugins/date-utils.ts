/**
 * `date-utils` plugin: date input mixins and date validators.
 *
 * All parsing is in the user's local timezone, so `'2026-03-02'` is March 2nd
 * everywhere, not March 1st in the Americas.
 *
 * Mixins:
 * - `datepicker`: native date input with `min`/`max`; emits `datepicker:change` `{ date }`
 * - `daterange`: two inputs (`[data-start]`/`[data-end]` or `name="start"`/`"end"`) that
 *   constrain each other; emits `daterange:change` `{ start, end }`
 *
 * Validators: `futureDate`, `pastDate`, `dateRange {min, max}`, `businessDay`, `minAge {years}`.
 *
 * @module plugins/date-utils
 */

import type { ArethesisPlugin } from './types';
import type { MixinInstance } from '../mixins/types';
import { parseDate, startOfDay, toDateInputValue } from '../utils/dates';
import { emit } from '../mixins/utils';

export interface DatePickerOptions {
  min?: Date | string;
  max?: Date | string;
  onChange?: (date: Date | null) => void;
}

export interface DateRangeOptions {
  startSelector?: string;
  endSelector?: string;
  onChange?: (range: { start: Date | null; end: Date | null }) => void;
}

function datepickerMixin(element: HTMLElement, options: DatePickerOptions = {}): MixinInstance {
  const input = element instanceof HTMLInputElement ? element : element.querySelector('input');
  const controller = new AbortController();
  if (!input) throw new Error('datepicker: no <input> found');
  const previousType = input.type;
  input.type = 'date';
  const min = parseDate(options.min);
  const max = parseDate(options.max);
  if (min) input.min = toDateInputValue(min);
  if (max) input.max = toDateInputValue(max);
  input.addEventListener('change', () => {
    const date = parseDate(input.value);
    options.onChange?.(date);
    emit(input, 'datepicker:change', { date });
  }, { signal: controller.signal });
  return {
    name: 'datepicker',
    element,
    options: options as Record<string, unknown>,
    value: () => parseDate(input.value),
    destroy: () => {
      controller.abort();
      input.type = previousType;
    },
  };
}

function daterangeMixin(element: HTMLElement, options: DateRangeOptions = {}): MixinInstance {
  const start = element.querySelector<HTMLInputElement>(options.startSelector ?? '[data-start], [name="start"]');
  const end = element.querySelector<HTMLInputElement>(options.endSelector ?? '[data-end], [name="end"]');
  if (!start || !end) throw new Error('daterange: start and end inputs are required');
  const controller = new AbortController();
  start.type = 'date';
  end.type = 'date';

  const sync = (): { start: Date | null; end: Date | null } => {
    end.min = start.value || '';
    start.max = end.value || '';
    return { start: parseDate(start.value), end: parseDate(end.value) };
  };
  const changed = (): void => {
    const range = sync();
    options.onChange?.(range);
    emit(element, 'daterange:change', range);
  };
  sync();
  start.addEventListener('change', changed, { signal: controller.signal });
  end.addEventListener('change', changed, { signal: controller.signal });
  return {
    name: 'daterange',
    element,
    options: options as Record<string, unknown>,
    value: () => ({ start: parseDate(start.value), end: parseDate(end.value) }),
    destroy: () => controller.abort(),
  };
}

const today = (): Date => startOfDay(new Date());

export function dateUtilsPlugin(): ArethesisPlugin {
  return {
    name: 'date-utils',
    version: '0.1.0',
    mixins: {
      datepicker: datepickerMixin as never,
      daterange: daterangeMixin as never,
    },
    validators: {
      futureDate: {
        fn: (value, params) => {
          const date = parseDate(value);
          if (!date) return true;
          return params.includeToday === false ? startOfDay(date) > today() : startOfDay(date) >= today();
        },
        message: 'Choose a date in the future',
      },
      pastDate: {
        fn: (value, params) => {
          const date = parseDate(value);
          if (!date) return true;
          return params.includeToday === false ? startOfDay(date) < today() : startOfDay(date) <= today();
        },
        message: 'Choose a date in the past',
      },
      dateRange: {
        fn: (value, params) => {
          const date = parseDate(value);
          if (!date) return true;
          const min = parseDate(params.min);
          const max = parseDate(params.max);
          if (min && startOfDay(date) < startOfDay(min)) return false;
          if (max && startOfDay(date) > startOfDay(max)) return false;
          return true;
        },
        message: 'Choose a date between {min} and {max}',
      },
      businessDay: {
        fn: value => {
          const date = parseDate(value);
          if (!date) return true;
          const day = date.getDay();
          return day !== 0 && day !== 6;
        },
        message: 'Choose a weekday',
      },
      minAge: {
        fn: (value, params) => {
          const date = parseDate(value);
          if (!date) return true;
          const years = Number(params.years ?? 18);
          const limit = today();
          limit.setFullYear(limit.getFullYear() - years);
          return startOfDay(date) <= limit;
        },
        message: 'You must be at least {years} years old',
      },
    },
  };
}
