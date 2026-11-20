/**
 * `<a-calendar>`: a month you can move through and pick dates from (the
 * WAI-ARIA date grid), optionally showing a list of events.
 *
 * ```html
 * <a-calendar name="start" min="2026-01-01" selection="single"></a-calendar>
 * <a-calendar name="trip" selection="range" value="2026-11-02/2026-11-06"></a-calendar>
 * ```
 *
 * ```ts
 * calendar.configure({
 *   list: { type: 'Event', endpoint: 'listEvents' },
 *   dateField: 'startsAt',
 *   label: e => e.title,
 *   range: { start: 'from', end: 'to' },  // filters sent when the month changes
 * });
 * ```
 *
 * Keys: arrows move a day or a week, Home/End go to the start or end of the
 * week, Page Up/Down change the month (with Shift, the year), Enter or Space
 * picks. The month's name is announced as it changes.
 *
 * It's a form control: a single date submits as `YYYY-MM-DD`; a range submits
 * `name[start]` and `name[end]` (its `value` is `start/end`).
 *
 * Events: `calendar:select` (`{ value, start, end }`), `calendar:month`
 * (`{ year, month }`), `calendar:activate` (`{ date, items }`) for a day's events.
 *
 * @module components/calendar
 */

import { FormAssociatedComponent } from '../components/form-associated';
import { defineComponent } from '../components/decorators';
import { getRuntime } from '../components/runtime';
import type { ListView, ListViewConfig } from '../data/types';
import { parseDate, toDateInputValue } from '../utils/dates';
import { getPath } from '../utils/path';
import { uniqueId } from '../utils/dom';

export interface CalendarConfig<T = Record<string, unknown>> {
  /** Events to show on their days. */
  list?: ListView | ListViewConfig;
  /** The field with each item's date. @default 'date' */
  dateField?: string;
  /** Each item's text in a day. @default its `title` or `name` */
  label?: (item: T) => string;
  /** Filter names for the visible range, updated as the month changes (dates as `YYYY-MM-DD`). */
  range?: { start: string; end: string };
  /** Dates that can't be picked. */
  isDisabled?: (date: Date) => boolean;
}

type Selection = 'none' | 'single' | 'range';

const iso = toDateInputValue;
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Move by months, keeping the day where the month has it (Jan 31 + 1 month = Feb 28/29). */
function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
}

export class Calendar extends FormAssociatedComponent<string> {
  #config: CalendarConfig = {};
  #grid: HTMLTableElement | null = null;
  #title: HTMLElement | null = null;
  #focused = new Date();
  #view: ListView | null = null;
  #offs: Array<() => void> = [];
  #pendingStart: Date | null = null;

  static get observedAttributes(): string[] {
    return ['min', 'max', 'selection', 'first-day'];
  }

  attributeChangedCallback(): void {
    if (this.#grid) this.#render();
  }

  /** Show events from a list, and how to read them. */
  configure<T>(config: CalendarConfig<T>): void {
    this.#config = config as unknown as CalendarConfig;
    for (const off of this.#offs.splice(0)) off();
    this.#view = null;
    if (config.list) {
      const { listViews } = getRuntime();
      this.#view = 'ids' in config.list ? config.list : listViews.getOrCreate(config.list);
      this.#offs.push(listViews.subscribe(this.#view.id, () => this.#render()));
      this.#offs.push(getRuntime().store.subscribeToType(this.#view.type, () => this.#render()));
      this.#loadRange();
    }
    if (this.#grid) this.#render();
  }

  /** The month shown: `{ year, month }` (month 0–11). */
  get month(): { year: number; month: number } {
    return { year: this.#focused.getFullYear(), month: this.#focused.getMonth() };
  }

  /** Show the month containing `date`. */
  showMonth(date: Date | string): void {
    const d = typeof date === 'string' ? parseDate(date) : date;
    if (d) this.#moveTo(d, false);
  }

  // ── Form control ─────────────────────────────────────────────────────────

  get #selection(): Selection {
    const s = this.getAttribute('selection');
    return s === 'range' || s === 'none' ? s : 'single';
  }

  protected get focusTarget(): HTMLElement {
    return (this.#grid?.querySelector<HTMLElement>('[tabindex="0"]') ?? this.#grid)!;
  }

  protected serialize(value: string): string | FormData | null {
    if (!value) return null;
    if (this.#selection !== 'range' || !this.name) return value;
    const [start, end] = value.split('/');
    const data = new FormData();
    data.append(`${this.name}[start]`, start);
    data.append(`${this.name}[end]`, end ?? start);
    return data;
  }

  protected parse(state: string): string {
    return state;
  }

  protected emptyValue(): string {
    return '';
  }

  protected override validate(value: string): string {
    for (const part of value ? value.split('/') : []) {
      const d = parseDate(part);
      if (d && this.#outOfRange(d)) return 'Pick a date in the allowed range.';
    }
    return '';
  }

  protected override onValueChange(): void {
    if (this.#grid) this.#render();
  }

  override focus(options?: FocusOptions): void {
    this.focusTarget?.focus(options);
  }

  // ── Building ─────────────────────────────────────────────────────────────

  protected override onConnected(): void {
    if (this.#grid) return;
    const id = this.id || uniqueId('ar-calendar');
    const header = document.createElement('div');
    header.className = 'ar-calendar__header';
    const prev = this.#navButton('‹', 'Previous month', -1);
    const next = this.#navButton('›', 'Next month', 1);
    const title = document.createElement('h2');
    title.className = 'ar-calendar__title';
    title.id = `${id}-title`;
    title.setAttribute('aria-live', 'polite');
    header.append(prev, title, next);

    const grid = document.createElement('table');
    grid.className = 'ar-calendar__grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-labelledby', title.id);
    if (this.#selection === 'range') grid.setAttribute('aria-multiselectable', 'true');
    grid.addEventListener('keydown', e => this.#onKey(e));
    grid.addEventListener('click', e => {
      const cell = (e.target as Element).closest<HTMLElement>('td[data-date]');
      if (cell) this.#pick(parseDate(cell.dataset.date!)!);
    });
    grid.addEventListener('focusout', () => this.markTouched());

    this.replaceChildren(header, grid);
    this.#grid = grid;
    this.#title = title;
    const initial = this.getAttribute('value') ?? '';
    const first = parseDate(initial.split('/')[0]);
    if (first) this.#focused = first;
    this.value = initial;
    this.#render();
  }

  protected override onDisconnected(): void {
    for (const off of this.#offs.splice(0)) off();
  }

  #navButton(text: string, label: string, months: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ar-calendar__nav';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => this.#moveTo(addMonths(this.#focused, months), false));
    return button;
  }

  #locale(): string {
    return this.closest('[lang]')?.getAttribute('lang') || document.documentElement.lang || 'en-US';
  }

  /** 0 = Sunday … 6 = Saturday. */
  #firstDay(): number {
    const attr = this.getAttribute('first-day');
    if (attr !== null && !isNaN(Number(attr))) return Number(attr) % 7;
    try {
      const locale = new Intl.Locale(this.#locale()) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
      const info = locale.getWeekInfo?.() ?? locale.weekInfo;
      if (info) return info.firstDay % 7;
    } catch {
      /* unknown locale */
    }
    return 0;
  }

  #bound(name: 'min' | 'max'): Date | null {
    return parseDate(this.getAttribute(name));
  }

  #outOfRange(d: Date): boolean {
    const min = this.#bound('min');
    const max = this.#bound('max');
    return (!!min && d < min && !sameDay(d, min)) || (!!max && d > max && !sameDay(d, max));
  }

  #disabled(d: Date): boolean {
    return this.#outOfRange(d) || !!this.#config.isDisabled?.(d);
  }

  #range(): { start: Date | null; end: Date | null } {
    const [a, b] = this.value ? this.value.split('/') : [];
    return { start: parseDate(a), end: parseDate(b ?? a) };
  }

  /** Items from the list, by day (`YYYY-MM-DD`). */
  #items(): Map<string, Array<Record<string, unknown>>> {
    const out = new Map<string, Array<Record<string, unknown>>>();
    if (!this.#view) return out;
    const { store } = getRuntime();
    const field = this.#config.dateField ?? 'date';
    for (const id of this.#view.ids) {
      const data = store.getData<Record<string, unknown>>(this.#view.type, id);
      const d = data ? parseDate(getPath(data, field)) : null;
      if (!d || !data) continue;
      const key = iso(d);
      out.set(key, [...(out.get(key) ?? []), data]);
    }
    return out;
  }

  #render(): void {
    const grid = this.#grid;
    if (!grid) return;
    const locale = this.#locale();
    const year = this.#focused.getFullYear();
    const month = this.#focused.getMonth();
    this.#title!.textContent = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(this.#focused);
    const firstDay = this.#firstDay();
    const first = new Date(year, month, 1);
    const start = addDays(first, -((first.getDay() - firstDay + 7) % 7));
    const today = new Date();
    const { start: selStart, end: selEnd } = this.#range();
    const items = this.#items();
    const selection = this.#selection;
    const dayName = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    const longName = new Intl.DateTimeFormat(locale, { weekday: 'long' });
    const fullDate = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const th = document.createElement('th');
      th.scope = 'col';
      th.abbr = longName.format(d);
      th.textContent = dayName.format(d);
      headRow.append(th);
    }
    head.append(headRow);

    const body = document.createElement('tbody');
    let day = start;
    // Six weeks always, so the grid doesn't jump between months.
    for (let w = 0; w < 6; w++) {
      const tr = document.createElement('tr');
      for (let i = 0; i < 7; i++) {
        const td = document.createElement('td');
        const key = iso(day);
        td.dataset.date = key;
        td.setAttribute('role', 'gridcell');
        td.tabIndex = sameDay(day, this.#focused) ? 0 : -1;
        const num = document.createElement('span');
        num.className = 'ar-calendar__day';
        num.textContent = String(day.getDate());
        td.append(num);
        const label = [fullDate.format(day)];
        if (day.getMonth() !== month) td.classList.add('is-outside');
        if (sameDay(day, today)) {
          td.setAttribute('aria-current', 'date');
          label.push('today');
        }
        if (this.#disabled(day)) td.setAttribute('aria-disabled', 'true');
        if (selection !== 'none') {
          const inRange = !!selStart && !!selEnd && day >= selStart && day <= selEnd;
          const selected = selection === 'single' ? !!selStart && sameDay(day, selStart) : inRange || (!!this.#pendingStart && sameDay(day, this.#pendingStart));
          td.setAttribute('aria-selected', String(selected));
          if (selection === 'range' && inRange) {
            td.classList.add('is-in-range');
            if (sameDay(day, selStart!)) td.classList.add('is-range-start');
            if (sameDay(day, selEnd!)) td.classList.add('is-range-end');
          }
        }
        const dayItems = items.get(key);
        if (dayItems?.length) {
          const list = document.createElement('ul');
          list.className = 'ar-calendar__items';
          for (const item of dayItems.slice(0, 3)) {
            const li = document.createElement('li');
            li.textContent = this.#itemLabel(item);
            list.append(li);
          }
          if (dayItems.length > 3) {
            const more = document.createElement('li');
            more.className = 'ar-calendar__more';
            more.textContent = `+${dayItems.length - 3}`;
            list.append(more);
          }
          td.append(list);
          label.push(`${dayItems.length} ${dayItems.length === 1 ? 'event' : 'events'}`);
        }
        td.setAttribute('aria-label', label.join(', '));
        tr.append(td);
        day = addDays(day, 1);
      }
      body.append(tr);
    }
    const hadFocus = grid.contains(document.activeElement);
    grid.replaceChildren(head, body);
    if (hadFocus) grid.querySelector<HTMLElement>('td[tabindex="0"]')?.focus();
  }

  #itemLabel(item: Record<string, unknown>): string {
    return this.#config.label ? this.#config.label(item) : String(item.title ?? item.name ?? '');
  }

  // ── Interaction ──────────────────────────────────────────────────────────

  #moveTo(date: Date, focus = true): void {
    const monthChanged = date.getMonth() !== this.#focused.getMonth() || date.getFullYear() !== this.#focused.getFullYear();
    this.#focused = date;
    this.#render();
    if (focus) this.#grid?.querySelector<HTMLElement>('td[tabindex="0"]')?.focus();
    if (monthChanged) {
      this.emit('calendar:month', this.month);
      this.#loadRange();
    }
  }

  /** Tell the list which dates are on screen. */
  #loadRange(): void {
    const range = this.#config.range;
    if (!this.#view || !range) return;
    const first = new Date(this.#focused.getFullYear(), this.#focused.getMonth(), 1);
    const start = addDays(first, -((first.getDay() - this.#firstDay() + 7) % 7));
    const filters = { ...this.#view.filters, [range.start]: iso(start), [range.end]: iso(addDays(start, 41)) };
    void getRuntime().listViews.update(this.#view.id, { filters }).catch(error => this.emit('calendar:error', { error }));
  }

  #pick(date: Date): void {
    if (this.#disabled(date)) return;
    this.#moveTo(date);
    const items = this.#items().get(iso(date)) ?? [];
    if (items.length) this.emit('calendar:activate', { date: iso(date), items });
    const selection = this.#selection;
    if (selection === 'none') return;
    let value: string;
    if (selection === 'single') {
      value = iso(date);
    } else if (!this.#pendingStart) {
      // First click of a range.
      this.#pendingStart = date;
      this.#render();
      this.#grid?.querySelector<HTMLElement>('td[tabindex="0"]')?.focus();
      return;
    } else {
      const [a, b] = date < this.#pendingStart ? [date, this.#pendingStart] : [this.#pendingStart, date];
      this.#pendingStart = null;
      value = `${iso(a)}/${iso(b)}`;
    }
    this.commitValue(value);
    const [start, end] = value.split('/');
    this.emit('calendar:select', { value, start, end: end ?? start });
  }

  #onKey(e: KeyboardEvent): void {
    const d = this.#focused;
    let next: Date;
    const offset = (d.getDay() - this.#firstDay() + 7) % 7;
    const rtl = getComputedStyle(this).direction === 'rtl';
    switch (e.key) {
      case 'ArrowRight': next = addDays(d, rtl ? -1 : 1); break;
      case 'ArrowLeft': next = addDays(d, rtl ? 1 : -1); break;
      case 'ArrowDown': next = addDays(d, 7); break;
      case 'ArrowUp': next = addDays(d, -7); break;
      case 'Home': next = addDays(d, -offset); break;
      case 'End': next = addDays(d, 6 - offset); break;
      case 'PageUp': next = addMonths(d, e.shiftKey ? -12 : -1); break;
      case 'PageDown': next = addMonths(d, e.shiftKey ? 12 : 1); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.#pick(d);
        return;
      case 'Escape':
        if (this.#pendingStart) {
          this.#pendingStart = null;
          this.#render();
          this.focus();
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    this.#moveTo(next);
  }
}

/** Define `<a-calendar>` (idempotent). `import 'arethesis/components/calendar'` calls this. */
export function defineCalendar(): void {
  defineComponent({ tag: 'a-calendar' })(Calendar);
}
