import { Component, defineComponent, type StoredObject } from 'arethesis';
import 'arethesis/components';
import type { FlexView } from 'arethesis/components';
import { startApp } from '../shared/boot';
import { bindStatus, mountShell } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'dashboard',
  title: 'Live dashboard',
  description: 'Panels are ordinary components bound to objects and lists in the store. Metrics stream in over Server-Sent Events and only the changed text is patched. The layout is stored like any other object, so with IndexedDB persistence it survives reloads.',
  features: ['<a-flex-view>', 'SSE upserts', 'sortable + resizable', 'infinite scroll', 'IndexedDB persistence', 'relative time'],
  source,
});

type Metric = { id: string; label: string; value: number; unit: 'currency' | 'number' | 'percent'; trend: number; history: number[] };

const { app } = await startApp('dashboard', {
  types: [{ name: 'Metric', endpoint: 'getMetric' }, { name: 'Activity', persist: false }],
  endpoints: {
    getMetric: { url: '/metrics/:id', type: 'Metric' },
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
      <svg class="stat__spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
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
    const min = Math.min(...m.history);
    const max = Math.max(...m.history);
    const points = m.history.map((v, i) => `${(i / (m.history.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 26}`);
    this.querySelector('path')!.setAttribute('d', `M${points.join(' L')}`);
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
