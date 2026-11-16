import { afterEach, describe, expect, it, vi } from 'vitest';
import { Arethesis } from '../../core/arethesis';
import { mixinRegistry } from '../../mixins/registry';
import { registerBuiltInPlugin } from '../plugin-manager';
import type { ArethesisPlugin } from '../types';
import { flush, mockFetch, type RouteHandler } from '../../../test/helpers';

afterEach(() => vi.useRealTimers());

const appWith = (handler: RouteHandler = () => ({ body: {} })) => {
  const fetch = mockFetch(handler);
  const app = new Arethesis();
  app.http.configure({ baseUrl: '/api', fetch, retry: false });
  return { app, fetch };
};

describe('PluginManager', () => {
  it('registers mixins, validators and runs lifecycle hooks in order', async () => {
    const { app } = appWith();
    const log: string[] = [];
    const plugin: ArethesisPlugin<{ greeting: string }> = {
      name: 'demo',
      mixins: { 'demo-mixin': (el, o) => ({ name: 'demo-mixin', element: el, options: o, destroy: () => {} }) },
      validators: {
        isDemo: { fn: v => v === 'demo', message: 'Must be demo' },
        plain: v => Boolean(v),
      },
      install: (_app, options) => {
        log.push(`install:${options.greeting}`);
      },
      beforeInit: config => {
        log.push('before');
        return { ...config, autoConnect: false };
      },
      afterInit: () => {
        log.push('after');
      },
      extendComponent: base => {
        (base.prototype as unknown as Record<string, unknown>).hello = () => 'hi';
      },
      destroy: () => log.push('destroy'),
    };
    app.use({ plugin, options: { greeting: 'hey' } });
    expect(mixinRegistry.has('demo-mixin')).toBe(true);
    expect(app.validation.validateFieldSync('x', 'no', { rules: [{ type: 'isDemo' }] })?.message).toBe('Must be demo');
    expect(app.validation.hasValidator('plain')).toBe(true);
    await app.init({ persistence: false, mixins: false });
    expect(app.config.autoConnect).toBe(false);
    expect(log).toEqual(['install:hey', 'before', 'after']);
    app.use({ name: 'late', afterInit: () => void log.push('late-after') });
    await app.plugins.settle();
    expect(log).toContain('late-after');
    expect(app.plugins.names()).toEqual(['demo', 'late']);
    expect(app.plugins.get('demo')).toBe(plugin);
    expect(app.plugins.has('nope')).toBe(false);
    app.destroy();
    expect(log).toContain('destroy');
  });

  it('runs beforeInit for plugins passed in config (regression)', async () => {
    const { app } = appWith();
    const beforeInit = vi.fn();
    await app.init({ persistence: false, mixins: false, plugins: [{ name: 'from-config', beforeInit }] });
    expect(beforeInit).toHaveBeenCalled();
    app.destroy();
  });

  it('warns about duplicates unless overriding, and loads built-ins by name', () => {
    const { app } = appWith();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app.use({ name: 'dup', validators: { required: () => true } });
    app.use({ name: 'dup' });
    expect(warn).toHaveBeenCalledTimes(2);
    app.use({ name: 'dup', validators: { required: () => true } }, undefined, { override: true });
    expect(app.validation.validateFieldSync('x', '', { rules: [{ type: 'required' }] })).toBeNull();
    app.use('date-utils');
    expect(app.plugins.has('date-utils')).toBe(true);
    expect(() => app.use('nope')).toThrow(/Unknown plugin/);
    registerBuiltInPlugin('custom-builtin', () => ({ name: 'custom-builtin' }));
    app.use({ plugin: 'custom-builtin' });
    expect(app.plugins.has('custom-builtin')).toBe(true);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    app.use({ name: 'bad-install', install: () => Promise.reject(new Error('x')) });
    return app.plugins.settle().then(() => {
      expect(err).toHaveBeenCalled();
      app.destroy();
    });
  });
});

describe('date-utils', () => {
  const { app } = appWith();
  app.use('date-utils');
  const v = (type: string, value: unknown, params?: Record<string, unknown>) => app.validation.validateFieldSync('d', value, { rules: [{ type, params }] });
  const iso = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('validates relative dates in local time (regression: UTC off-by-one)', () => {
    expect(v('futureDate', iso(0))).toBeNull();
    expect(v('futureDate', iso(0), { includeToday: false })).not.toBeNull();
    expect(v('futureDate', iso(-1))).not.toBeNull();
    expect(v('pastDate', iso(0))).toBeNull();
    expect(v('pastDate', iso(1))).not.toBeNull();
    expect(v('pastDate', iso(0), { includeToday: false })).not.toBeNull();
    expect(v('futureDate', '')).toBeNull();
    expect(v('pastDate', '')).toBeNull();
  });

  it('checks business days, ranges and minimum age', () => {
    expect(v('businessDay', '2026-11-16')).toBeNull(); // Monday, in every timezone
    expect(v('businessDay', '2026-11-15')).not.toBeNull(); // Sunday
    expect(v('businessDay', null)).toBeNull();
    expect(v('dateRange', '2026-05-05', { min: '2026-05-01', max: '2026-05-31' })).toBeNull();
    expect(v('dateRange', '2026-06-01', { min: '2026-05-01', max: '2026-05-31' })?.message).toBe('Choose a date between 2026-05-01 and 2026-05-31');
    expect(v('dateRange', '2026-04-01', { min: '2026-05-01' })).not.toBeNull();
    expect(v('dateRange', 'x')).toBeNull();
    expect(v('minAge', '2000-01-01', { years: 18 })).toBeNull();
    expect(v('minAge', iso(-10), { years: 18 })?.message).toBe('You must be at least 18 years old');
    expect(v('minAge', '')).toBeNull();
  });

  it('provides datepicker and daterange mixins', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const changed = vi.fn();
    const m = mixinRegistry.apply(input, 'datepicker', { min: '2026-01-01', max: new Date(2026, 11, 31), onChange: changed })!;
    expect(input.type).toBe('date');
    expect(input.min).toBe('2026-01-01');
    expect(input.max).toBe('2026-12-31');
    input.value = '2026-03-02';
    input.dispatchEvent(new Event('change'));
    expect(changed.mock.calls[0][0].getDate()).toBe(2);
    expect((m.value as () => Date).call(m).getMonth()).toBe(2);
    m.destroy();
    expect(input.type).toBe('text');
    expect(() => mixinRegistry.apply(document.createElement('div'), 'datepicker')).not.toThrow();

    const range = document.createElement('div');
    range.innerHTML = '<input data-start><input data-end>';
    document.body.appendChild(range);
    const rangeChange = vi.fn();
    range.addEventListener('daterange:change', e => rangeChange((e as CustomEvent).detail));
    const r = mixinRegistry.apply(range, 'daterange')!;
    const [start, end] = Array.from(range.querySelectorAll('input'));
    start.value = '2026-05-01';
    start.dispatchEvent(new Event('change'));
    expect(end.min).toBe('2026-05-01');
    end.value = '2026-05-10';
    end.dispatchEvent(new Event('change'));
    expect(start.max).toBe('2026-05-10');
    expect(rangeChange.mock.calls.at(-1)![0].end.getDate()).toBe(10);
    expect((r.value as () => { start: Date }).call(r).start.getDate()).toBe(1);
    r.destroy();
  });
});

describe('async-validators', () => {
  it('debounces per field, cancels stale checks and checks response.ok', async () => {
    vi.useFakeTimers();
    const { app, fetch } = appWith(url => {
      const name = url.searchParams.get('username');
      if (name === 'broken') return { status: 500 };
      return { body: { available: name !== 'taken' } };
    });
    app.use('async-validators', { debounce: 100 });
    const rules = { rules: [{ type: 'usernameAvailable' }] };
    const first = app.validation.validateField('username', 'tak', rules);
    await vi.advanceTimersByTimeAsync(50);
    const second = app.validation.validateField('username', 'taken', rules);
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toBeNull(); // superseded: resolves quietly
    expect((await second)?.message).toBe('That username is taken');
    expect(fetch.calls).toHaveLength(1); // only the latest value was checked
    expect(fetch.calls[0].url).toContain('/api/check-username?username=taken');
    // A failing endpoint doesn't block the form (fail open).
    const broken = app.validation.validateField('username', 'broken', rules);
    await vi.advanceTimersByTimeAsync(100);
    expect(await broken).toBeNull();
    expect(await app.validation.validateField('username', 'ab', rules)).toBeNull(); // too short to check
  });

  it('can fail closed and checks uniqueness, domains and remote rules', async () => {
    const { app } = appWith(url => {
      if (url.pathname.endsWith('/unique')) return { body: { exists: url.searchParams.get('value') === 'dup' } };
      if (url.pathname.endsWith('/check-mx')) return { body: { valid: url.searchParams.get('domain') === 'good.example' } };
      if (url.pathname.endsWith('/remote')) return { body: { valid: false, message: 'Server says no' } };
      return { status: 503 };
    });
    app.use('async-validators', { debounce: 0, failOpen: false });
    const check = (type: string, value: unknown, params: Record<string, unknown> = {}) => app.validation.validateField('f', value, { rules: [{ type, params }] });
    expect((await check('uniqueField', 'dup', { endpoint: '/unique', field: 'email', excludeId: 3 }))?.message).toBe('This email is already in use');
    expect(await check('uniqueField', 'fresh', { endpoint: '/unique', field: 'email' })).toBeNull();
    expect(await check('uniqueField', '')).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await check('uniqueField', 'x')).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect((await check('validEmailDomain', 'alice@example.com', { allowed: ['example.org'] }))?.message).toBe('Use an address at example.org');
    expect(await check('validEmailDomain', 'alice@spam.example', { blocked: ['SPAM.example'] })).not.toBeNull();
    expect(await check('validEmailDomain', 'alice@good.example', { checkMx: true })).toBeNull();
    expect((await check('validEmailDomain', 'alice@bad.example', { checkMx: true }))?.message).toBe('This domain does not accept email');
    expect(await check('validEmailDomain', 'not-an-email')).toBeNull();
    expect(await check('validEmailDomain', 'alice@ok.example')).toBeNull();
    expect((await check('remote', 'x', { endpoint: '/remote' }))?.message).toBe('Server says no');
    expect(await check('remote', 'x')).toBeNull();
    expect((await check('usernameAvailable', 'someone'))?.message).toBe('Could not check availability');
  });
});

describe('rich-text', () => {
  it('turns a div into an accessible, sanitized editor', () => {
    const { app } = appWith();
    app.use('rich-text');
    const host = document.createElement('div');
    host.innerHTML = '<p>Hello <script>x</script><b>world</b></p>';
    document.body.appendChild(host);
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    const changes = vi.fn();
    host.addEventListener('rich-text:change', e => changes((e as CustomEvent).detail));
    const m = mixinRegistry.apply(host, 'rich-text', { label: 'Bio', placeholder: 'Write…', toolbar: ['bold', 'italic', 'h2', 'link', 'bulletList', 'orderedList'] })!;
    expect(host.innerHTML).toBe('<p>Hello <b>world</b></p>');
    expect(host.getAttribute('contenteditable')).toBe('true');
    expect(host.getAttribute('role')).toBe('textbox');
    expect(host.getAttribute('aria-label')).toBe('Bio');
    const toolbar = document.querySelector('[role=toolbar]')!;
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Bold', 'Italic', 'Heading', 'Link', 'Bulleted list', 'Numbered list']);
    expect(buttons.filter(b => b.tabIndex === 0)).toHaveLength(1);
    buttons[0].focus();
    key(toolbar, 'ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    key(toolbar, 'End');
    key(toolbar, 'Home');
    key(toolbar, 'ArrowLeft');
    expect(document.activeElement).toBe(buttons[5]);
    buttons[0].click();
    expect(exec).toHaveBeenCalledWith('bold', false, undefined);
    buttons[2].click();
    expect(exec).toHaveBeenCalledWith('formatBlock', false, '<h2>');
    key(host, 'i', { ctrlKey: true });
    expect(exec).toHaveBeenCalledWith('italic', false, undefined);
    key(host, '7', { ctrlKey: true, shiftKey: true });
    key(host, '8', { ctrlKey: true, shiftKey: true });
    expect(exec).toHaveBeenCalledWith('insertOrderedList', false, undefined);
    expect(exec).toHaveBeenCalledWith('insertUnorderedList', false, undefined);
    host.innerHTML = '<p>Changed <img src=x onerror=alert(1)></p>';
    host.dispatchEvent(new Event('input'));
    expect(changes).toHaveBeenCalledWith({ html: '<p>Changed <img src="x"></p>', text: 'Changed ' });
    expect((m.getHTML as () => string)()).toBe('<p>Changed <img src="x"></p>');
    expect((m.getText as () => string)()).toBe('Changed ');
    (m.setHTML as (h: string) => void)('<a href="javascript:x">bad</a>');
    expect(host.innerHTML).toBe('<a>bad</a>');
    m.destroy();
    expect(host.hasAttribute('contenteditable')).toBe(false);
    expect(document.querySelector('[role=toolbar]')).toBeNull();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it('adds links through an inline form and sanitizes pasted content', () => {
    const { app } = appWith();
    app.use('rich-text');
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    const ta = document.createElement('textarea');
    ta.value = '<p>start</p>';
    document.body.appendChild(ta);
    const m = mixinRegistry.apply(ta, 'rich-text')!;
    const editor = m.editor as HTMLElement;
    expect(ta.hidden).toBe(true);
    expect(editor.innerHTML).toBe('<p>start</p>');
    document.querySelector<HTMLButtonElement>('[data-command=link]')!.click();
    const form = document.querySelector<HTMLFormElement>('.rich-text__link')!;
    expect(form.hidden).toBe(false);
    form.querySelector('input')!.value = 'javascript:alert(1)';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(exec).toHaveBeenCalledWith('unlink', false, undefined);
    (m.command as (c: string) => void)('link');
    form.querySelector('input')!.value = 'https://ok.com';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(exec).toHaveBeenCalledWith('createLink', false, 'https://ok.com');
    (m.command as (c: string) => void)('link');
    key(form.querySelector('input')!, 'Escape');
    expect(form.hidden).toBe(true);
    const paste = new Event('paste', { cancelable: true }) as Event & { clipboardData: unknown };
    paste.clipboardData = { getData: (t: string) => (t === 'text/html' ? '<b onclick="x">bold</b><script>1</script>' : '') };
    editor.dispatchEvent(paste);
    expect(exec).toHaveBeenCalledWith('insertHTML', false, '<b>bold</b>');
    const plain = new Event('paste', { cancelable: true }) as Event & { clipboardData: unknown };
    plain.clipboardData = { getData: (t: string) => (t === 'text/plain' ? 'just text' : '') };
    editor.dispatchEvent(plain);
    expect(exec).toHaveBeenCalledWith('insertText', false, 'just text');
    editor.innerHTML = '<p>synced</p>';
    editor.dispatchEvent(new Event('input'));
    expect(ta.value).toBe('<p>synced</p>');
    m.destroy();
    expect(ta.hidden).toBe(false);
    expect(ta.isConnected).toBe(true);
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it('provides rich-text validators', () => {
    const { app } = appWith();
    app.use('rich-text');
    const v = (type: string, value: unknown, params?: Record<string, unknown>) => app.validation.validateFieldSync('b', value, { rules: [{ type, params }] });
    expect(v('richTextMinLength', '<p>abc</p>', { min: 5 })?.message).toBe('Write at least 5 characters');
    expect(v('richTextMinLength', '<p>abcdef</p>', { min: 5 })).toBeNull();
    expect(v('richTextMinLength', '')).toBeNull();
    expect(v('richTextMaxLength', '<p>abcdef</p>', { max: 3 })).not.toBeNull();
    expect(v('noEmptyParagraphs', '<p>a</p><p><br></p>')).not.toBeNull();
    expect(v('noEmptyParagraphs', '<p>a</p>')).toBeNull();
  });
});

function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}
void flush;
