/**
 * `<a-chart>`: dependency-free SVG charts (line, area, bar, stacked bar)
 * that stream, resize, and can be read without a mouse or without sight.
 *
 * ```ts
 * chart.configure({
 *   type: 'line',
 *   label: 'Requests per second',
 *   series: [{ key: 'web', label: 'Web' }, { key: 'api', label: 'API' }],
 *   x: { type: 'time' },
 *   data: [{ x: Date.now(), web: 120, api: 80 }, …],
 *   maxPoints: 60,
 * });
 * chart.push({ x: Date.now(), web: 131, api: 77 }); // streaming: the oldest point drops off
 * ```
 *
 * - **Colors** come from `--ar-chart-1` … `--ar-chart-6`, in series order, and a
 *   series keeps its color when others are hidden.
 * - **Hover** shows a crosshair and one tooltip listing every series at that x.
 * - **Keyboard:** the plot is focusable; ← → step through the points (Home/End
 *   jump), and each point is announced. Escape hides the readout.
 * - **Legend** (two or more series): buttons that show and hide series.
 * - **Data table:** always available to screen readers, and shown with the
 *   "Table" button.
 * - `sparkline: true` draws just the line, for stat tiles.
 *
 * @module kit/chart
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';

export type ChartType = 'line' | 'area' | 'bar' | 'stacked-bar';
export type ChartX = number | string | Date;
export type ChartRow = { x: ChartX } & Record<string, unknown>;

export interface ChartSeries {
  key: string;
  label: string;
  /** Any CSS color. @default `var(--ar-chart-N)` by position */
  color?: string;
}

export interface ChartConfig {
  type: ChartType;
  /** Accessible name, and the data table's caption. */
  label: string;
  series: ChartSeries[];
  data?: ChartRow[];
  x?: { type?: 'time' | 'number' | 'category'; format?: (x: ChartX) => string };
  y?: { min?: number; max?: number; format?: (value: number) => string; label?: string };
  /** Keep at most this many points (streaming). */
  maxPoints?: number;
  /** Plot height in px. @default 220 (40 for sparklines) */
  height?: number;
  /** Just the line: no axes, legend, tooltip or table button. */
  sparkline?: boolean;
}

const NS = 'http://www.w3.org/2000/svg';
/** Colors are written into style attributes, so only plain color values are accepted. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl|oklch|oklab)a?\([\d\s.,%/-]+\)|var\(--[\w-]+\)|[a-z]+)$/i;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const round = (n: number): number => Math.round(n * 10) / 10;

/** "Nice" axis ticks: 1, 2, 2.5 or 5 times a power of ten. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= raw) ?? 10 * power;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5 && ticks.length < 50; v += step) ticks.push(Math.round(v / step) * step);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export class Chart extends Component {
  #config: ChartConfig | null = null;
  #data: ChartRow[] = [];
  #hidden = new Set<string>();
  #index = -1;
  #width = 0;
  #plot!: HTMLElement;
  #svg!: SVGSVGElement;
  #tooltip!: HTMLElement;
  #legend!: HTMLElement;
  #table!: HTMLTableElement;
  #live!: HTMLElement;
  #built = false;
  #frame = 0;
  /** Geometry of the last render, for hit-testing. */
  #geo: { left: number; top: number; width: number; height: number; xs: number[]; y: (v: number) => number } | null = null;

  /** Set up (or replace) the chart. */
  configure(config: ChartConfig): void {
    this.#config = config;
    this.#data = [...(config.data ?? [])];
    this.#trim();
    this.#hidden.clear();
    this.#index = -1;
    if (this.isConnected) this.#build();
    this.#schedule();
  }

  get config(): ChartConfig | null {
    return this.#config;
  }

  get data(): readonly ChartRow[] {
    return this.#data;
  }

  /** Replace all the data. */
  setData(rows: ChartRow[]): void {
    this.#data = [...rows];
    this.#trim();
    this.#schedule();
  }

  /** Add a point at the end (dropping the oldest beyond `maxPoints`). */
  push(row: ChartRow): void {
    this.#data.push(row);
    const dropped = this.#trim();
    if (this.#index >= 0) this.#index = Math.max(0, this.#index - dropped);
    this.#schedule();
  }

  /** Show or hide a series (its color doesn't change). */
  setSeriesVisible(key: string, visible: boolean): void {
    if (visible) this.#hidden.delete(key);
    else this.#hidden.add(key);
    this.#schedule();
  }

  #trim(): number {
    const max = this.#config?.maxPoints;
    if (!max || this.#data.length <= max) return 0;
    const n = this.#data.length - max;
    this.#data.splice(0, n);
    return n;
  }

  protected override onConnected(): void {
    if (this.#config) this.#build();
    this.listen(window, 'resize', () => this.#schedule());
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.#schedule());
      ro.observe(this);
      this.signal.addEventListener('abort', () => ro.disconnect());
    }
    this.#schedule();
  }

  protected override onDisconnected(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #build(): void {
    const config = this.#config!;
    this.classList.add('ar-chart');
    this.classList.toggle('ar-chart--spark', !!config.sparkline);
    if (!this.#built) {
      this.#built = true;
      this.#legend = document.createElement('div');
      this.#legend.className = 'ar-chart__legend';
      this.#plot = document.createElement('div');
      this.#plot.className = 'ar-chart__plot';
      this.#svg = document.createElementNS(NS, 'svg');
      this.#svg.setAttribute('aria-hidden', 'true');
      this.#svg.setAttribute('focusable', 'false');
      this.#tooltip = document.createElement('div');
      this.#tooltip.className = 'ar-chart__tooltip';
      this.#tooltip.hidden = true;
      this.#tooltip.setAttribute('aria-hidden', 'true');
      this.#live = document.createElement('div');
      this.#live.className = 'ar-visually-hidden';
      this.#live.setAttribute('aria-live', 'polite');
      this.#table = document.createElement('table');
      this.#table.className = 'ar-chart__table ar-visually-hidden';
      this.#plot.append(this.#svg, this.#tooltip);
      this.replaceChildren(this.#legend, this.#plot, this.#live, this.#table);
      this.#wire();
    }
    this.#plot.style.height = `${config.height ?? (config.sparkline ? 40 : 220)}px`;
    if (config.sparkline) {
      this.#plot.removeAttribute('tabindex');
      this.#plot.setAttribute('role', 'img');
      this.#plot.setAttribute('aria-label', config.label);
    } else {
      this.#plot.tabIndex = 0;
      this.#plot.setAttribute('role', 'group');
      this.#plot.setAttribute('aria-roledescription', 'chart');
      this.#plot.setAttribute('aria-label', `${config.label}. Use the left and right arrow keys to read the values.`);
    }
    this.#renderLegend();
  }

  #renderLegend(): void {
    const config = this.#config!;
    this.#legend.replaceChildren();
    if (config.sparkline) return;
    if (config.series.length > 1) {
      config.series.forEach((s, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ar-chart__key';
        button.dataset.key = s.key;
        button.setAttribute('aria-pressed', String(!this.#hidden.has(s.key)));
        const swatch = document.createElement('span');
        swatch.className = 'ar-chart__swatch';
        swatch.style.background = this.#color(s, i);
        swatch.setAttribute('aria-hidden', 'true');
        button.append(swatch, document.createTextNode(s.label));
        this.#legend.appendChild(button);
      });
    }
    const table = document.createElement('button');
    table.type = 'button';
    table.className = 'ar-chart__key ar-chart__table-toggle';
    table.textContent = 'Table';
    table.setAttribute('aria-pressed', String(!this.#table.classList.contains('ar-visually-hidden')));
    table.title = 'Show the data as a table';
    this.#legend.appendChild(table);
  }

  #color(series: ChartSeries, index: number): string {
    return series.color && SAFE_COLOR.test(series.color) ? series.color : `var(--ar-chart-${(index % 6) + 1})`;
  }

  #wire(): void {
    this.listen(this.#legend, 'click', (e: Event) => {
      const button = (e.target as Element).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.classList.contains('ar-chart__table-toggle')) {
        const show = this.#table.classList.toggle('ar-visually-hidden') === false;
        button.setAttribute('aria-pressed', String(show));
        return;
      }
      const key = button.dataset.key!;
      const visible = this.#hidden.has(key);
      // Keep at least one series showing.
      if (!visible && this.#config!.series.filter(s => !this.#hidden.has(s.key)).length === 1) return;
      this.setSeriesVisible(key, visible);
      button.setAttribute('aria-pressed', String(visible));
    });
    this.listen(this.#plot, 'pointermove', (e: Event) => {
      const pe = e as PointerEvent;
      if (!this.#geo || this.#config?.sparkline) return;
      const rect = this.#plot.getBoundingClientRect();
      const x = pe.clientX - rect.left;
      this.#index = this.#nearest(x);
      this.#drawReadout(false);
    });
    this.listen(this.#plot, 'pointerleave', () => {
      if (document.activeElement !== this.#plot) this.#hideReadout();
    });
    this.listen(this.#plot, 'focus', () => {
      if (this.#index < 0) this.#index = this.#data.length - 1;
      this.#drawReadout(true);
    });
    this.listen(this.#plot, 'blur', () => this.#hideReadout());
    this.listen(this.#plot, 'keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      const last = this.#data.length - 1;
      let next: number;
      if (ke.key === 'ArrowRight') next = Math.min(last, this.#index + 1);
      else if (ke.key === 'ArrowLeft') next = Math.max(0, this.#index - 1);
      else if (ke.key === 'Home') next = 0;
      else if (ke.key === 'End') next = last;
      else if (ke.key === 'Escape') {
        this.#hideReadout();
        return;
      } else return;
      ke.preventDefault();
      this.#index = next;
      this.#drawReadout(true);
    });
  }

  #nearest(x: number): number {
    const xs = this.#geo?.xs ?? [];
    let best = -1;
    let dist = Infinity;
    xs.forEach((px, i) => {
      const d = Math.abs(px - x);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  }

  #schedule(): void {
    if (this.#frame || !this.#config) return;
    const run = () => {
      this.#frame = 0;
      this.#render();
    };
    this.#frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (setTimeout(run, 0) as unknown as number);
  }

  /** Draw now (normally batched to the next frame). */
  redraw(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#render();
  }

  #formatX(x: ChartX): string {
    const config = this.#config!;
    if (config.x?.format) return config.x.format(x);
    if (config.x?.type === 'time' || x instanceof Date) {
      return new Date(x as number).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    }
    return typeof x === 'number' ? full.format(x) : String(x);
  }

  #formatY(v: number, axis = false): string {
    const f = this.#config!.y?.format;
    if (f) return f(v);
    return axis && Math.abs(v) >= 10000 ? compact.format(v) : full.format(v);
  }

  #value(row: ChartRow, key: string): number | null {
    const v = row[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  #render(): void {
    const config = this.#config;
    if (!config || !this.#built) return;
    this.#width = this.#plot.clientWidth || this.#width || 300;
    const width = this.#width;
    const height = config.height ?? (config.sparkline ? 40 : 220);
    const series = config.series.map((s, i) => ({ ...s, color: this.#color(s, i) })).filter(s => !this.#hidden.has(s.key));
    const data = this.#data;
    const stacked = config.type === 'stacked-bar';
    const bars = config.type === 'bar' || stacked;

    // Y domain.
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of data) {
      if (stacked) {
        const sum = series.reduce((t, s) => t + Math.max(0, this.#value(row, s.key) ?? 0), 0);
        hi = Math.max(hi, sum);
        lo = Math.min(lo, 0);
      } else {
        for (const s of series) {
          const v = this.#value(row, s.key);
          if (v === null) continue;
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
    if (bars || config.type === 'area') lo = Math.min(0, lo);
    if (config.y?.min !== undefined) lo = config.y.min;
    if (config.y?.max !== undefined) hi = config.y.max;
    const ticks = config.sparkline ? [lo, hi === lo ? lo + 1 : hi] : niceTicks(lo, hi, height < 180 ? 3 : 5);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];

    // Margins: room for the widest y label.
    const labelWidth = config.sparkline ? 0 : Math.max(...ticks.map(t => this.#formatY(t, true).length)) * 7 + 10;
    const m = config.sparkline ? { top: 3, right: 3, bottom: 3, left: 3 } : { top: 10, right: 14, bottom: 26, left: labelWidth };
    const pw = Math.max(10, width - m.left - m.right);
    const ph = Math.max(10, height - m.top - m.bottom);
    const y = (v: number) => m.top + ph - ((v - y0) / (y1 - y0 || 1)) * ph;

    // X positions: bars sit in bands; lines span the width (by time or number when given).
    const n = data.length;
    let xs: number[];
    const band = n ? pw / n : pw;
    if (bars) xs = data.map((_, i) => m.left + band * (i + 0.5));
    else if ((config.x?.type === 'time' || config.x?.type === 'number') && n > 1) {
      const t = data.map(r => (r.x instanceof Date ? r.x.getTime() : Number(r.x)));
      const t0 = t[0];
      const t1 = t[n - 1];
      xs = t.map(v => m.left + ((v - t0) / (t1 - t0 || 1)) * pw);
    } else xs = data.map((_, i) => m.left + (n > 1 ? (i / (n - 1)) * pw : pw / 2));
    this.#geo = { left: m.left, top: m.top, width: pw, height: ph, xs, y };

    const out: string[] = [];
    if (!config.sparkline) {
      // Gridlines and y labels: hairlines, recessive.
      for (const t of ticks) {
        const py = round(y(t));
        out.push(`<line class="ar-chart__grid${t === 0 ? ' is-zero' : ''}" x1="${m.left}" x2="${m.left + pw}" y1="${py}" y2="${py}"/>`);
        out.push(`<text class="ar-chart__tick" x="${m.left - 8}" y="${py}" text-anchor="end" dominant-baseline="middle">${esc(this.#formatY(t, true))}</text>`);
      }
      // X labels: as many as fit side by side, evenly spaced, always including the latest.
      const longest = Math.max(4, ...data.map(r => this.#formatX(r.x).length));
      const fit = Math.max(2, Math.floor(pw / (longest * 6.5 + 16)));
      const step = Math.max(1, Math.ceil(n / fit));
      for (let i = n - 1; i >= 0; i -= step) {
        out.push(`<text class="ar-chart__tick" x="${round(xs[i])}" y="${m.top + ph + 18}" text-anchor="${i === n - 1 && !bars ? 'end' : i === 0 && !bars ? 'start' : 'middle'}">${esc(this.#formatX(data[i].x))}</text>`);
      }
    }

    if (bars && n) {
      const base = y(Math.max(y0, Math.min(0, y1)));
      if (stacked) {
        const w = Math.min(24, band * 0.7);
        data.forEach((row, i) => {
          let top = base;
          const parts = series.map(s => ({ s, v: Math.max(0, this.#value(row, s.key) ?? 0) })).filter(p => p.v > 0);
          parts.forEach((p, j) => {
            const h = (p.v / (y1 - y0 || 1)) * ph;
            const gap = j > 0 ? 2 : 0; // a 2px surface gap between segments
            const yTop = top - h;
            out.push(barPath(xs[i] - w / 2, yTop, w, h - gap, top - gap, j === parts.length - 1, p.s.color));
            top = yTop;
          });
        });
      } else {
        const groupW = Math.min(band * 0.8, 24 * series.length + 2 * (series.length - 1));
        const w = Math.max(2, (groupW - 2 * (series.length - 1)) / series.length);
        data.forEach((row, i) => {
          series.forEach((s, j) => {
            const v = this.#value(row, s.key);
            if (v === null) return;
            const x = xs[i] - groupW / 2 + j * (w + 2);
            const top = y(Math.max(v, 0));
            const bottom = y(Math.min(v, 0));
            out.push(barPath(x, top, w, bottom - top, bottom, true, s.color, v < 0));
          });
        });
      }
    } else {
      for (const s of series) {
        const points = data.map((row, i) => [xs[i], this.#value(row, s.key)] as const).filter((p): p is readonly [number, number] => p[1] !== null);
        if (!points.length) continue;
        const d = points.map(([px, v], i) => `${i ? 'L' : 'M'}${round(px)},${round(y(v))}`).join('');
        if (config.type === 'area') {
          const base = round(y(Math.max(y0, 0)));
          out.push(`<path class="ar-chart__area" style="fill:${s.color}" d="${d}L${round(points[points.length - 1][0])},${base}L${round(points[0][0])},${base}Z"/>`);
        }
        out.push(`<path class="ar-chart__line" style="stroke:${s.color}" d="${d}"/>`);
        // An end dot marks the latest value.
        const [ex, ev] = points[points.length - 1];
        out.push(`<circle class="ar-chart__dot" style="fill:${s.color}" cx="${round(ex)}" cy="${round(y(ev))}" r="${config.sparkline ? 2.5 : 4}"/>`);
      }
    }
    out.push('<g class="ar-chart__cursor"></g>');
    this.#svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.#svg.setAttribute('width', String(width));
    this.#svg.setAttribute('height', String(height));
    this.#svg.innerHTML = out.join('');
    if (!this.#tooltip.hidden) this.#drawReadout(false, true);
    this.#renderTable(series);
  }

  #renderTable(series: Array<ChartSeries & { color: string }>): void {
    const config = this.#config!;
    const caption = document.createElement('caption');
    caption.textContent = config.label;
    const head = document.createElement('tr');
    for (const label of [config.x?.type === 'time' ? 'Time' : 'X', ...series.map(s => s.label)]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      head.appendChild(th);
    }
    const rows = this.#data.map(row => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = this.#formatX(row.x);
      tr.appendChild(th);
      for (const s of series) {
        const td = document.createElement('td');
        const v = this.#value(row, s.key);
        td.textContent = v === null ? '–' : this.#formatY(v);
        tr.appendChild(td);
      }
      return tr;
    });
    const thead = document.createElement('thead');
    thead.appendChild(head);
    const tbody = document.createElement('tbody');
    tbody.append(...rows);
    this.#table.replaceChildren(caption, thead, tbody);
  }

  /** Crosshair, dots and tooltip at the current index; `announce` also tells screen readers. */
  #drawReadout(announce: boolean, quiet = false): void {
    const config = this.#config;
    const geo = this.#geo;
    if (!config || !geo || config.sparkline || this.#index < 0 || this.#index >= this.#data.length) return;
    const row = this.#data[this.#index];
    const x = geo.xs[this.#index];
    const series = config.series.map((s, i) => ({ ...s, color: this.#color(s, i) })).filter(s => !this.#hidden.has(s.key));
    const bars = config.type === 'bar' || config.type === 'stacked-bar';
    const cursor = this.#svg.querySelector('.ar-chart__cursor')!;
    const parts: string[] = [];
    if (bars) {
      const band = geo.width / Math.max(1, this.#data.length);
      parts.push(`<rect class="ar-chart__band" x="${round(x - band / 2)}" y="${geo.top}" width="${round(band)}" height="${geo.height}"/>`);
    } else {
      parts.push(`<line class="ar-chart__crosshair" x1="${round(x)}" x2="${round(x)}" y1="${geo.top}" y2="${geo.top + geo.height}"/>`);
      for (const s of series) {
        const v = this.#value(row, s.key);
        if (v !== null) parts.push(`<circle class="ar-chart__dot is-hover" style="fill:${s.color}" cx="${round(x)}" cy="${round(geo.y(v))}" r="4.5"/>`);
      }
    }
    cursor.innerHTML = parts.join('');

    // One tooltip, every series: the value leads, the label follows.
    const tip = this.#tooltip;
    const title = document.createElement('p');
    title.className = 'ar-chart__tip-title';
    title.textContent = this.#formatX(row.x);
    const list = document.createElement('dl');
    for (const s of series) {
      const v = this.#value(row, s.key);
      const dt = document.createElement('dt');
      const swatch = document.createElement('span');
      swatch.className = 'ar-chart__swatch';
      swatch.style.background = s.color;
      dt.append(swatch, document.createTextNode(s.label));
      const dd = document.createElement('dd');
      dd.textContent = v === null ? '–' : this.#formatY(v);
      list.append(dt, dd);
    }
    tip.replaceChildren(title, list);
    tip.hidden = false;
    const plotWidth = this.#plot.clientWidth || this.#width;
    const tipWidth = tip.offsetWidth || 160;
    const left = x + 14 + tipWidth > plotWidth ? x - 14 - tipWidth : x + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${geo.top}px`;
    if (announce && !quiet) {
      this.#live.textContent = `${this.#formatX(row.x)}: ${series.map(s => {
        const v = this.#value(row, s.key);
        return `${s.label} ${v === null ? 'no value' : this.#formatY(v)}`;
      }).join(', ')}`;
    }
  }

  #hideReadout(): void {
    this.#tooltip.hidden = true;
    const cursor = this.#svg?.querySelector('.ar-chart__cursor');
    if (cursor) cursor.innerHTML = '';
  }
}

/**
 * A bar with a 4px rounded data end and a square base. `top`/`height` are
 * the bar's extent, `base` the baseline side; `flip` rounds the bottom
 * instead (negative values).
 */
function barPath(x: number, top: number, w: number, h: number, base: number, rounded: boolean, color: string, flip = false): string {
  if (h <= 0) return '';
  const r = rounded ? Math.min(4, w / 2, h) : 0;
  const [l, rgt] = [round(x), round(x + w)];
  if (!flip) {
    const t = round(top);
    const b = round(base);
    return `<path class="ar-chart__bar" style="fill:${color}" d="M${l},${b}V${round(t + r)}Q${l},${t} ${round(l + r)},${t}H${round(rgt - r)}Q${rgt},${t} ${rgt},${round(t + r)}V${b}Z"/>`;
  }
  const t = round(top);
  const b = round(top + h);
  return `<path class="ar-chart__bar" style="fill:${color}" d="M${l},${t}V${round(b - r)}Q${l},${b} ${round(l + r)},${b}H${round(rgt - r)}Q${rgt},${b} ${rgt},${round(b - r)}V${t}Z"/>`;
}

defineComponent({ tag: 'a-chart' })(Chart);
