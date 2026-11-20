import { describe, expect, it } from 'vitest';
import { computeWindow } from '../virtual-window';

describe('computeWindow', () => {
  const base = { viewport: 300, itemSize: 30, count: 1000, overscan: 2 };

  it('renders what fits on screen plus the overscan', () => {
    expect(computeWindow({ ...base, listTop: 0 })).toEqual({ start: 0, end: 12 });
  });

  it('follows the scroll position', () => {
    expect(computeWindow({ ...base, listTop: -3000 })).toEqual({ start: 98, end: 112 });
  });

  it('accounts for content above the list', () => {
    expect(computeWindow({ ...base, listTop: 150 })).toEqual({ start: 0, end: 7 });
    // Below the fold: just the overscan, ready for the first scroll.
    expect(computeWindow({ ...base, listTop: 600 })).toEqual({ start: 0, end: 2 });
  });

  it('clamps to the list', () => {
    expect(computeWindow({ ...base, listTop: -30_000 })).toEqual({ start: 998, end: 1000 });
    expect(computeWindow({ ...base, count: 0, listTop: 0 })).toEqual({ start: 0, end: 0 });
    expect(computeWindow({ ...base, count: 5, listTop: 0 })).toEqual({ start: 0, end: 5 });
  });
});
