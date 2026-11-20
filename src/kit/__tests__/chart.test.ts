import { beforeEach, describe, expect, it } from 'vitest';
import { getArethesis } from '../../core/arethesis';
import '../index';
import { niceTicks, type Chart, type ChartConfig } from '../chart';

const rows = [
  { x: 1, web: 10, api: 4 },
  { x: 2, web: 14, api: 6 },
  { x: 3, web: 9, api: 8 },
];

async function mount(config: ChartConfig): Promise<Chart> {
  const chart = document.createElement('a-chart') as Chart;
  document.body.appendChild(chart);
  await chart.ready;
  chart.configure(config);
  chart.redraw();
  return chart;
}

const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('niceTicks', () => {
  it('picks round steps that cover the range', () => {
    expect(niceTicks(0, 14)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(3, 97, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(-12, 18)).toEqual([-20, -10, 0, 10, 20]);
    expect(niceTicks(5, 5).length).toBeGreaterThan(1);
  });
});

describe('<a-chart>', () => {
  beforeEach(() => void getArethesis());

  it('draws one line per visible series, in series colors, with an end dot', async () => {
    const chart = await mount({ type: 'line', label: 'Traffic', series: [{ key: 'web', label: 'Web' }, { key: 'api', label: 'API' }], data: rows });
    const lines = chart.querySelectorAll('.ar-chart__line');
    expect(lines).toHaveLength(2);
    expect((lines[0] as SVGElement).style.stroke).toBe('var(--ar-chart-1)');
    expect((lines[1] as SVGElement).style.stroke).toBe('var(--ar-chart-2)');
    expect(chart.querySelectorAll('.ar-chart__dot')).toHaveLength(2);
    expect(chart.querySelectorAll('.ar-chart__grid').length).toBeGreaterThan(2);
    const plot = chart.querySelector('.ar-chart__plot')!;
    expect(plot.getAttribute('aria-roledescription')).toBe('chart');
    expect(plot.getAttribute('aria-label')).toContain('Traffic');
  });

  it('hides series from the legend without repainting the others', async () => {
    const chart = await mount({ type: 'area', label: 'Traffic', series: [{ key: 'web', label: 'Web' }, { key: 'api', label: 'API' }], data: rows });
    expect(chart.querySelectorAll('.ar-chart__area')).toHaveLength(2);
    const web = chart.querySelector<HTMLButtonElement>('.ar-chart__key[data-key=web]')!;
    web.click();
    chart.redraw();
    expect(web.getAttribute('aria-pressed')).toBe('false');
    const lines = chart.querySelectorAll<SVGElement>('.ar-chart__line');
    expect(lines).toHaveLength(1);
    expect(lines[0].style.stroke).toBe('var(--ar-chart-2)'); // API keeps its color
    // The last visible series can't be hidden.
    chart.querySelector<HTMLButtonElement>('.ar-chart__key[data-key=api]')!.click();
    chart.redraw();
    expect(chart.querySelectorAll('.ar-chart__line')).toHaveLength(1);
  });

  it('reads out points from the keyboard and keeps a data table', async () => {
    const chart = await mount({ type: 'line', label: 'Traffic', series: [{ key: 'web', label: 'Web' }], data: rows, y: { format: v => `${v} rps` } });
    const plot = chart.querySelector<HTMLElement>('.ar-chart__plot')!;
    plot.dispatchEvent(new FocusEvent('focus'));
    const tip = chart.querySelector<HTMLElement>('.ar-chart__tooltip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('9 rps');
    key(plot, 'ArrowLeft');
    const live = chart.querySelector('[aria-live]')!;
    expect(live.textContent).toBe('2: Web 14 rps');
    key(plot, 'Home');
    expect(live.textContent).toBe('1: Web 10 rps');
    key(plot, 'Escape');
    expect(tip.hidden).toBe(true);
    // A single series has no legend keys, only the table toggle.
    expect(chart.querySelectorAll('.ar-chart__key[data-key]')).toHaveLength(0);
    const table = chart.querySelector('table')!;
    expect(table.querySelector('caption')!.textContent).toBe('Traffic');
    expect(Array.from(table.querySelectorAll('tbody tr')).map(tr => tr.textContent)).toEqual(['110 rps', '214 rps', '39 rps']);
    expect(table.classList.contains('ar-visually-hidden')).toBe(true);
    chart.querySelector<HTMLButtonElement>('.ar-chart__table-toggle')!.click();
    expect(table.classList.contains('ar-visually-hidden')).toBe(false);
  });

  it('streams: push drops the oldest point beyond maxPoints', async () => {
    const chart = await mount({ type: 'line', label: 'Live', series: [{ key: 'web', label: 'Web' }], data: rows, maxPoints: 3 });
    chart.push({ x: 4, web: 20 });
    chart.redraw();
    expect(chart.data.map(r => r.x)).toEqual([2, 3, 4]);
    expect(chart.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('draws bars and stacks with rounded data ends, and ignores unsafe colors', async () => {
    const bars = await mount({ type: 'bar', label: 'Orders', series: [{ key: 'web', label: 'Web', color: 'red;}</style><script>' }, { key: 'api', label: 'API' }], data: rows });
    const paths = bars.querySelectorAll<SVGElement>('.ar-chart__bar');
    expect(paths).toHaveLength(6);
    expect(paths[0].style.fill).toBe('var(--ar-chart-1)');
    expect(bars.querySelector('script')).toBeNull();
    const stack = await mount({ type: 'stacked-bar', label: 'Orders', series: [{ key: 'web', label: 'Web' }, { key: 'api', label: 'API' }], data: rows });
    expect(stack.querySelectorAll('.ar-chart__bar')).toHaveLength(6);
  });

  it('sparklines are images with just the line', async () => {
    const spark = await mount({ type: 'line', label: 'Revenue, last hour', series: [{ key: 'web', label: 'Revenue' }], data: rows, sparkline: true });
    const plot = spark.querySelector('.ar-chart__plot')!;
    expect(plot.getAttribute('role')).toBe('img');
    expect(plot.hasAttribute('tabindex')).toBe(false);
    expect(spark.querySelectorAll('.ar-chart__tick')).toHaveLength(0);
    expect(spark.querySelector('.ar-chart__legend')!.children).toHaveLength(0);
  });
});

describe('<a-chart> axes and pointer', () => {
  beforeEach(() => void getArethesis());

  it('formats time and custom x values, honours y bounds, and draws negative bars', async () => {
    const t0 = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const time = await mount({ type: 'line', label: 'T', series: [{ key: 'v', label: 'V' }], x: { type: 'time' }, data: [{ x: t0, v: 1 }, { x: new Date(t0 + 60_000), v: 2 }], y: { min: 0, max: 10 } });
    expect(time.querySelectorAll('.ar-chart__tick').length).toBeGreaterThan(2);
    expect(time.querySelector('tbody th')!.textContent).toMatch(/\d/);
    const custom = await mount({ type: 'bar', label: 'C', series: [{ key: 'v', label: 'V' }], x: { type: 'category', format: x => `<${x}>` }, data: [{ x: 'a', v: -5 }, { x: 'b', v: 3 }, { x: 'c', v: null as unknown as number }] });
    expect(custom.querySelector('tbody th')!.textContent).toBe('<a>');
    expect(custom.querySelectorAll('.ar-chart__bar')).toHaveLength(2);
    expect(custom.querySelector('.ar-chart__grid.is-zero')).not.toBeNull();
    expect(custom.querySelector('tbody td:last-child')!.textContent).toBe('5'.replace('5', '-5'));
    const big = await mount({ type: 'line', label: 'B', series: [{ key: 'v', label: 'V' }], x: { type: 'number' }, data: [{ x: 1, v: 50_000 }, { x: 2, v: 90_000 }] });
    expect(Array.from(big.querySelectorAll('.ar-chart__tick')).some(t => /K/.test(t.textContent ?? ''))).toBe(true);
    const empty = await mount({ type: 'area', label: 'E', series: [{ key: 'v', label: 'V' }], data: [] });
    expect(empty.querySelectorAll('.ar-chart__line')).toHaveLength(0);
    const flat = await mount({ type: 'line', label: 'F', series: [{ key: 'v', label: 'V' }], data: [{ x: 'only', v: 3 }] });
    expect(flat.querySelectorAll('.ar-chart__dot')).toHaveLength(1);
  });

  it('tracks the pointer with a crosshair or a band, and hides on leave', async () => {
    const line = await mount({ type: 'line', label: 'L', series: [{ key: 'web', label: 'Web' }, { key: 'api', label: 'API' }], data: rows });
    const plot = line.querySelector<HTMLElement>('.ar-chart__plot')!;
    plot.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 50, bubbles: true }));
    expect(line.querySelector('.ar-chart__crosshair')).not.toBeNull();
    expect(line.querySelectorAll('.ar-chart__dot.is-hover')).toHaveLength(2);
    expect(line.querySelector<HTMLElement>('.ar-chart__tooltip')!.hidden).toBe(false);
    line.push({ x: 4, web: 1, api: 2 }); // redraws keep the readout
    line.redraw();
    plot.dispatchEvent(new PointerEvent('pointerleave'));
    expect(line.querySelector<HTMLElement>('.ar-chart__tooltip')!.hidden).toBe(true);
    key(plot, 'End');
    key(plot, 'ArrowRight');
    key(plot, 'x');
    plot.dispatchEvent(new FocusEvent('blur'));

    const bars = await mount({ type: 'stacked-bar', label: 'S', series: [{ key: 'web', label: 'Web' }, { key: 'api', label: 'API' }], data: rows });
    bars.querySelector('.ar-chart__plot')!.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, bubbles: true }));
    expect(bars.querySelector('.ar-chart__band')).not.toBeNull();
    bars.setSeriesVisible('api', false);
    bars.setSeriesVisible('api', true);
    bars.setData([]);
    bars.redraw();
    expect(bars.data).toEqual([]);
    bars.remove();
  });
});
