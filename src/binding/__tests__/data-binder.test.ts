import { describe, expect, it, vi } from 'vitest';
import { DataBinder, formatRelative, relativeTimes } from '../data-binder';
import { flush } from '../../../test/helpers';

function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('DataBinder display', () => {
  const binder = new DataBinder();

  it('renders text, numbers, dates and booleans', () => {
    const el = mount(`
      <span data-bind="name"></span>
      <span data-bind="salary"></span>
      <span data-bind="ratio"></span>
      <span data-bind="count"></span>
      <span data-bind="born"></span>
      <span data-bind="at"></span>
      <span data-bind="active"></span>
      <span class="nick"></span>
      <span data-bind="missing"></span>`);
    binder.bind(el, { name: 'Alice', salary: 1234.5, ratio: 0.25, count: 1234567, born: '2026-03-02', at: new Date(2026, 0, 5, 14, 7), active: true, nickname: 'A' }, {
      fields: {
        name: {},
        salary: { displayType: 'currency', currency: 'EUR', locale: 'en-US' },
        ratio: { displayType: 'percent', locale: 'en-US' },
        count: { displayType: 'number', locale: 'en-US' },
        born: { displayType: 'date', format: 'DD/MM/YYYY' },
        at: { displayType: 'datetime', format: 'HH:mm [on] D/M' },
        active: { displayType: 'boolean', booleanLabels: ['On', 'Off'] },
        nick: { field: 'nickname', selector: '.nick', format: v => `@${v}` },
        missing: { emptyText: '—' },
      },
    });
    const text = (sel: string) => el.querySelector(sel)!.textContent;
    expect(text('[data-bind=name]')).toBe('Alice');
    expect(text('[data-bind=salary]')).toBe('€1,234.50');
    expect(text('[data-bind=ratio]')).toBe('25%');
    expect(text('[data-bind=count]')).toBe('1,234,567');
    expect(text('[data-bind=born]')).toBe('02/03/2026');
    expect(text('[data-bind=at]')).toBe('14:07 on 5/1');
    expect(text('[data-bind=active]')).toBe('On');
    expect(text('.nick')).toBe('@A');
    expect(text('[data-bind=missing]')).toBe('—');
  });

  it('formats dates with Intl when no pattern is given', () => {
    const b = new DataBinder();
    const d = new Date(2026, 0, 5, 14, 7);
    expect(b.format(d, { displayType: 'date', locale: 'en-US' })).toBe('1/5/2026');
    expect(b.format(d, { displayType: 'time', locale: 'en-US' })).toBe('2:07 PM');
    expect(b.format(d, { displayType: 'datetime', locale: 'en-US' })).toContain('2026');
    expect(b.format('bad', { displayType: 'date', emptyText: '?' })).toBe('?');
    expect(b.format('bad', { displayType: 'number' })).toBe('');
    expect(b.format(['a', 'b'], { displayType: 'tags' })).toBe('a, b');
    expect(b.format(new Date(Date.now() - 3 * 60_000), { displayType: 'relative', locale: 'en-US' })).toBe('3 minutes ago');
    expect(b.format('nope', { displayType: 'relative', emptyText: '-' })).toBe('-');
    expect(formatRelative(new Date(2000), 'en-US', 2000)).toBe('now');
    expect(formatRelative(new Date(0), 'en-US', 2 * 86400_000)).toBe('2 days ago');
  });

  it('sanitizes links and images (regression: javascript: URLs)', () => {
    const el = mount('<a data-bind="site"></a><span data-bind="profile"></span><img data-bind="avatar"><span data-bind="pic"></span><span data-bind="bad"></span>');
    binder.bind(el, { site: 'javascript:alert(1)', profile: 'https://example.com/alice', avatar: 'javascript:alert(1)', pic: 'https://img/1.png', bad: 'javascript:x' }, {
      fields: {
        site: { displayType: 'link' },
        profile: { displayType: 'link', linkText: 'Profile', href: v => `${v}?ref=card` },
        avatar: { displayType: 'image' },
        pic: { displayType: 'image' },
        bad: { displayType: 'link' },
      },
    });
    expect(el.querySelector('a[data-bind=site]')!.hasAttribute('href')).toBe(false);
    expect(el.querySelector('[data-bind=profile] a')!.getAttribute('href')).toBe('https://example.com/alice?ref=card');
    expect(el.querySelector('[data-bind=profile] a')!.textContent).toBe('Profile');
    expect(el.querySelector('img[data-bind=avatar]')!.hasAttribute('src')).toBe(false);
    expect(el.querySelector('[data-bind=pic] img')!.getAttribute('src')).toBe('https://img/1.png');
    expect(el.querySelector('[data-bind=bad] a')).toBeNull();
    expect(el.querySelector('[data-bind=bad]')!.textContent).toBe('javascript:x');
  });

  it('sanitizes html unless trusted', () => {
    const el = mount('<div data-bind="bio"></div><div data-bind="raw"></div>');
    binder.bind(el, { bio: '<b>hi</b><img src=x onerror=alert(1)>', raw: '<i>ok</i>' }, {
      fields: { bio: { displayType: 'html' }, raw: { displayType: 'html', trusted: true } },
    });
    expect(el.querySelector('[data-bind=bio]')!.innerHTML).toBe('<b>hi</b><img src="x">');
    expect(el.querySelector('[data-bind=raw]')!.innerHTML).toBe('<i>ok</i>');
  });

  it('renders badges and tags with DOM nodes, not markup', () => {
    const el = mount('<span data-bind="status"></span><span data-bind="tags"></span><span data-bind="csv"></span>');
    binder.bind(el, { status: '<img src=x onerror=1>', tags: ['a', '<b>'], csv: 'x, y' }, {
      fields: { status: { displayType: 'badge' }, tags: { displayType: 'tags' }, csv: { displayType: 'tags' } },
    });
    expect(el.querySelector('.badge')!.textContent).toBe('<img src=x onerror=1>');
    expect(el.querySelector('img')).toBeNull();
    expect(Array.from(el.querySelectorAll('[data-bind=tags] .tag')).map(t => t.textContent)).toEqual(['a', '<b>']);
    expect(el.querySelectorAll('[data-bind=csv] .tag')).toHaveLength(2);
  });

  it('writes attributes safely and toggles visibility', () => {
    const el = mount('<a data-bind="url"></a><div data-bind="title"></div><div data-bind="click"></div>');
    binder.bind(el, { url: 'javascript:alert(1)', title: 'Hello', click: 'alert(1)' }, {
      fields: {
        url: { attribute: 'href' },
        title: { attribute: 'aria-label', visible: v => v !== 'Hello' },
        click: { attribute: 'onclick' },
      },
    });
    expect(el.querySelector('a')!.hasAttribute('href')).toBe(false);
    expect(el.querySelector('[data-bind=title]')!.getAttribute('aria-label')).toBe('Hello');
    expect((el.querySelector('[data-bind=title]') as HTMLElement).hidden).toBe(true);
    expect(el.querySelector('[data-bind=click]')!.hasAttribute('onclick')).toBe(false);
  });

  it('patches only changed fields', () => {
    const el = mount('<span data-bind="a"></span><span data-bind="b"></span>');
    const format = vi.fn((v: unknown) => String(v));
    const handle = binder.bind(el, { a: 1, b: { deep: 1 } }, { fields: { a: { format }, b: { format: v => JSON.stringify(v) } } });
    handle.update({ a: 1, b: { deep: 1 } });
    expect(format).toHaveBeenCalledTimes(1);
    handle.update({ a: 2, b: { deep: 2 } });
    expect(format).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-bind=b]')!.textContent).toBe('{"deep":2}');
    binder.update(document.createElement('div'), {}); // unbound: no-op
  });
});

describe('DataBinder inputs', () => {
  it('fills inputs of every kind', () => {
    const el = mount(`
      <input data-bind="name"><input type="checkbox" data-bind="ok"><select data-bind="role"><option>a</option><option>b</option></select>
      <select multiple data-bind="langs"><option>en</option><option>fr</option><option>de</option></select>
      <input type="date" data-bind="born"><input type="datetime-local" data-bind="at"><input data-bind="tags"><textarea data-bind="bio"></textarea>
      <input type="number" data-bind="age"><div contenteditable="true" data-bind="rich"></div>`);
    const binder = new DataBinder();
    binder.bind(el, { name: 'Alice', ok: 1, role: 'b', langs: ['en', 'de'], born: '2026-03-02', at: new Date(2026, 0, 5, 9, 7), tags: ['x', 'y'], bio: null, age: 30, rich: '<b>x</b><script>1</script>' }, {
      fields: { name: {}, ok: {}, role: {}, langs: {}, born: {}, at: {}, tags: { inputType: 'tags' }, bio: {}, age: {}, rich: { inputType: 'rich-text' } },
    });
    const q = <T extends Element>(s: string) => el.querySelector<T>(`[data-bind=${s}]`)!;
    expect(q<HTMLInputElement>('name').value).toBe('Alice');
    expect(q<HTMLInputElement>('ok').checked).toBe(true);
    expect(q<HTMLSelectElement>('role').value).toBe('b');
    expect(Array.from(q<HTMLSelectElement>('langs').selectedOptions).map(o => o.value)).toEqual(['en', 'de']);
    expect(q<HTMLInputElement>('born').value).toBe('2026-03-02');
    expect(q<HTMLInputElement>('at').value).toBe('2026-01-05T09:07');
    expect(q<HTMLInputElement>('tags').value).toBe('x, y');
    expect(q<HTMLTextAreaElement>('bio').value).toBe('');
    expect(q('rich').innerHTML).toBe('<b>x</b>');
    expect(binder.values(el)).toEqual({ name: 'Alice', ok: true, role: 'b', langs: ['en', 'de'], born: '2026-03-02', at: '2026-01-05T09:07', tags: ['x', 'y'], bio: '', age: 30, rich: '<b>x</b>' });
  });

  it('handles invalid dates without throwing (regression)', () => {
    const el = mount('<input type="date" data-bind="d"><input type="datetime-local" data-bind="t">');
    new DataBinder().bind(el, { d: 'garbage', t: 'garbage' }, { fields: { d: {}, t: {} } });
    expect(el.querySelector('input')!.value).toBe('');
  });

  it('writes valid two-way changes back and parses values', async () => {
    const el = mount('<input data-bind="name"><input type="number" data-bind="age"><input data-bind="code">');
    const onChange = vi.fn();
    new DataBinder().bind(el, { name: 'a', age: 1, code: 'x' }, {
      fields: {
        name: { twoWay: true },
        age: { twoWay: true, parse: v => Number(v) * 2 },
        code: {},
      },
      onChange,
    });
    const name = el.querySelector<HTMLInputElement>('[data-bind=name]')!;
    name.value = 'Alice';
    name.dispatchEvent(new Event('input'));
    const age = el.querySelector<HTMLInputElement>('[data-bind=age]')!;
    age.value = '21';
    age.dispatchEvent(new Event('change'));
    el.querySelector('[data-bind=code]')!.dispatchEvent(new Event('input'));
    await flush();
    expect(onChange.mock.calls).toEqual([['name', 'Alice'], ['age', 42]]);
  });

  it('does not overwrite a focused two-way input', () => {
    const el = mount('<input data-bind="name">');
    const binder = new DataBinder();
    const handle = binder.bind(el, { name: 'a' }, { fields: { name: { twoWay: true } } });
    const input = el.querySelector('input')!;
    input.focus();
    input.value = 'typing';
    handle.update({ name: 'server' });
    expect(input.value).toBe('typing');
  });

  it('replaces listeners when rebinding (regression)', () => {
    const el = mount('<input data-bind="name">');
    const binder = new DataBinder();
    const first = vi.fn();
    const second = vi.fn();
    binder.bind(el, { name: 'a' }, { fields: { name: { twoWay: true } }, onChange: first });
    binder.bind(el, { name: 'a' }, { fields: { name: { twoWay: true } }, onChange: second });
    const input = el.querySelector('input')!;
    input.value = 'b';
    input.dispatchEvent(new Event('input'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    binder.unbind(el);
    input.dispatchEvent(new Event('input'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(binder.getHandle(el)).toBeUndefined();
  });
});

describe('DataBinder validation', () => {
  const rules = { rules: [{ type: 'required' }, { type: 'email' }] };

  it('validates on blur and change, then on input after an error', async () => {
    vi.useFakeTimers();
    const el = mount('<form><input data-bind="email"></form>');
    const binder = new DataBinder();
    binder.bind(el, { email: '' }, { fields: { email: { twoWay: true, validation: { ...rules, debounce: 50 } } } });
    const input = el.querySelector('input')!;
    input.value = 'nope';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(100);
    expect(input.getAttribute('aria-invalid')).toBeNull(); // not yet: input isn't a trigger
    input.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(0);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const errorId = input.getAttribute('aria-describedby')!;
    expect(document.getElementById(errorId)!.textContent).toBe('Enter a valid email address');
    input.value = 'alice@example.com';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(10);
    expect(input.getAttribute('aria-invalid')).toBe('true'); // debounced
    await vi.advanceTimersByTimeAsync(50);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(document.getElementById(errorId)).toBeNull();
    vi.useRealTimers();
  });

  it('keeps debounce timers per element (regression)', async () => {
    vi.useFakeTimers();
    const el1 = mount('<input data-bind="email">');
    const el2 = mount('<input data-bind="email">');
    const binder = new DataBinder();
    const cfg = { fields: { email: { validation: { ...rules, debounce: 20 } } }, validateOn: ['input' as const] };
    binder.bind(el1, {}, cfg);
    binder.bind(el2, {}, cfg);
    const i1 = el1.querySelector('input')!;
    const i2 = el2.querySelector('input')!;
    i1.value = 'bad';
    i1.dispatchEvent(new Event('input'));
    i2.value = 'bad';
    i2.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(25);
    expect(i1.getAttribute('aria-invalid')).toBe('true');
    expect(i2.getAttribute('aria-invalid')).toBe('true');
    vi.useRealTimers();
  });

  it('ignores stale async results', async () => {
    const el = mount('<input data-bind="name">');
    const binder = new DataBinder();
    let call = 0;
    binder.validationEngine.registerValidator('slowFirst', async v => {
      const n = ++call;
      await new Promise(r => setTimeout(r, n === 1 ? 30 : 1));
      return v === 'good';
    });
    binder.bind(el, {}, { fields: { name: { validation: { rules: [{ type: 'slowFirst' }] } } }, validateOn: ['change'] });
    const input = el.querySelector('input')!;
    input.value = 'bad';
    input.dispatchEvent(new Event('change'));
    input.value = 'good';
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 50));
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('validates everything and renders an accessible summary', async () => {
    const el = mount('<form><div data-error-summary></div><input data-bind="email"><input data-bind="name"><p data-error-for="name"></p><span data-bind="note"></span></form>');
    const binder = new DataBinder();
    const onValidationError = vi.fn();
    const handle = binder.bind(el, { note: '' }, {
      fields: {
        email: { validation: { ...rules, label: 'Email' } },
        name: { validation: { rules: [{ type: 'required' }] } },
        note: { validation: { rules: [{ type: 'required', message: 'Note needed' }] } },
      },
      showErrorSummary: true,
      onValidationError,
    });
    const result = await handle.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.field)).toEqual(['email', 'name', 'note']);
    const summary = el.querySelector<HTMLElement>('[data-error-summary]')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(summary.querySelectorAll('li')).toHaveLength(3);
    expect(summary.querySelector('li')!.textContent).toBe('Email: This field is required');
    expect(el.querySelector('[data-error-for=name]')!.textContent).toBe('This field is required');
    const link = summary.querySelector('a')!;
    link.click();
    expect(document.activeElement).toBe(el.querySelector('[data-bind=email]'));
    expect(onValidationError).toHaveBeenCalled();
    el.querySelector<HTMLInputElement>('[data-bind=email]')!.value = 'alice@example.com';
    el.querySelector<HTMLInputElement>('[data-bind=name]')!.value = 'x';
    handle.update({ note: 'n' });
    expect((await handle.validate()).valid).toBe(true);
    expect(summary.hidden).toBe(true);
    expect((el.querySelector('[data-error-for=name]') as HTMLElement).hidden).toBe(true);
    expect(await new DataBinder().validate(document.createElement('div'))).toEqual({ valid: true, errors: [] });
  });

  it('creates a summary container when none exists', async () => {
    const el = mount('<input data-bind="x">');
    const handle = new DataBinder().bind(el, {}, { fields: { x: { validation: { rules: [{ type: 'required' }] } } }, showErrorSummary: '.summary' });
    await handle.validate();
    expect(el.firstElementChild?.hasAttribute('data-error-summary')).toBe(true);
    expect(handle.values()).toEqual({ x: '' });
  });
});

describe('live relative times', () => {
  const binder = new DataBinder();
  const minutes = (n: number) => n * 60_000;

  it('keeps relative labels current on one shared timer', () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 1, 12, 0, 0) });
    try {
      const el = mount('<time data-bind="at"></time><span data-bind="old"></span>');
      binder.bind(el, { at: new Date(), old: new Date(Date.now() - minutes(90)) }, {
        fields: { at: { displayType: 'relative', locale: 'en-US' }, old: { displayType: 'relative', locale: 'en-US' } },
      });
      const at = el.querySelector('time')!;
      expect(at.textContent).toBe('now');
      expect(at.dateTime).toBe(new Date(2026, 5, 1, 12, 0, 0).toISOString());
      expect(at.title).toBe(new Date(2026, 5, 1, 12, 0, 0).toLocaleString('en-US'));
      expect(relativeTimes.size).toBe(2);
      expect(vi.getTimerCount()).toBe(1); // one timer for all of them

      vi.advanceTimersByTime(30_000);
      expect(at.textContent).toBe('30 seconds ago');
      vi.advanceTimersByTime(minutes(7) + 15_000); // 7¾ minutes old
      expect(at.textContent).toBe('8 minutes ago');
      expect(el.querySelector('span')!.textContent).toBe('2 hours ago');

      // Removed elements are dropped, and the timer stops when nothing is left.
      el.remove();
      vi.advanceTimersByTime(minutes(5));
      expect(relativeTimes.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      relativeTimes.stop();
      vi.useRealTimers();
    }
  });

  it('refreshes rarely for old times, catches up when the tab is shown, and can be turned off', () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 1, 12, 0, 0) });
    try {
      const el = mount('<span data-bind="a" title="Mine"></span><span data-bind="b"></span><span data-bind="c"></span>');
      binder.bind(el, { a: new Date(Date.now() - minutes(3 * 24 * 60)), b: new Date(), c: 'not a date' }, {
        fields: {
          a: { displayType: 'relative', locale: 'en-US' },
          b: { displayType: 'relative', locale: 'en-US', live: false },
          c: { displayType: 'relative', emptyText: '—' },
        },
      });
      const [a, b, c] = Array.from(el.querySelectorAll('span'));
      expect(a.textContent).toBe('3 days ago');
      expect(a.title).toBe('Mine'); // the template's own title is kept
      expect(c.textContent).toBe('—');
      expect(relativeTimes.size).toBe(1); // only "a" is live
      vi.advanceTimersByTime(minutes(59));
      expect(vi.getTimerCount()).toBe(1); // an hourly refresh for a days-old time

      // A hidden tab may have missed updates: catch up when it is shown.
      vi.setSystemTime(new Date(2026, 5, 3, 12, 0, 0));
      document.dispatchEvent(new Event('visibilitychange'));
      expect(a.textContent).toBe('5 days ago');
      expect(b.textContent).toBe('now'); // not live

      // Re-binding to a non-date stops watching it.
      binder.update(el, { a: null, b: null, c: null });
      expect(relativeTimes.size).toBe(0);
    } finally {
      relativeTimes.stop();
      vi.useRealTimers();
    }
  });
});
