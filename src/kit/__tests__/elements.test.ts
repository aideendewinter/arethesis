import { describe, expect, it } from 'vitest';
import { Chart } from '../chart';
import { List } from '../list';

describe('kit element modules', () => {
  it('importing a component class does not define its element', () => {
    expect(Chart).toBeTypeOf('function');
    expect(customElements.get('a-chart')).toBeUndefined();
  });

  it('importing arethesis/components/<name> defines only that element', async () => {
    const mod = await import('../elements/list');
    expect(mod.List).toBe(List);
    expect(customElements.get('a-list')).toBe(List);
    expect(customElements.get('a-data-table')).toBeUndefined();
  });
});
