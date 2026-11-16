import { describe, expect, it, vi } from 'vitest';
import { MixinRegistry } from '../registry';
import type { MixinInstance } from '../types';
import { flush } from '../../../test/helpers';

function fake(name: string, log: string[]) {
  return (element: HTMLElement, options: Record<string, unknown>): MixinInstance => {
    log.push(`apply:${name}:${JSON.stringify(options)}`);
    return { name, element, options, destroy: () => log.push(`destroy:${name}`) };
  };
}

describe('MixinRegistry', () => {
  it('applies, dedupes and removes mixins', () => {
    const reg = new MixinRegistry();
    const log: string[] = [];
    reg.register('a', fake('a', log));
    const el = document.createElement('div');
    const instance = reg.apply(el, 'a', { x: 1 });
    expect(reg.apply(el, 'a')).toBe(instance);
    expect(reg.isApplied(el, 'a')).toBe(true);
    expect(reg.get(el, 'a')).toBe(instance);
    expect(el.dataset.mixinsApplied).toBe('a');
    expect(reg.remove(el, 'a')).toBe(true);
    expect(reg.remove(el, 'a')).toBe(false);
    expect(log).toEqual(['apply:a:{"x":1}', 'destroy:a']);
    expect(el.dataset.mixinsApplied).toBeUndefined();
    expect(reg.names()).toEqual(['a']);
  });

  it('handles dependencies, conflicts, unknown names and failures', () => {
    const reg = new MixinRegistry();
    const log: string[] = [];
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    reg.register('base', fake('base', log));
    reg.register('child', { fn: fake('child', log), dependencies: ['base'] });
    reg.register('rival', { fn: fake('rival', log), conflicts: ['child'] });
    reg.register('broken', () => {
      throw new Error('x');
    });
    const el = document.createElement('div');
    reg.apply(el, 'child');
    expect(log).toEqual(['apply:base:{}', 'apply:child:{}']);
    expect(reg.apply(el, 'rival')).toBeNull();
    expect(reg.apply(el, 'missing')).toBeNull();
    expect(reg.apply(el, 'broken')).toBeNull();
    reg.removeAll(el);
    reg.removeAll(document.createElement('div'));
    expect(log).toContain('destroy:child');
    expect(err).toHaveBeenCalledTimes(3);
  });

  it('reads declarative options with kebab-case names and parsed values', () => {
    const reg = new MixinRegistry();
    const el = document.createElement('div');
    el.setAttribute('data-mixin-grid-navigation-tab-behavior', 'cells');
    el.setAttribute('data-mixin-grid-navigation-page-size', '5');
    el.setAttribute('data-mixin-grid-navigation-wrap', '');
    el.setAttribute('data-mixin-grid-navigation-items', '[1,2]');
    el.setAttribute('data-mixin-grid-navigation-bad', '{oops');
    el.setAttribute('data-mixin-grid-navigation-off', 'false');
    el.setAttribute('data-mixin-grid-navigation-none', 'null');
    el.setAttribute('data-mixin-tooltip', '{"placement":"left"}');
    expect(reg.readOptions(el, 'grid-navigation')).toEqual({ tabBehavior: 'cells', pageSize: 5, wrap: true, items: [1, 2], bad: '{oops', off: false, none: null });
    expect(reg.readOptions(el, 'tooltip')).toEqual({ placement: 'left' });
    el.setAttribute('data-mixin-tooltip', '{bad');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(reg.readOptions(el, 'tooltip')).toEqual({});
    expect(err).toHaveBeenCalled();
  });

  it('initializes declaratively and observes added/removed elements', async () => {
    const reg = new MixinRegistry();
    const log: string[] = [];
    reg.register('a', fake('a', log));
    reg.register('b', fake('b', log));
    const root = document.createElement('section');
    root.innerHTML = '<div data-mixin="a, b" data-mixin-a-size="2"></div>';
    document.body.appendChild(root);
    const stop = reg.observe(root);
    expect(log).toEqual(['apply:a:{"size":2}', 'apply:b:{}']);
    const added = document.createElement('p');
    added.setAttribute('data-mixin', 'a');
    root.appendChild(added);
    await flush();
    expect(log).toContain('apply:a:{}');
    added.remove();
    await flush();
    expect(log.filter(l => l === 'destroy:a')).toHaveLength(1);
    stop();
    reg.disconnectObservers();
    reg.init(root.firstElementChild!); // root element itself, already applied
    expect(log.filter(l => l.startsWith('apply:'))).toHaveLength(3);
  });
});
