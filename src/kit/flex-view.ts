/**
 * `<a-flex-view>`: a configurable dashboard layout. Each panel hosts any
 * component bound to an object or a list. Panels can be reordered (drag the
 * header, or use the keyboard) and resized; the layout is kept in the store,
 * so with persistence on it survives reloads.
 *
 * Resizing follows the window-splitter pattern. The gap between two panels
 * in the same row is a splitter (`role="separator"`) that moves space from one
 * to the other, so the row stays full and nothing jumps to another row while
 * you drag. The last panel in a row is resized from its left edge. Widths are
 * stored as `flex-grow` ratios, so a saved layout adapts to any screen width.
 * A panel's bottom edge changes its height.
 *
 * ```ts
 * dashboard.configure({
 *   id: 'home',
 *   gap: '1rem',
 *   children: [
 *     { key: 'revenue', title: 'Revenue', component: 'stat-card', flex: '1', binding: { type: 'Stat', id: 'revenue' } },
 *     { key: 'orders', title: 'Orders', component: 'order-list', flex: '2', list: { type: 'Order', endpoint: 'listOrders' } },
 *   ],
 * });
 * ```
 *
 * @module kit/flex-view
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import { getRuntime } from '../components/runtime';
import type { BindConfig } from '../binding/types';
import type { ListViewConfig, ObjectRef } from '../data/types';
import type { MixinInstance } from '../mixins/types';
import { mixinRegistry } from '../mixins/registry';

export interface FlexPanelConfig {
  /** Stable key, used to remember order and size. */
  key: string;
  /** Tag name of the component to render. */
  component: string;
  title?: string;
  /** CSS `flex` value. @default '1' */
  flex?: string;
  minWidth?: string;
  maxWidth?: string;
  attributes?: Record<string, string | number | boolean>;
  /** Bind the panel component to an object… */
  binding?: ObjectRef;
  /** …or to a list. */
  list?: ListViewConfig;
  bindConfig?: BindConfig;
  /** Allow resizing. @default true */
  resizable?: boolean;
  /** The panel body scrolls: make it keyboard-focusable so it can be scrolled without a mouse. */
  scrollable?: boolean;
}

export interface FlexViewConfig {
  /** Layout id; the saved order and sizes are stored under it. */
  id?: string;
  direction?: 'row' | 'column';
  wrap?: boolean;
  gap?: string;
  /** Let users reorder panels. @default true */
  reorderable?: boolean;
  children: FlexPanelConfig[];
}

interface SavedLayout {
  order: string[];
  /** `grow` is the panel's flex-grow after resizing; `height` is in px. */
  sizes: Record<string, { grow?: number; height?: number }>;
}

const LAYOUT_TYPE = 'ArLayout';
/** Pixels moved per arrow key press on a splitter (four times that with Shift). */
const KEY_STEP = 16;

interface PanelMeasure {
  width: number;
  grow: number;
  basis: number;
  min: number;
  max: number;
}

interface PairMeasure {
  /** Combined width of the two panels. */
  total: number;
  widthA: number;
  /** Smallest and largest width the first panel can take. */
  minA: number;
  maxA: number;
  a: PanelMeasure;
  b: PanelMeasure;
}

/** Resolve a computed length (`px`, `%` or keyword) to pixels. */
function toPx(value: string, reference: number, fallback: number): number {
  if (value.endsWith('px')) return parseFloat(value);
  if (value.endsWith('%')) return (parseFloat(value) / 100) * reference;
  return fallback;
}

export class FlexView extends Component {
  #config: FlexViewConfig | null = null;
  #instances: MixinInstance[] = [];
  #listeners: AbortController | null = null;
  #observer: ResizeObserver | null = null;

  configure(config: FlexViewConfig): void {
    this.#config = config;
    void this.ready.then(() => this.#render());
  }

  /** Forget the saved order and sizes. */
  resetLayout(): void {
    if (this.#config?.id) getRuntime().store.delete(LAYOUT_TYPE, this.#config.id);
    this.#render();
  }

  #saved(): SavedLayout | undefined {
    return this.#config?.id ? getRuntime().store.getData<SavedLayout>(LAYOUT_TYPE, this.#config.id) : undefined;
  }

  #panels(): HTMLElement[] {
    const container = this.querySelector('.ar-flex');
    return container ? Array.from(container.querySelectorAll<HTMLElement>(':scope > .ar-flex__panel')) : [];
  }

  #save(): void {
    if (!this.#config?.id) return;
    const panels = this.#panels();
    const sizes: SavedLayout['sizes'] = {};
    for (const p of panels) {
      const grow = p.dataset.grow ? parseFloat(p.dataset.grow) : undefined;
      const height = parseFloat(p.style.height) || undefined;
      if (grow !== undefined || height !== undefined) sizes[p.dataset.key!] = { grow, height };
    }
    getRuntime().store.upsert(LAYOUT_TYPE, this.#config.id, { order: panels.map(p => p.dataset.key!), sizes }, { merge: 'replace', source: 'local' });
    this.emit('layout-change', { order: panels.map(p => p.dataset.key) });
  }

  #setGrow(panel: HTMLElement, grow: number): void {
    const value = String(Math.round(grow * 1000) / 1000);
    panel.style.flexGrow = value;
    panel.dataset.grow = value;
  }

  /**
   * Show a splitter only between two resizable panels that share a row, and
   * keep its label and value current. Runs after rendering, reordering and
   * whenever the container changes size (which can rewrap the rows).
   */
  #updateSplitters(): void {
    const row = (this.#config?.direction ?? 'row') === 'row';
    const panels = this.#panels();
    panels.forEach((panel, i) => {
      const splitter = panel.querySelector<HTMLElement>(':scope > .ar-flex__splitter');
      if (!splitter) return;
      const next = panels[i + 1];
      let shared = false;
      if (row && next && next.querySelector(':scope > .ar-flex__splitter')) {
        // Layout positions, not getBoundingClientRect: they ignore the transforms of
        // panels still animating into place after a drag.
        shared = Math.abs(panel.offsetTop - next.offsetTop) < 1 && next.offsetLeft > panel.offsetLeft;
      }
      const growable = shared && (parseFloat(getComputedStyle(panel).flexGrow) || 0) + (parseFloat(getComputedStyle(next).flexGrow) || 0) > 0;
      splitter.hidden = !growable;
      if (!growable) return;
      const name = (p: HTMLElement) => p.getAttribute('aria-label') ?? p.dataset.key!;
      splitter.setAttribute('aria-label', `Resize ${name(panel)} and ${name(next)}`);
      splitter.setAttribute('aria-controls', `${panel.id} ${next.id}`);
      this.#updateSplitterValue(splitter, panel, next);
    });
  }

  /** `aria-valuenow` is the left panel's share of the pair, in percent. */
  #updateSplitterValue(splitter: HTMLElement, a: HTMLElement, b: HTMLElement): void {
    const pair = this.#pair(a, b);
    if (pair.total <= 0) return;
    splitter.setAttribute('aria-valuemin', String(Math.round((100 * pair.minA) / pair.total)));
    splitter.setAttribute('aria-valuemax', String(Math.round((100 * pair.maxA) / pair.total)));
    splitter.setAttribute('aria-valuenow', String(Math.round((100 * pair.widthA) / pair.total)));
  }

  /** Measure two neighbours: their widths, flex values and how far the boundary may move. */
  #pair(a: HTMLElement, b: HTMLElement): PairMeasure {
    const containerWidth = this.querySelector('.ar-flex')!.getBoundingClientRect().width;
    const measure = (p: HTMLElement): PanelMeasure => {
      const style = getComputedStyle(p);
      const width = p.getBoundingClientRect().width;
      return {
        width,
        grow: parseFloat(style.flexGrow) || 0,
        basis: toPx(style.flexBasis, containerWidth, 0),
        min: toPx(style.minWidth, containerWidth, 0),
        max: toPx(style.maxWidth, containerWidth, Infinity),
      };
    };
    const ma = measure(a);
    const mb = measure(b);
    const total = ma.width + mb.width;
    // Each panel keeps at least its min-width and its flex basis (growth can't go below zero).
    const lowA = Math.max(ma.min, ma.basis);
    const lowB = Math.max(mb.min, mb.basis);
    const minA = Math.max(lowA, total - Math.min(mb.max, total));
    const maxA = Math.min(ma.max, total - lowB);
    return { total, widthA: ma.width, minA, maxA: Math.max(minA, maxA), a: ma, b: mb };
  }

  /**
   * Move the boundary so `a` becomes `widthA` wide. Only the two flex-grow
   * values change, and their sum stays the same, so the rest of the row and
   * the line breaks are untouched.
   */
  #resizePair(a: HTMLElement, b: HTMLElement, pair: PairMeasure, widthA: number): void {
    const target = Math.max(pair.minA, Math.min(pair.maxA, widthA));
    const growSum = pair.a.grow + pair.b.grow;
    const spare = pair.total - pair.a.basis - pair.b.basis;
    if (growSum <= 0 || spare <= 0) return;
    const growA = (growSum * (target - pair.a.basis)) / spare;
    this.#setGrow(a, Math.max(0, growA));
    this.#setGrow(b, Math.max(0, growSum - growA));
  }

  #addSplitter(panel: HTMLElement, signal: AbortSignal): void {
    const splitter = document.createElement('div');
    splitter.className = 'ar-flex__splitter';
    splitter.tabIndex = 0;
    splitter.hidden = true;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', 'vertical');
    panel.appendChild(splitter);

    const neighbour = (): HTMLElement | null => {
      const panels = this.#panels();
      return panels[panels.indexOf(panel) + 1] ?? null;
    };
    const finish = (): void => {
      this.#save();
      const next = neighbour();
      if (next) this.#updateSplitterValue(splitter, panel, next);
      this.emit('panel-resize', { key: panel.dataset.key, neighbour: next?.dataset.key });
    };

    let drag: { x: number; pointerId: number; next: HTMLElement; pair: PairMeasure } | null = null;
    splitter.addEventListener('pointerdown', (e: PointerEvent) => {
      const next = neighbour();
      if (e.button !== 0 || !next || splitter.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      drag = { x: e.clientX, pointerId: e.pointerId, next, pair: this.#pair(panel, next) };
      splitter.setPointerCapture?.(e.pointerId);
      splitter.classList.add('is-active');
      this.classList.add('is-resizing');
    }, { signal });
    splitter.addEventListener('pointermove', (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      this.#resizePair(panel, drag.next, drag.pair, drag.pair.widthA + (e.clientX - drag.x));
      this.#updateSplitterValue(splitter, panel, drag.next);
    }, { signal });
    const end = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag = null;
      splitter.classList.remove('is-active');
      this.classList.remove('is-resizing');
      finish();
    };
    splitter.addEventListener('pointerup', end, { signal });
    splitter.addEventListener('pointercancel', end, { signal });
    splitter.addEventListener('keydown', (e: KeyboardEvent) => {
      const next = neighbour();
      if (!next) return;
      const pair = this.#pair(panel, next);
      const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
      const targets: Record<string, number> = {
        ArrowLeft: pair.widthA - step,
        ArrowRight: pair.widthA + step,
        Home: pair.minA,
        End: pair.maxA,
      };
      if (!(e.key in targets)) return;
      e.preventDefault();
      this.#resizePair(panel, next, pair, targets[e.key]);
      finish();
    }, { signal });
  }

  #render(): void {
    const config = this.#config;
    if (!config) return;
    this.#teardown();
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;
    let container = this.querySelector<HTMLElement>('.ar-flex');
    if (!container) {
      container = document.createElement('div');
      container.className = 'ar-flex';
      this.replaceChildren(container);
    }
    container.replaceChildren();
    Object.assign(container.style, {
      display: 'flex',
      flexDirection: config.direction ?? 'row',
      flexWrap: config.wrap === false ? 'nowrap' : 'wrap',
      gap: config.gap ?? '1rem',
    });
    container.style.setProperty('--ar-flex-gap', config.gap ?? '1rem');
    container.setAttribute('aria-label', 'Dashboard panels');

    const saved = this.#saved();
    const children = [...config.children].sort((a, b) => {
      const order = saved?.order ?? [];
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    });

    for (const child of children) {
      const panel = document.createElement('section');
      panel.className = 'ar-flex__panel';
      panel.dataset.key = child.key;
      panel.setAttribute('data-id', child.key);
      panel.id = `${config.id ?? 'flex'}-panel-${child.key}`.replace(/[^\w-]/g, '-');
      Object.assign(panel.style, { flex: child.flex ?? '1', minWidth: child.minWidth ?? '16rem', maxWidth: child.maxWidth ?? 'none' });
      const size = saved?.sizes[child.key];
      if (size?.grow !== undefined) this.#setGrow(panel, size.grow);
      if (size?.height) panel.style.height = `${size.height}px`;
      if (child.title) {
        const header = document.createElement('header');
        header.className = 'ar-flex__header';
        const h = document.createElement('h2');
        h.textContent = child.title;
        header.appendChild(h);
        panel.appendChild(header);
        panel.setAttribute('aria-label', child.title);
      }
      const body = document.createElement('div');
      body.className = 'ar-flex__body';
      if (child.scrollable) {
        body.tabIndex = 0;
        body.setAttribute('role', 'region');
        body.setAttribute('aria-label', child.title ?? child.key);
      }
      const component = document.createElement(child.component);
      for (const [k, v] of Object.entries(child.attributes ?? {})) component.setAttribute(k, String(v));
      body.appendChild(component);
      panel.appendChild(body);
      container.appendChild(panel);

      if (child.binding || child.list) {
        void customElements.whenDefined(child.component).then(() => {
          const c = component as Component;
          if (typeof c.bind !== 'function') return;
          if (child.list) c.bindList(child.list, child.bindConfig);
          else c.bind(child.binding!, child.bindConfig);
        });
      }
      if (child.resizable !== false) {
        // Width: a splitter in the gap after the panel. Height: the bottom edge.
        this.#addSplitter(panel, signal);
        const r = mixinRegistry.apply(panel, 'resizable', { handles: ['s'], minHeight: 120 });
        if (r) this.#instances.push(r);
        panel.addEventListener('resizable:end', () => this.#save(), { signal });
      }
    }

    if (config.reorderable !== false) {
      const sortable = mixinRegistry.apply(container, 'sortable', { items: '.ar-flex__panel', handle: '.ar-flex__header', direction: 'horizontal' });
      if (sortable) this.#instances.push(sortable);
      container.addEventListener('sortable:end', () => queueMicrotask(() => {
        this.#save();
        this.#updateSplitters();
      }), { signal });
    }

    this.#updateSplitters();
    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.#updateSplitters());
      this.#observer.observe(container);
    }
  }

  #teardown(): void {
    for (const m of this.#instances.splice(0)) m.destroy();
    this.#listeners?.abort();
    this.#listeners = null;
    this.#observer?.disconnect();
    this.#observer = null;
  }

  protected override onDisconnected(): void {
    this.#teardown();
  }
}

defineComponent({ tag: 'a-flex-view' })(FlexView);
