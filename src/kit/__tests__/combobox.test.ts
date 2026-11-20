import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Arethesis, getArethesis } from '../../core/arethesis';
import '../elements/combobox';
import type { Combobox } from '../combobox';
import { flush, mockFetch } from '../../../test/helpers';

const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const type = (input: HTMLInputElement, text: string) => {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

async function mount(html: string) {
  document.body.innerHTML = html;
  await flush();
  const box = document.querySelector<Combobox>('a-combobox')!;
  const input = box.querySelector<HTMLInputElement>('input')!;
  const list = box.querySelector<HTMLUListElement>('[role=listbox]')!;
  const labels = () => Array.from(list.querySelectorAll('[role=option]')).map(li => li.textContent);
  return { box, input, list, labels };
}

const CITIES = `<a-combobox name="city" aria-label="City">
  <option value="ath">Athens</option><option value="spa">Sparta</option><option value="cor" disabled>Corinth</option><option value="the">Thebes</option>
</a-combobox>`;

describe('<a-combobox>', () => {
  beforeEach(() => void getArethesis());
  afterEach(() => Arethesis.resetInstance());

  it('takes its options from the markup and follows the combobox pattern', async () => {
    const { input, list, labels, box } = await mount(CITIES);
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(box.querySelectorAll('option')).toHaveLength(0);
    key(input, 'ArrowDown');
    expect(box.open).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(labels()).toEqual(['Athens', 'Sparta', 'Corinth', 'Thebes']);
    expect(input.getAttribute('aria-activedescendant')).toBe(`${list.id}-0`);
    key(input, 'ArrowDown');
    key(input, 'ArrowDown'); // skips the disabled Corinth
    expect(input.getAttribute('aria-activedescendant')).toBe(`${list.id}-3`);
    key(input, 'ArrowUp');
    expect(input.getAttribute('aria-activedescendant')).toBe(`${list.id}-1`);
  });

  it('filters as you type, highlights matches, and picks with Enter', async () => {
    const { box, input, list, labels } = await mount(CITIES);
    const change = vi.fn();
    const select = vi.fn();
    box.addEventListener('change', change);
    box.addEventListener('combobox:select', select);
    type(input, 'sp');
    expect(labels()).toEqual(['Sparta']);
    expect(list.querySelector('mark')!.textContent).toBe('Sp');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(box.value).toBe('spa');
    expect(input.value).toBe('Sparta');
    expect(box.open).toBe(false);
    expect(change).toHaveBeenCalledOnce();
    expect(select.mock.calls[0][0].detail).toMatchObject({ value: 'spa', label: 'Sparta' });
    type(input, 'zzz');
    expect(list.querySelector('.ar-combobox__empty')!.textContent).toBe('No matches');
  });

  it('picks with a click and restores the label when you leave without picking', async () => {
    const { box, input, list } = await mount(CITIES);
    type(input, 'the');
    (list.querySelector('[role=option]') as HTMLElement).click();
    expect(box.value).toBe('the');
    type(input, 'Ath');
    input.dispatchEvent(new Event('blur'));
    expect(box.value).toBe('the');
    expect(input.value).toBe('Thebes');
    // An exact label is taken on blur.
    type(input, 'athens');
    input.dispatchEvent(new Event('blur'));
    expect(box.value).toBe('ath');
    // Clearing the text clears the value.
    type(input, '');
    input.dispatchEvent(new Event('blur'));
    expect(box.value).toBe('');
  });

  it('closes on Escape and clears on a second Escape', async () => {
    const { box, input } = await mount(CITIES);
    box.value = 'ath';
    key(input, 'ArrowDown');
    key(input, 'Escape');
    expect(box.open).toBe(false);
    expect(box.value).toBe('ath');
    key(input, 'Escape');
    expect(box.value).toBe('');
    expect(input.value).toBe('');
  });

  it('is a form control: required, reset and its label', async () => {
    const { box, input } = await mount(`<form><label for="c">City</label><a-combobox id="c" name="city" required value="spa"><option value="ath">Athens</option><option value="spa">Sparta</option></a-combobox></form>`);
    await flush();
    expect(box.value).toBe('spa');
    expect(input.value).toBe('Sparta');
    expect(box.checkValidity()).toBe(true);
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.getAttribute('aria-labelledby')).toBe(document.querySelector('label')!.id);
    key(input, 'Escape');
    expect(box.checkValidity()).toBe(false);
    box.formResetCallback();
    expect(box.value).toBe('spa');
    box.disabled = true;
    expect(input.disabled).toBe(true);
  });

  it('accepts its own text with allowCustom', async () => {
    const { box, input } = await mount(CITIES);
    box.configure({ allowCustom: true });
    type(input, 'Argos');
    key(input, 'Enter');
    expect(box.value).toBe('Argos');
    type(input, 'sparta');
    input.dispatchEvent(new Event('blur'));
    expect(box.value).toBe('spa');
  });

  it('searches a function, debounced, and drops stale results', async () => {
    const { box, input, labels } = await mount('<a-combobox aria-label="Person"></a-combobox>');
    vi.useFakeTimers();
    try {
      const resolvers: Array<() => void> = [];
      const source = vi.fn((q: string, signal: AbortSignal) => new Promise<Array<Record<string, unknown>>>(resolve => {
        resolvers.push(() => resolve([{ id: 1, name: `${q} One` }, { id: 2, name: `${q} Two` }]));
        void signal;
      }));
      box.configure({ source, debounce: 100 });
      type(input, 'a');
      type(input, 'al');
      await vi.advanceTimersByTimeAsync(100);
      expect(source).toHaveBeenCalledOnce();
      type(input, 'ali');
      await vi.advanceTimersByTimeAsync(100);
      resolvers[1]();
      await vi.advanceTimersByTimeAsync(0);
      resolvers[0](); // the older search finishes last
      await vi.advanceTimersByTimeAsync(0);
      expect(labels()).toEqual(['ali One', 'ali Two']);
      key(input, 'ArrowDown');
      key(input, 'Enter');
      expect(box.value).toBe('1');
      expect(box.label).toBe('ali One');
    } finally {
      vi.useRealTimers();
    }
  });

  it('searches an endpoint', async () => {
    const app = getArethesis();
    const fetch = mockFetch(url => ({ body: [{ id: 7, fullName: `Found ${url.searchParams.get('term')}` }] }));
    app.http.configure({ baseUrl: '/api', fetch, retry: false });
    app.defineEndpoint('searchPeople', { url: '/people/search', list: true });
    const { box, input, labels } = await mount('<a-combobox aria-label="Person"></a-combobox>');
    box.configure({ source: { endpoint: 'searchPeople', param: 'term' }, labelField: 'fullName', debounce: 0 });
    type(input, 'hy');
    await flush(6);
    expect(fetch.calls[0].url).toContain('term=hy');
    expect(labels()).toEqual(['Found hy']);
  });
});

describe('<a-combobox> details', () => {
  beforeEach(() => void getArethesis());
  afterEach(() => Arethesis.resetInstance());

  it('needs minChars before searching, and reports search errors', async () => {
    const { box, input, list } = await mount('<a-combobox aria-label="X"></a-combobox>');
    const errors = vi.fn();
    box.addEventListener('combobox:error', errors);
    box.configure({ source: async () => { throw new Error('down'); }, minChars: 2, debounce: 0 });
    type(input, 'a');
    expect(box.open).toBe(false);
    type(input, 'ab');
    await flush(4);
    expect(errors).toHaveBeenCalled();
    expect(list.querySelector('.ar-combobox__empty')).not.toBeNull();
  });

  it('accepts strings and {value,label} objects from a search', async () => {
    const { box, input, labels } = await mount('<a-combobox aria-label="X"></a-combobox>');
    box.configure({ source: async () => ['plain', { value: 'v', label: 'Labelled' }, { id: 3, title: 'Titled' }], debounce: 0 });
    type(input, 'x');
    await flush(4);
    expect(labels()).toEqual(['plain', 'Labelled', 'Titled']);
    expect(box.options.map(o => o.value)).toEqual(['plain', 'v', '3']);
  });

  it('follows its disabled and placeholder attributes, and closes on Tab', async () => {
    const { box, input } = await mount(CITIES);
    box.setAttribute('placeholder', 'Pick a city');
    expect(input.placeholder).toBe('Pick a city');
    key(input, 'ArrowDown', { altKey: true });
    expect(box.open).toBe(true);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    key(input, 'Tab');
    expect(box.open).toBe(false);
    box.setAttribute('disabled', '');
    expect(input.disabled).toBe(true);
    box.formDisabledCallback(false);
    input.click();
    box.removeAttribute('disabled');
    expect(input.disabled).toBe(false);
    input.click();
    expect(box.open).toBe(true);
  });
});
