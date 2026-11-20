import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Arethesis, getArethesis } from '../../core/arethesis';
import '../elements/calendar';
import type { Calendar } from '../calendar';
import { flush, mockFetch } from '../../../test/helpers';

const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

async function mount(attrs: string) {
  document.body.innerHTML = `<form><a-calendar first-day="1" ${attrs}></a-calendar></form>`;
  await flush();
  const cal = document.querySelector<Calendar>('a-calendar')!;
  const cell = (date: string) => cal.querySelector<HTMLElement>(`td[data-date="${date}"]`)!;
  const focused = () => (document.activeElement as HTMLElement | null)?.dataset.date;
  return { cal, cell, focused, grid: cal.querySelector('table')! };
}

describe('<a-calendar>', () => {
  beforeEach(() => void getArethesis());
  afterEach(() => Arethesis.resetInstance());

  it('draws the month as a labelled grid of six weeks, starting on the week start', async () => {
    const { cal, cell, grid } = await mount('value="2026-11-11" lang="en-US"');
    expect(cal.querySelector('h2')!.textContent).toBe('November 2026');
    expect(grid.getAttribute('role')).toBe('grid');
    expect(grid.getAttribute('aria-labelledby')).toBe(cal.querySelector('h2')!.id);
    expect(grid.querySelectorAll('tbody tr')).toHaveLength(6);
    expect(grid.querySelector('th')!.abbr).toBe('Monday');
    expect(grid.querySelector('td')!.dataset.date).toBe('2026-10-26');
    expect(cell('2026-10-26').classList.contains('is-outside')).toBe(true);
    expect(cell('2026-11-11').getAttribute('aria-selected')).toBe('true');
    expect(cell('2026-11-11').tabIndex).toBe(0);
    expect(cell('2026-11-11').getAttribute('aria-label')).toBe('Wednesday, November 11, 2026');
  });

  it('moves with the keyboard and changes month at the edges', async () => {
    const { cal, cell, focused } = await mount('value="2026-11-30"');
    const months = vi.fn();
    cal.addEventListener('calendar:month', months);
    cell('2026-11-30').focus();
    key(cell('2026-11-30'), 'ArrowRight');
    expect(focused()).toBe('2026-12-01');
    expect(cal.month).toEqual({ year: 2026, month: 11 });
    expect(months).toHaveBeenCalledOnce();
    key(cell('2026-12-01'), 'ArrowLeft');
    key(cell('2026-11-30'), 'ArrowUp');
    expect(focused()).toBe('2026-11-23');
    key(cell('2026-11-23'), 'ArrowDown');
    key(cell('2026-11-30'), 'Home'); // Monday
    expect(focused()).toBe('2026-11-30');
    key(cell('2026-11-30'), 'End');
    expect(focused()).toBe('2026-12-06');
    key(cell('2026-12-06'), 'PageUp');
    expect(focused()).toBe('2026-11-06');
    key(cell('2026-11-06'), 'PageDown', { shiftKey: true });
    expect(focused()).toBe('2027-11-06');
  });

  it('keeps the day of the month where it can (Jan 31 → Feb 28)', async () => {
    const { cell, focused } = await mount('value="2026-01-31"');
    cell('2026-01-31').focus();
    key(cell('2026-01-31'), 'PageDown');
    expect(focused()).toBe('2026-02-28');
  });

  it('picks a date, respects min and max, and is a form control', async () => {
    const { cal, cell } = await mount('name="start" min="2026-11-05" max="2026-11-20" value="2026-11-10"');
    const selected = vi.fn();
    cal.addEventListener('calendar:select', selected);
    expect(cell('2026-11-04').getAttribute('aria-disabled')).toBe('true');
    cell('2026-11-04').click();
    expect(cal.value).toBe('2026-11-10');
    cell('2026-11-12').click();
    expect(cal.value).toBe('2026-11-12');
    expect(selected.mock.calls[0][0].detail).toEqual({ value: '2026-11-12', start: '2026-11-12', end: '2026-11-12' });
    key(cell('2026-11-12'), 'ArrowRight');
    key(cell('2026-11-13'), 'Enter');
    expect(cal.value).toBe('2026-11-13');
    cal.value = '2026-12-25';
    expect(cal.checkValidity()).toBe(false);
    cal.formResetCallback();
    expect(cal.value).toBe('2026-11-10');
  });

  it('selects a range in two picks, either way round, and Escape cancels the first', async () => {
    const { cal, cell } = await mount('name="trip" selection="range" value="2026-11-02/2026-11-04"');
    expect(cal.querySelector('table')!.getAttribute('aria-multiselectable')).toBe('true');
    expect(cell('2026-11-03').classList.contains('is-in-range')).toBe(true);
    expect(cell('2026-11-02').classList.contains('is-range-start')).toBe(true);
    cell('2026-11-20').click();
    expect(cal.value).toBe('2026-11-02/2026-11-04'); // waiting for the second pick
    expect(cell('2026-11-20').getAttribute('aria-selected')).toBe('true');
    cell('2026-11-16').click();
    expect(cal.value).toBe('2026-11-16/2026-11-20');
    cell('2026-11-25').click();
    key(cell('2026-11-25'), 'Escape');
    cell('2026-11-26').click();
    cell('2026-11-27').click();
    expect(cal.value).toBe('2026-11-26/2026-11-27');
  });

  it('shows events from a list and asks for the visible range', async () => {
    const app = getArethesis();
    const fetch = mockFetch(() => ({ body: [
      { id: 1, title: 'Assembly', on: '2026-11-11' },
      { id: 2, title: 'Festival', on: '2026-11-11' },
      ...[3, 4, 5].map(id => ({ id, title: `Talk ${id}`, on: '2026-11-12' })),
      { id: 6, title: 'Extra', on: '2026-11-12' },
    ] }));
    app.http.configure({ baseUrl: '/api', fetch, retry: false });
    app.defineEndpoint('listEvents', { url: '/events', type: 'Event', list: true });
    const { cal, cell } = await mount('value="2026-11-11" selection="none"');
    cal.configure({ list: { type: 'Event', endpoint: 'listEvents' }, dateField: 'on', range: { start: 'from', end: 'to' } });
    await flush(8);
    expect(fetch.calls.at(-1)!.url).toContain('from=2026-10-26');
    expect(fetch.calls.at(-1)!.url).toContain('to=2026-12-06');
    expect(Array.from(cell('2026-11-11').querySelectorAll('li')).map(li => li.textContent)).toEqual(['Assembly', 'Festival']);
    expect(cell('2026-11-12').querySelector('.ar-calendar__more')!.textContent).toBe('+1');
    expect(cell('2026-11-11').getAttribute('aria-label')).toContain('2 events');
    expect(cell('2026-11-11').hasAttribute('aria-selected')).toBe(false);
    const activated = vi.fn();
    cal.addEventListener('calendar:activate', activated);
    cell('2026-11-11').click();
    expect(activated.mock.calls[0][0].detail.items).toHaveLength(2);
    (cal.querySelectorAll('.ar-calendar__nav')[1] as HTMLButtonElement).click();
    await flush(8);
    expect(fetch.calls.at(-1)!.url).toContain('from=2026-11-30');
    cal.showMonth('2027-03-01');
    expect(cal.month).toEqual({ year: 2027, month: 2 });
  });
});
