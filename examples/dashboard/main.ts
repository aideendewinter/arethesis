import { Component, defineComponent, type StoredObject } from 'arethesis';
import 'arethesis/components';
import type { Chart, FlexView } from 'arethesis/components';
import { startApp } from '../shared/boot';
import { bindStatus, mountShell } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'dashboard',
  title: 'Live dashboard',
  description: 'Panels are ordinary components bound to objects and lists in the store. Metrics stream in over Server-Sent Events and only the changed text is patched. The layout is stored like any other object, so with IndexedDB persistence it survives reloads.',
  features: ['<a-flex-view>', '<a-chart>', 'SSE upserts', 'sortable + resizable', 'infinite scroll', 'IndexedDB persistence'],
  source,
});

type Metric = { id: string; label: string; value: number; unit: 'currency' | 'number' | 'percent'; trend: number; history: number[] };

const { app } = await startApp('dashboard', {
  types: [{ name: 'Metric', endpoint: 'getMetric' }, { name: 'Chart', endpoint: 'getChart', persist: false }, { name: 'Activity', persist: false }],
  endpoints: {
    getMetric: { url: '/metrics/:id', type: 'Metric' },
    getChart: { url: '/charts/:id', type: 'Chart' },
    listActivity: { url: '/activity', type: 'Activity', list: true, mapping: { dataPath: 'items' }, pagination: { cursorPath: 'next' } },
  },
});

/** A metric with a sparkline; re-renders only what changed on every SSE update. */
@defineComponent({
  tag: 'stat-card',
  html: `<template id="main">
      <p class="stat__label" data-bind="label"></p>
      <p class="stat__value" data-bind="value"></p>
      <p class="stat__trend" data-bind="trend"></p>
      <a-chart class="stat__spark"></a-chart>
    </template>
    <template id="loading"><div class="ar-skeleton"></div><div class="ar-skeleton" style="height:2rem"></div></template>`,
})
export class StatCard extends Component {
  static override bindConfig = {
    fields: {
      label: {},
      value: {
        format: (v: unknown, d: unknown) => {
          const m = d as Metric;
          return new Intl.NumberFormat('en-US', m.unit === 'currency' ? { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } : m.unit === 'percent' ? { style: 'percent', maximumFractionDigits: 2 } : {}).format(Number(v));
        },
      },
      trend: { format: (v: unknown) => `${Number(v) >= 0 ? '▲' : '▼'} ${Math.abs(Number(v)).toFixed(1)}% vs last week` },
    },
  };

  protected override onBind(obj: StoredObject) {
    const m = obj.data as Metric;
    this.querySelector('.stat__trend')!.classList.toggle('is-down', m.trend < 0);
    const chart = this.querySelector<Chart>('a-chart')!;
    const data = m.history.map((value, x) => ({ x, value }));
    if (!chart.config) chart.configure({ type: 'line', sparkline: true, label: `${m.label}, recent trend`, series: [{ key: 'value', label: m.label }], data });
    else chart.setData(data);
  }
}

/** Requests per second by channel, streaming: a new point every two seconds. */
@defineComponent({ tag: 'traffic-chart', html: '<template id="main"><a-chart></a-chart></template>' })
export class TrafficChart extends Component {
  protected override onBind(obj: StoredObject) {
    const { points } = obj.data as { points: Array<{ x: number; web: number; mobile: number; api: number }> };
    const chart = this.querySelector<Chart>('a-chart')!;
    if (!chart.config) {
      chart.configure({
        type: 'line',
        label: 'Requests per second by channel',
        series: [{ key: 'web', label: 'Web' }, { key: 'mobile', label: 'Mobile' }, { key: 'api', label: 'API' }],
        x: { type: 'time' },
        y: { format: v => `${Math.round(v)}/s` },
        data: points,
        maxPoints: 40,
        height: 240,
      });
    } else chart.setData(points);
  }
}

/** Orders by region, this week against last, as grouped bars. */
@defineComponent({ tag: 'region-chart', html: '<template id="main"><a-chart></a-chart></template>' })
export class RegionChart extends Component {
  protected override onBind(obj: StoredObject) {
    const { rows } = obj.data as { rows: Array<{ x: string; thisWeek: number; lastWeek: number }> };
    const chart = this.querySelector<Chart>('a-chart')!;
    if (!chart.config) {
      chart.configure({
        type: 'bar',
        label: 'Orders by polis, this week and last',
        series: [{ key: 'thisWeek', label: 'This week' }, { key: 'lastWeek', label: 'Last week' }],
        x: { type: 'category' },
        data: rows,
        height: 240,
      });
    } else chart.setData(rows);
  }
}

/** A live, infinitely scrolling activity feed. */
@defineComponent({
  tag: 'activity-feed',
  html: `<template id="main"><ol class="feed" data-items aria-label="Recent activity"></ol></template>
    <template id="item"><li class="feed__item"><strong data-bind="user"></strong> <span data-bind="message"></span><time data-bind="at"></time></li></template>
    <template id="loading"><li class="feed__item"><div class="ar-skeleton"></div></li></template>`,
})
export class ActivityFeed extends Component {
  static override bindConfig = {
    fields: { user: {}, message: {}, at: { displayType: 'relative' as const } },
    loadingTemplate: 'loading',
    infiniteScroll: { threshold: 200 },
  };
}

const dashboard = document.querySelector<FlexView>('#dashboard')!;
const metric = (id: string) => ({ key: id, component: 'stat-card', binding: { type: 'Metric', id }, flex: '1', minWidth: '14rem' });
dashboard.configure({
  id: 'demo-dashboard',
  gap: '1rem',
  children: [
    { ...metric('revenue'), title: 'Revenue' },
    { ...metric('users'), title: 'Users' },
    { ...metric('orders'), title: 'Orders' },
    { ...metric('conversion'), title: 'Conversion' },
    { key: 'activity', title: 'Activity', scrollable: true, component: 'activity-feed', list: { id: 'activity', type: 'Activity', endpoint: 'listActivity', pageSize: 15 }, flex: '2', minWidth: '20rem' },
    { key: 'about', title: 'How this works', component: 'how-it-works', flex: '1', minWidth: '18rem' },
    // Wide enough to start a row of their own.
    { key: 'traffic', title: 'Requests per second', component: 'traffic-chart', binding: { type: 'Chart', id: 'traffic' }, flex: '2', minWidth: 'min(100%, 40rem)' },
    { key: 'regions', title: 'Orders by polis', component: 'region-chart', binding: { type: 'Chart', id: 'regions' }, flex: '1', minWidth: '18rem' },
  ],
});

// New activity arrives as a custom SSE event; put it at the top of the feed.
app.sse!.on('activity', data => {
  const item = data as { id: number };
  app.store.upsert('Activity', item.id, item, { source: 'sse' });
  app.listViews.optimisticAdd('activity', String(item.id), 'start');
});


@defineComponent({
  tag: 'how-it-works',
  html: `<ul class="how">
    <li>Each stat card is <code>bind({ type: 'Metric', id })</code>. Missing objects are fetched through the type's endpoint.</li>
    <li>The server pushes <code>upsert</code> events over SSE, the store merges them, and only changed text nodes update.</li>
    <li>The feed is a ListView with cursor pagination; scroll it to load more.</li>
    <li>Panel order and sizes are an <code>ArLayout</code> object in the store, persisted to IndexedDB.</li>
  </ul>`,
})
export class HowItWorks extends Component {}

document.querySelector('#reset')!.addEventListener('click', () => dashboard.resetLayout());
bindStatus(document.querySelector('#sse-status')!, 'Live', fn => app.sse!.onStatusChange(fn), app.sse!.status);
