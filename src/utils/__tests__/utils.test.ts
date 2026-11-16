import { describe, expect, it } from 'vitest';
import { deepEqual, deepMerge, getPath, safeAssign, setPath, stableStringify, isPlainObject } from '../path';
import { formatDatePattern, parseDate, toDateInputValue, toDateTimeInputValue } from '../dates';
import { sanitizeUrl } from '../url';
import { sanitizeHtml, htmlToText } from '../sanitize';
import { computeBackoff, sleep } from '../backoff';
import { Emitter } from '../emitter';
import { camelCase, cssEscape, parseHtml, uniqueId } from '../dom';

describe('path helpers', () => {
  it('reads nested paths', () => {
    expect(getPath({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1);
    expect(getPath({ a: 1 }, '')).toEqual({ a: 1 });
    expect(getPath({ a: null }, 'a.b')).toBeUndefined();
    expect(getPath('str', 'length')).toBeUndefined();
  });

  it('refuses prototype paths', () => {
    expect(getPath({}, '__proto__')).toBeUndefined();
    expect(getPath({}, 'constructor.prototype')).toBeUndefined();
    expect(getPath({}, 'toString')).toBeUndefined();
  });

  it('writes nested paths but not through __proto__', () => {
    const obj: Record<string, unknown> = {};
    expect(setPath(obj, 'a.b.c', 1)).toBe(true);
    expect(obj).toEqual({ a: { b: { c: 1 } } });
    expect(setPath(obj, '__proto__.polluted', 1)).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('deep-merges without prototype pollution', () => {
    const payload = JSON.parse('{"__proto__": {"polluted": true}, "a": {"b": 2}}');
    const merged = deepMerge({ a: { c: 1 } }, payload) as Record<string, unknown>;
    expect(merged).toEqual({ a: { c: 1, b: 2 } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
    expect(deepMerge(1, { a: 1 })).toEqual({ a: 1 });
  });

  it('safeAssign skips forbidden keys', () => {
    const target = safeAssign({}, JSON.parse('{"constructor": 1, "x": 2}'));
    expect(target).toEqual({ x: 2 });
    expect(safeAssign({ a: 1 }, 'nope')).toEqual({ a: 1 });
  });

  it('compares structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual(new Date(1), new Date(1))).toBe(true);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });

  it('stringifies stably', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(new Date())).toBe(false);
  });
});

describe('dates', () => {
  it('parses date-only strings as local dates', () => {
    const d = parseDate('2026-03-02')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(2);
    expect(d.getHours()).toBe(0);
  });

  it('handles other inputs', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate(new Date('invalid'))).toBeNull();
    expect(parseDate(0)!.getTime()).toBe(0);
    expect(parseDate('2026-03-02T10:00:00Z')!.toISOString()).toBe('2026-03-02T10:00:00.000Z');
  });

  it('formats local input values', () => {
    const d = new Date(2026, 0, 5, 9, 7);
    expect(toDateInputValue(d)).toBe('2026-01-05');
    expect(toDateTimeInputValue(d)).toBe('2026-01-05T09:07');
  });

  it('replaces every token occurrence and keeps bracketed text', () => {
    const d = new Date(2026, 0, 5, 14, 7, 9);
    expect(formatDatePattern(d, 'DD/MM/YYYY DD')).toBe('05/01/2026 05');
    expect(formatDatePattern(d, 'h:mm A [at] HH:mm:ss')).toBe('2:07 PM at 14:07:09');
    expect(formatDatePattern(d, 'YY-M-D H hh')).toBe('26-1-5 14 02');
  });
});

describe('sanitizeUrl', () => {
  it('allows safe links', () => {
    for (const url of ['https://a.com', 'http://a.com/x?y', 'mailto:a@b.c', 'tel:+1', '/path', 'relative', '#hash', '?q=1', '//cdn.com/x']) {
      expect(sanitizeUrl(url)).toBe(url);
    }
  });

  it('rejects script URLs, including obfuscated ones', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', 'vbscript:x', 'data:text/html,<script>', '\u0001javascript:x']) {
      expect(sanitizeUrl(url)).toBe('');
    }
  });

  it('applies image rules', () => {
    expect(sanitizeUrl('data:image/png;base64,AAA', 'image')).toBe('data:image/png;base64,AAA');
    expect(sanitizeUrl('data:image/svg+xml;base64,AAA', 'image')).toBe('');
    expect(sanitizeUrl('blob:https://a/b', 'image')).toBe('blob:https://a/b');
    expect(sanitizeUrl('mailto:x', 'image')).toBe('');
    expect(sanitizeUrl(null)).toBe('');
    expect(sanitizeUrl('  ')).toBe('');
  });
});

describe('sanitizeHtml', () => {
  it('keeps allowed markup', () => {
    expect(sanitizeHtml('<p><strong>Hi</strong> <a href="https://x.com">x</a></p>')).toBe('<p><strong>Hi</strong> <a href="https://x.com">x</a></p>');
  });

  it('removes scripts, handlers and dangerous URLs', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)" onclick="x">a</a><iframe src="//evil"></iframe><svg><script>1</script></svg>');
    expect(out).not.toMatch(/onerror|onclick|script|iframe|svg|javascript/i);
    expect(out).toContain('<a>a</a>');
  });

  it('unwraps unknown tags and drops comments', () => {
    expect(sanitizeHtml('<custom-el><b>x</b></custom-el><!-- c -->')).toBe('<b>x</b>');
    expect(sanitizeHtml('<p style="color:red" class="k">t</p>')).toBe('<p class="k">t</p>');
  });

  it('adds rel to target=_blank links and honors options', () => {
    expect(sanitizeHtml('<a href="/x" target="_blank">x</a>')).toBe('<a href="/x" target="_blank" rel="noopener noreferrer">x</a>');
    expect(sanitizeHtml('<p><b>x</b></p>', { allowedTags: ['b'] })).toBe('<b>x</b>');
    expect(sanitizeHtml(null)).toBe('');
    expect(htmlToText('<p>a<b>b</b></p>')).toBe('ab');
    expect(htmlToText(undefined)).toBe('');
  });
});

describe('backoff', () => {
  it('grows exponentially and caps', () => {
    const noJitter = () => 0;
    expect(computeBackoff(0, { baseDelay: 100 }, noJitter)).toBe(100);
    expect(computeBackoff(3, { baseDelay: 100 }, noJitter)).toBe(800);
    expect(computeBackoff(20, { baseDelay: 100, maxDelay: 1000 }, noJitter)).toBe(1000);
    expect(computeBackoff(0, { baseDelay: 100, jitter: 0.5 }, () => 1)).toBe(150);
  });

  it('sleeps and aborts', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
    const c = new AbortController();
    const p = sleep(1000, c.signal);
    c.abort();
    await expect(p).rejects.toThrow();
    await expect(sleep(1, c.signal)).rejects.toThrow();
  });
});

describe('Emitter', () => {
  it('emits, unsubscribes and isolates errors', () => {
    const e = new Emitter<{ x: number }>();
    const seen: number[] = [];
    const off = e.on('x', v => seen.push(v));
    e.once('x', v => seen.push(v * 10));
    e.on('x', () => {
      throw new Error('boom');
    });
    e.emit('x', 1);
    e.emit('x', 2);
    off();
    e.emit('x', 3);
    expect(seen).toEqual([1, 10, 2]);
    e.clear();
  });
});

describe('dom helpers', () => {
  it('escapes, camelCases and parses', () => {
    expect(cssEscape('a"b')).toBe('a\\"b');
    expect(camelCase('tab-behavior')).toBe('tabBehavior');
    expect(uniqueId('x')).toMatch(/^x-/);
    const frag = parseHtml('<b>x</b><script>window.__ran = true</script>');
    expect(frag.querySelector('b')?.textContent).toBe('x');
    expect((window as unknown as Record<string, unknown>).__ran).toBeUndefined();
  });
});
