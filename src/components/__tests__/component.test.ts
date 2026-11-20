import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Arethesis } from '../../core/arethesis';
import { Component } from '../component';
import { defineComponent } from '../decorators';
import { templateLoader } from '../template-loader';
import { HttpError } from '../../http/http-error';
import type { StoredObject, ListView } from '../../data/types';
import { flush, mockFetch, type RouteHandler } from '../../../test/helpers';
import { MockIntersectionObserver } from '../../../test/intersection';

let tagId = 0;
function component(html: string, bindConfig?: Component['bindConfig'], extra: Partial<Record<string, unknown>> = {}) {
  const tag = `x-comp-${++tagId}`;
  class C extends Component {
    static override bindConfig = bindConfig;
    bound: StoredObject[] = [];
    lists: ListView[] = [];
    items: string[] = [];
    protected override onBind(obj: StoredObject): void {
      this.bound.push(obj);
    }
    protected override onListChange(view: ListView): void {
      this.lists.push(view);
    }
    protected override onItemRender(el: Element): void {
      this.items.push(el.getAttribute('data-id') ?? '');
    }
    load<T>(fn: () => Promise<T>) {
      return this.fetchData(fn);
    }
    useEvents() {
      this.delegate('click', '[data-action]', (_e, target, id) => this.emit('action', { action: target.getAttribute('data-action'), id }));
    }
    item(id: string) {
      return this.itemElement(id);
    }
  }
  Object.assign(C.prototype, extra);
  defineComponent({ tag, html })(C);
  return { tag, C };
}

async function mount<T extends Component>(tag: string, attrs: Record<string, string> = {}): Promise<T> {
  const el = document.createElement(tag) as T;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await (el as Component).ready;
  await flush();
  return el;
}

function app(handler: RouteHandler = () => ({ body: {} })) {
  const fetch = mockFetch(handler);
  const instance = new Arethesis();
  instance.http.configure({ fetch, retry: false });
  return { app: instance, fetch };
}

beforeEach(() => MockIntersectionObserver.install());

const CARD = `
  <template id="main"><h2 data-bind="name"></h2><input data-bind="email"></template>
  <template id="loading"><p class="loading">Loading</p></template>
  <template id="error"><p data-error-message></p><button data-retry>Retry</button></template>`;

describe('Component: objects', () => {
  it('renders the main template and binds an object', async () => {
    const { app: a } = app();
    const { tag } = component(CARD, { fields: { name: {}, email: { twoWay: true } } });
    a.store.upsert('Person', '1', { name: 'Alice', email: 'alice@example.com' });
    const el = await mount<Component & { bound: StoredObject[] }>(tag);
    el.bind({ type: 'Person', id: 1 });
    await flush();
    expect(el.querySelector('h2')!.textContent).toBe('Alice');
    expect(el.dataset.state).toBe('loaded');
    a.store.upsert('Person', '1', { name: 'Alice L.' });
    await flush();
    expect(el.querySelector('h2')!.textContent).toBe('Alice L.');
    expect(el.bound).toHaveLength(2);
    expect(el.source).toEqual({ type: 'Person', id: '1' });
  });

  it('writes two-way edits back to the store and emits change', async () => {
    const { app: a } = app();
    const { tag } = component(CARD, { fields: { name: {}, email: { twoWay: true } } });
    a.store.upsert('Person', '1', { name: 'Alice', email: 'alice@example.com' });
    const el = await mount<Component>(tag);
    el.bind({ type: 'Person', id: '1' });
    await flush();
    const change = vi.fn();
    el.on('data-change', change);
    const input = el.querySelector('input')!;
    input.value = 'alice@example.org';
    input.dispatchEvent(new Event('input'));
    expect(a.store.getData('Person', '1')).toEqual({ name: 'Alice', email: 'alice@example.org' });
    expect(change).toHaveBeenCalledWith({ type: 'Person', id: '1', field: 'email', value: 'alice@example.org' }, expect.anything());
  });

  it('fetches missing objects through the type endpoint with loading/error states', async () => {
    let fail = true;
    const { app: a } = app(() => (fail ? { status: 500 } : { body: { id: 7, name: 'Fetched' } }));
    a.defineType({ name: 'Person', endpoint: 'getPerson' });
    a.defineEndpoint('getPerson', { url: '/people/:id', type: 'Person' });
    const { tag } = component(CARD, { fields: { name: {} } });
    const el = await mount<Component>(tag);
    el.bind({ type: 'Person', id: 7 });
    expect(el.dataset.state).toBe('loading');
    await flush(5);
    expect(el.dataset.state).toBe('error');
    expect(el.querySelector('[data-error-message]')!.textContent).toBe('Something went wrong on our side. Please try again.');
    fail = false;
    el.querySelector<HTMLButtonElement>('[data-retry]')!.click();
    await flush(5);
    expect(el.querySelector('h2')!.textContent).toBe('Fetched');
  });

  it('refetches when its object is invalidated', async () => {
    let n = 0;
    const { app: a, fetch } = app(() => ({ body: { id: 1, name: `v${++n}` } }));
    a.defineType({ name: 'Person', endpoint: 'getPerson' });
    a.defineEndpoint('getPerson', { url: '/people/:id', type: 'Person' });
    a.store.upsert('Person', '1', { id: 1, name: 'v0' });
    const { tag } = component(CARD, { fields: { name: {} } });
    const el = await mount<Component>(tag);
    el.bind({ type: 'Person', id: 1 });
    await flush();
    a.store.invalidate('Person', '1');
    await flush(5);
    expect(fetch.calls).toHaveLength(1);
    expect(el.querySelector('h2')!.textContent).toBe('v1');
    expect(el.hasAttribute('data-stale')).toBe(false);
  });

  it('keeps content and marks errors when a background refetch fails', async () => {
    const { app: a } = app(() => ({ status: 500 }));
    a.defineType({ name: 'Person', endpoint: 'getPerson' });
    a.defineEndpoint('getPerson', { url: '/people/:id', type: 'Person' });
    a.store.upsert('Person', '1', { name: 'cached' });
    const { tag } = component(CARD, { fields: { name: {} } });
    const el = await mount<Component>(tag);
    el.bind({ type: 'Person', id: 1 });
    await flush();
    await el.refetch();
    expect(el.querySelector('h2')!.textContent).toBe('cached');
    expect(a.store.get('Person', '1')?.status).toBe('error');
  });

  it('unbinds on delete, on unbind() and on disconnect', async () => {
    const { app: a } = app();
    const onUnbind = vi.fn();
    const { tag } = component(CARD, { fields: { name: {} } }, { onUnbind });
    a.store.upsert('Person', '1', { name: 'x' });
    const el = await mount<Component>(tag);
    el.bind({ type: 'Person', id: 1 });
    a.store.delete('Person', '1');
    expect(onUnbind).toHaveBeenCalledTimes(1);
    expect(el.dataset.state).toBe('idle');
    el.unbind();
    expect(onUnbind).toHaveBeenCalledTimes(2);
    el.unbind(); // nothing bound
    expect(onUnbind).toHaveBeenCalledTimes(2);
    el.bind({ type: 'Person', id: 1 });
    el.remove();
    expect(a.store.subscriberCount('Person', '1')).toBe(0);
  });

  it('binds itself from data-source and keeps server-rendered content with data-hydrate', async () => {
    const { app: a } = app();
    a.store.upsert('Person', '5', { name: 'Island' });
    const { tag } = component(CARD, { fields: { name: {} } });
    const el = await mount<Component>(tag, { 'data-source': 'Person:5' });
    await flush();
    expect(el.querySelector('h2')!.textContent).toBe('Island');

    const ssr = document.createElement(tag);
    ssr.setAttribute('data-hydrate', '');
    ssr.setAttribute('data-source', 'Person:5');
    ssr.innerHTML = '<h2 data-bind="name">Server text</h2><em>kept</em>';
    document.body.appendChild(ssr);
    await flush();
    expect(ssr.querySelector('em')).not.toBeNull();
    expect(ssr.querySelector('h2')!.textContent).toBe('Island');
  });

  it('renders loading and error templates around fetchData and keeps the binding', async () => {
    const { app: a } = app();
    a.store.upsert('Person', '1', { name: 'Alice' });
    const { tag } = component(CARD, { fields: { name: {} } });
    const el = await mount<Component & { load: <T>(fn: () => Promise<T>) => Promise<T | null> }>(tag);
    el.bind({ type: 'Person', id: 1 });
    await flush();
    let release!: (v: number) => void;
    const p = el.load(() => new Promise<number>(r => (release = r)));
    await flush();
    expect(el.querySelector('.loading')).not.toBeNull();
    release(1);
    expect(await p).toBe(1);
    // Regression: the bound data is rendered again after fetchData.
    expect(el.querySelector('h2')!.textContent).toBe('Alice');
    expect(await el.load(() => Promise.reject(new HttpError('x', 404)))).toBeNull();
    expect(el.querySelector('[data-error-message]')!.textContent).toBe('This item could not be found.');
    await el.load(() => Promise.reject(new Error('Plain failure')));
    expect(el.querySelector('[data-error-message]')!.textContent).toBe('Plain failure');
    await el.load(() => Promise.reject('string'));
    expect(el.dataset.state).toBe('error');
  });

  it('ignores stale concurrent renders (regression)', async () => {
    const { tag } = component(CARD);
    app();
    const el = await mount<Component & { render(id: string): Promise<boolean> }>(tag);
    const r = el as unknown as { render(id: string): Promise<boolean> };
    const [first, second] = await Promise.all([r.render('loading'), r.render('main')]);
    expect(first).toBe(false);
    expect(second).toBe(true);
    expect(el.querySelectorAll('h2')).toHaveLength(1);
    expect(el.querySelector('.loading')).toBeNull();
  });

  it('formats HTTP errors for people', () => {
    app();
    const { C } = component('<b></b>');
    const fmt = (C.prototype as unknown as { formatErrorMessage(e: Error): string }).formatErrorMessage;
    expect(fmt(new HttpError('x', 0))).toMatch(/offline/);
    expect(fmt(new HttpError('x', 401))).toMatch(/sign in/);
    expect(fmt(new HttpError('x', 403))).toMatch(/permission/);
    expect(fmt(new HttpError('x', 408))).toMatch(/too long/);
    expect(fmt(new HttpError('x', 429))).toMatch(/Too many/);
    expect(fmt(new HttpError('Teapot', 418))).toBe('Teapot');
    expect(fmt(new Error(''))).toBe('Something went wrong.');
  });
});

const LIST = `
  <template id="main"><ul data-items></ul></template>
  <template id="item"><li><span data-bind="name"></span><button data-action="remove">x</button></li></template>
  <template id="empty"><p class="empty">Nothing here</p></template>
  <template id="loading"><p class="loading">Loading…</p></template>
  <template id="error"><p data-error-message></p><button data-retry>Retry</button></template>`;

describe('Component: lists', () => {
  function listApp(pages: Record<string, { items: Array<{ id: number; name: string }>; next: string | null }>) {
    const ctx = app(url => {
      const page = pages[url.searchParams.get('cursor') ?? 'first'];
      return page ? { body: { data: page.items, next: page.next } } : { status: 500 };
    });
    ctx.app.defineEndpoint('people', { url: '/people', type: 'Person', list: true, mapping: { dataPath: 'data' }, pagination: { cursorPath: 'next' } });
    return ctx;
  }

  const config = { fields: { name: {} }, emptyTemplate: 'empty', loadingTemplate: 'loading', errorTemplate: 'error', infiniteScroll: { threshold: 100 } };

  it('loads, renders items, reconciles updates and pages with infinite scroll', async () => {
    const { app: a } = listApp({
      first: { items: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bo' }], next: 'p2' },
      p2: { items: [{ id: 3, name: 'Cy' }], next: null },
    });
    const { tag } = component(LIST, config);
    const el = await mount<Component & { items: string[]; item(id: string): Element | undefined }>(tag);
    const view = el.bindList({ type: 'Person', endpoint: 'people', pageSize: 2 });
    await flush(5);
    const names = () => Array.from(el.querySelectorAll('li [data-bind=name]')).map(n => n.textContent);
    expect(names()).toEqual(['Alice', 'Bo']);
    const first = el.item('1');
    a.store.upsert('Person', '1', { name: 'Alice L.' });
    expect(names()).toEqual(['Alice L.', 'Bo']);
    expect(el.item('1')).toBe(first); // same element, patched in place
    a.listViews.move(view.id, '2', 0);
    await flush();
    expect(names()).toEqual(['Bo', 'Alice L.']);
    expect(el.item('1')).toBe(first);

    const observer = MockIntersectionObserver.latest()!;
    expect(observer.options.rootMargin).toBe('0px 0px 100px 0px');
    observer.trigger();
    await flush(5);
    expect(names()).toEqual(['Bo', 'Alice L.', 'Cy']);
    expect(view.hasMore).toBe(false);
    a.store.delete('Person', '2');
    a.listViews.removeFromAll('Person', '2');
    await flush();
    expect(names()).toEqual(['Alice L.', 'Cy']);
    expect(el.items).toContain('3');
  });

  it('replaces the rows when bound to another list, and removes them when unbound (regression)', async () => {
    const ctx = app(url => {
      const team = url.searchParams.get('team');
      const items = team === 'b' ? [{ id: 3, name: 'Cy' }] : team === 'empty' ? [] : [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bo' }];
      return { body: { data: items, next: team === 'a' ? 'more' : null } };
    });
    ctx.app.defineEndpoint('people', { url: '/people', type: 'Person', list: true, mapping: { dataPath: 'data' }, pagination: { cursorPath: 'next' } });
    const { tag } = component(LIST, config);
    const el = await mount<Component>(tag);
    const names = () => Array.from(el.querySelectorAll('li [data-bind=name]')).map(n => n.textContent);
    el.bindList({ type: 'Person', endpoint: 'people', filters: { team: 'a' } });
    await flush(5);
    expect(names()).toEqual(['Alice', 'Bo']);
    expect(el.querySelector('.ar-scroll-sentinel')).not.toBeNull();

    // A different list: only its rows remain, with one sentinel after them.
    el.bindList({ type: 'Person', endpoint: 'people', filters: { team: 'b' } });
    await flush(5);
    expect(names()).toEqual(['Cy']);
    expect(el.querySelectorAll('.ar-scroll-sentinel')).toHaveLength(1);
    expect(el.querySelector('ul')!.lastElementChild!.className).toBe('ar-scroll-sentinel');

    // An empty list: the old rows go and the empty template shows.
    el.bindList({ type: 'Person', endpoint: 'people', filters: { team: 'empty' } });
    await flush(5);
    expect(names()).toEqual([]);
    expect(el.querySelector('.empty')).not.toBeNull();

    // Unbinding removes the list's rows and placeholders; binding again doesn't duplicate.
    el.bindList({ type: 'Person', endpoint: 'people', filters: { team: 'b' } });
    await flush(5);
    expect(el.querySelector('.empty')).toBeNull();
    el.unbind();
    expect(names()).toEqual([]);
    el.bindList({ type: 'Person', endpoint: 'people', filters: { team: 'b' } });
    await flush(5);
    expect(names()).toEqual(['Cy']);
  });

  it('keeps its binding when moved in the DOM: live rows, no duplicates', async () => {
    const { app: a } = listApp({ first: { items: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bo' }], next: null } });
    const { tag } = component(LIST, { fields: { name: {} } });
    const el = await mount<Component>(tag);
    el.bindList({ type: 'Person', endpoint: 'people' });
    await flush(5);
    const names = () => Array.from(el.querySelectorAll('li [data-bind=name]')).map(n => n.textContent);
    // Move it somewhere else in the document.
    const elsewhere = document.createElement('section');
    document.body.appendChild(elsewhere);
    elsewhere.appendChild(el);
    await flush(5);
    expect(names()).toEqual(['Alice', 'Bo']);
    expect(el.source).not.toBeNull();
    a.store.upsert('Person', '2', { name: 'Bo B.' });
    expect(names()).toEqual(['Alice', 'Bo B.']); // still live
    // Unbinding while detached means it stays unbound when re-attached.
    el.remove();
    el.unbind();
    document.body.appendChild(el);
    await flush(5);
    expect(el.source).toBeNull();
    expect(names()).toEqual([]);
  });

  it('shows the empty template and the error template with retry', async () => {
    const pages: Record<string, { items: Array<{ id: number; name: string }>; next: string | null }> = {};
    const { app: a } = listApp(pages);
    const { tag } = component(LIST, config);
    const el = await mount<Component>(tag);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    el.bindList({ type: 'Person', endpoint: 'people' });
    await flush(5);
    expect(el.dataset.state).toBe('error');
    expect(el.querySelector('[data-error-message]')!.textContent).toMatch(/Something went wrong/);
    pages.first = { items: [], next: null };
    el.querySelector<HTMLButtonElement>('[data-retry]')!.click();
    await flush(5);
    expect(el.querySelector('.empty')).not.toBeNull();
    expect(el.dataset.state).toBe('empty');
    pages.first = { items: [{ id: 9, name: 'New' }], next: null };
    await a.listViews.refresh(el.source as ListView);
    await flush();
    expect(el.querySelector('.empty')).toBeNull();
    expect(el.querySelectorAll('li')).toHaveLength(1);
    err.mockRestore();
  });

  it('binds lists declaratively and delegates item events', async () => {
    listApp({ first: { items: [{ id: 1, name: 'Alice' }], next: null } });
    const { tag } = component(LIST, { fields: { name: {} } });
    const el = await mount<Component & { useEvents(): void }>(tag, { 'data-list': 'people', 'data-filters': '{"team":"core"}', 'data-page-size': '10' });
    el.useEvents();
    await flush(5);
    const action = vi.fn();
    el.on('action', action);
    el.querySelector<HTMLButtonElement>('[data-action=remove]')!.click();
    expect(action).toHaveBeenCalledWith({ action: 'remove', id: '1' }, expect.anything());
    expect((el.source as ListView).filters).toEqual({ team: 'core' });
    expect((el.source as ListView).pageSize).toBe(10);
  });

  it('reports bad declarative configs', async () => {
    app();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tag } = component(LIST);
    await mount(tag, { 'data-list': 'unknown' });
    await mount(tag, { 'data-list': 'unknown', 'data-type': 'X', 'data-filters': '{bad' });
    await flush();
    const messages = err.mock.calls.map(c => String(c[0]));
    expect(messages.some(m => m.includes('unknown endpoint or missing data-type'))).toBe(true);
    expect(messages.some(m => m.includes('data-filters must be JSON'))).toBe(true);
    expect(messages.some(m => m.includes('failed to load list'))).toBe(true);
    err.mockRestore();
  });
});

describe('Component: misc', () => {
  it('cleans up listeners and mixins on disconnect', async () => {
    app();
    const { tag } = component('<template id="main"><div class="t" title="hi"></div></template>');
    const el = await mount<Component & { useMixin: Component['useMixin'] }>(tag);
    const handler = vi.fn();
    (el as unknown as { listen(t: EventTarget, type: string, h: () => void): void }).listen(window, 'resize', handler);
    const instance = (el as unknown as { useMixin(n: string, o?: object, e?: HTMLElement): unknown }).useMixin('tooltip', {}, el.querySelector('.t')!);
    expect(instance).not.toBeNull();
    el.remove();
    window.dispatchEvent(new Event('resize'));
    expect(handler).not.toHaveBeenCalled();
    expect(el.querySelector('.t')!.getAttribute('title')).toBe('hi'); // tooltip restored the title
  });

  it('renders components without templates', async () => {
    app();
    const tag = `x-plain-${++tagId}`;
    class Plain extends Component {}
    defineComponent({ tag })(Plain);
    const el = document.createElement(tag) as Plain;
    el.innerHTML = '<span>child</span>';
    document.body.appendChild(el);
    await el.ready;
    expect(el.innerHTML).toBe('<span>child</span>');
  });
});

describe('Component: templateId', () => {
  const AUTH = `
    <template id="login"><form class="login"><span data-bind="name"></span></form></template>
    <template id="loading"><p class="loading">Loading…</p></template>
    <template id="item"><li data-bind="name"></li></template>`;

  it('renders the template named by templateId on connect, from a template file (regression)', async () => {
    templateLoader.setFetch((async (url: string) => new Response(url === '/t.html' ? AUTH : 'nope', { status: url === '/t.html' ? 200 : 404 })) as typeof fetch);
    class XAuth extends Component {}
    defineComponent({ tag: 'x-auth-file', template: '/t.html', templateId: 'login' })(XAuth);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = await mount<Component>('x-auth-file');
    expect(el.querySelector('form.login')).not.toBeNull();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    templateLoader.setFetch(globalThis.fetch);
  });

  it('restores the templateId template after loading, for objects and lists', async () => {
    const { app: a } = app(url => (url.pathname === '/accounts' ? { body: { data: [{ id: 2, name: 'Bo' }, { id: 3, name: 'Cy' }] } } : { body: { id: 1, name: 'Alice' } }));
    a.defineType({ name: 'Account', endpoint: 'getAccount' });
    a.defineEndpoint('getAccount', { url: '/accounts/:id', type: 'Account' });
    a.defineEndpoint('listAccounts', { url: '/accounts', type: 'Account', list: true, mapping: { dataPath: 'data' } });
    class XAuthInline extends Component {
      static override bindConfig = { fields: { name: {} }, loadingTemplate: 'loading' };
    }
    defineComponent({ tag: 'x-auth-inline', html: AUTH, templateId: 'login' })(XAuthInline);
    const el = await mount<Component>('x-auth-inline');
    expect(el.querySelector('form.login')).not.toBeNull();
    // Bound to an object that has to be fetched: back to #login, filled in, once loaded.
    el.bind({ type: 'Account', id: 1 });
    await flush(5);
    expect(el.querySelector('form.login [data-bind=name]')!.textContent).toBe('Alice');

    // Lists render inside #login too.
    class XAccounts extends Component {
      static override bindConfig = { fields: { name: {} }, itemsSelector: 'ul' };
    }
    defineComponent({ tag: 'x-accounts', html: '<template id="board"><ul class="board"></ul></template><template id="item"><li data-bind="name"></li></template>', templateId: 'board' })(XAccounts);
    const list = await mount<Component>('x-accounts');
    list.bindList({ type: 'Account', endpoint: 'listAccounts' });
    await flush(5);
    expect(Array.from(list.querySelectorAll('ul.board li')).map(li => li.textContent)).toEqual(['Bo', 'Cy']);
  });

  it("still defaults to 'main'", async () => {
    const { tag } = component('<template id="main"><p class="main">Main</p></template>');
    const el = await mount<Component>(tag);
    expect(el.querySelector('p.main')).not.toBeNull();
  });
});

describe('list placeholders', () => {
  it('are direct children of the list, so a loading <li> stays inside its <ul>', async () => {
    const app = new Arethesis();
    @defineComponent({
      tag: 'placeholder-list',
      html: `<template id="main"><ul data-items></ul></template>
        <template id="item"><li data-bind="name"></li></template>
        <template id="loading"><li class="skeleton"></li><li class="skeleton"></li></template>
        <template id="empty">Nothing here</template>`,
    })
    class PlaceholderList extends Component {
      static override bindConfig = { fields: { name: {} }, loadingTemplate: 'loading', emptyTemplate: 'empty' };
    }
    const el = document.createElement('placeholder-list') as PlaceholderList;
    document.body.appendChild(el);
    await el.ready;
    const view = app.listViews.getOrCreate({ type: 'PlaceholderThing', id: 'placeholders' });
    el.bind(view);
    await flush();
    const ul = el.querySelector('ul')!;
    expect(Array.from(ul.children).map(c => c.tagName)).toEqual(['LI', 'LI']);
    expect(ul.querySelectorAll(':scope > [data-placeholder="loading"]')).toHaveLength(2);
    app.listViews.populate(view.id, []);
    await flush();
    expect(ul.children).toHaveLength(1);
    expect(ul.firstElementChild!.textContent).toBe('Nothing here');
    expect(ul.firstElementChild!.getAttribute('data-placeholder')).toBe('empty');
  });
});
