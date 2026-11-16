import { describe, expect, it, vi } from 'vitest';
import { ValidationEngine } from '../validation-engine';

const engine = new ValidationEngine();
const check = (type: string, value: unknown, params?: Record<string, unknown>, data: Record<string, unknown> = {}) =>
  engine.validateFieldSync('f', value, { rules: [{ type, params }] }, data);

describe('ValidationEngine built-ins', () => {
  it('required', () => {
    expect(check('required', '')).not.toBeNull();
    expect(check('required', '  ')).not.toBeNull();
    expect(check('required', [])).not.toBeNull();
    expect(check('required', null)).not.toBeNull();
    expect(check('required', false)).not.toBeNull();
    expect(check('required', 0)).toBeNull();
    expect(check('required', 'x')).toBeNull();
    expect(check('required', true)).toBeNull();
  });

  it('formats', () => {
    expect(check('email', 'alice@example.com')).toBeNull();
    expect(check('email', 'a@b')).not.toBeNull();
    expect(check('email', '')).toBeNull();
    expect(check('url', 'https://x.com')).toBeNull();
    expect(check('url', 'javascript:alert(1)')).not.toBeNull();
    expect(check('url', 'nope')).not.toBeNull();
    expect(check('phone', '+1 (555) 123-4567')).toBeNull();
    expect(check('phone', '12')).not.toBeNull();
    expect(check('phone', 'abc1234567')).not.toBeNull();
    expect(check('date', '2026-02-30x')).not.toBeNull();
    expect(check('date', '2026-02-03')).toBeNull();
  });

  it('runs the email pattern in linear time on hostile input', () => {
    const start = performance.now();
    check('email', `${'a'.repeat(50_000)}@${'b.'.repeat(50_000)}`);
    check('email', `a@${'a'.repeat(100_000)}`);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('lengths and numbers', () => {
    expect(check('minLength', 'ab', { min: 3 })?.message).toBe('Must be at least 3 characters');
    expect(check('minLength', 'abc', { min: 3 })).toBeNull();
    expect(check('maxLength', [1, 2, 3], { max: 2 })).not.toBeNull();
    expect(check('min', '4', { min: 5 })).not.toBeNull();
    expect(check('min', 'x', { min: 5 })).not.toBeNull();
    expect(check('max', 6, { max: 5 })?.message).toBe('Must be at most 5');
    expect(check('between', 5, { min: 1, max: 10 })).toBeNull();
    expect(check('between', 11, { min: 1, max: 10 })?.message).toBe('Must be between 1 and 10');
    expect(check('integer', 1.5)).not.toBeNull();
    expect(check('numeric', 'x')).not.toBeNull();
    expect(check('min', '', { min: 1 })).toBeNull();
  });

  it('pattern, oneOf, equals, custom', () => {
    expect(check('pattern', 'abc', { pattern: '^a' })).toBeNull();
    expect(check('pattern', 'ABC', { pattern: '^a', flags: 'i' })).toBeNull();
    expect(check('pattern', 'xyz', { pattern: /^a/g })).not.toBeNull();
    expect(check('oneOf', 'b', { values: ['a'] })).not.toBeNull();
    expect(check('equals', 'x', { field: 'password' }, { password: 'x' })).toBeNull();
    expect(check('equals', 'y', { field: 'password' }, { password: 'x' })?.message).toBe('Must match password');
    expect(check('custom', 3, { fn: (v: number) => (v > 5 ? true : 'Too small') })?.message).toBe('Too small');
    expect(check('custom', 3)).toBeNull();
  });
});

describe('ValidationEngine', () => {
  it('stops at the first failing rule and interpolates labels', async () => {
    const e = new ValidationEngine();
    e.registerValidator('even', v => Number(v) % 2 === 0, { message: '{label} must be even' });
    const err = await e.validateField('age', 3, { label: 'Age', rules: [{ type: 'required' }, { type: 'even' }, { type: 'min', params: { min: 100 } }] });
    expect(err).toEqual({ field: 'age', rule: 'even', message: 'Age must be even' });
    expect(await e.validateField('age', 4, { rules: [{ type: 'even', message: 'custom {missing}' }] })).toBeNull();
    expect((await e.validateField('age', 3, { rules: [{ type: 'even', message: 'custom {missing}' }] }))?.message).toBe('custom {missing}');
  });

  it('supports async validators, object results and thrown errors', async () => {
    const e = new ValidationEngine();
    e.registerValidator('slow', async v => ({ valid: v === 'ok', message: 'Not ok' }));
    e.registerValidator('boom', () => {
      throw new Error('exploded');
    });
    expect((await e.validateField('x', 'no', { rules: [{ type: 'slow' }] }))?.message).toBe('Not ok');
    expect((await e.validateField('x', 'no', { rules: [{ type: 'boom' }] }))?.message).toBe('exploded');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(e.validateFieldSync('x', 'no', { rules: [{ type: 'slow' }] })).toBeNull();
    expect(e.validateFieldSync('x', 'no', { rules: [{ type: 'boom' }] })?.message).toBe('exploded');
    expect(await e.validateField('x', 'no', { rules: [{ type: 'unknown' }] })).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('respects `when` and abort signals', async () => {
    const e = new ValidationEngine();
    const rule = { type: 'required', when: (d: Record<string, unknown>) => d.subscribe === true };
    expect(await e.validateField('email', '', { rules: [rule] }, { subscribe: false })).toBeNull();
    expect(await e.validateField('email', '', { rules: [rule] }, { subscribe: true })).not.toBeNull();
    expect(e.validateFieldSync('email', '', { rules: [rule] }, { subscribe: false })).toBeNull();
    const c = new AbortController();
    e.registerValidator('wait', async () => {
      c.abort();
      return false;
    });
    expect(await e.validateField('x', 1, { rules: [{ type: 'wait' }] }, {}, c.signal)).toBeNull();
  });

  it('validates many fields in order and supports message overrides', async () => {
    const e = new ValidationEngine();
    e.setMessage('required', 'Obligatoire');
    const result = await e.validateAll({ a: '', b: 'x', c: '' }, {
      a: { rules: [{ type: 'required' }] },
      b: { rules: [{ type: 'required' }] },
      c: { rules: [{ type: 'required' }] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.map(err => `${err.field}:${err.message}`)).toEqual(['a:Obligatoire', 'c:Obligatoire']);
    expect(e.hasValidator('required')).toBe(true);
    e.setMessage('nope', 'x');
  });
});
