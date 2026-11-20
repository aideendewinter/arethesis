/**
 * Component: the base class for Light DOM custom elements.
 *
 * A component renders a template into its own children (no Shadow DOM, so your
 * global CSS applies) and binds to data in the store: one object, or a ListView
 * rendered item by item. When the data changes, only the affected DOM is patched.
 *
 * @example
 * ```ts
 * @defineComponent({ tag: 'person-card', html: `
 *   <template id="main">
 *     <h2 data-bind="name"></h2>
 *     <a data-bind="email"></a>
 *   </template>
 *   <template id="loading"><div class="skeleton"></div></template>` })
 * class PersonCard extends Component {
 *   static bindConfig = { fields: { name: {}, email: { displayType: 'link', format: v => `mailto:${v}` } } };
 * }
 *
 * // <person-card data-source="Person:42"></person-card>  (binds itself on connect)
 * // or: card.bind({ type: 'Person', id: 42 });
 * ```
 *
 * @module components/component
 */

import type { BindConfig } from '../binding/types';
import type { ListView, ListViewConfig, ObjectRef, StoredObject, SubscriptionEvent } from '../data/types';
import type { BindSource, ComponentMetadata, ComponentState, DataFetcher } from './types';
import type { MixinInstance } from '../mixins/types';
import { getComponentMetadata } from './decorators';
import { templateLoader } from './template-loader';
import { getRuntime } from './runtime';
import { mixinRegistry } from '../mixins/registry';
import { HttpError } from '../http/http-error';

/** Resolves once the element's children are in the DOM. */
function childrenParsed(): Promise<void> {
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    return new Promise(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
  }
  return Promise.resolve();
}

function isListView(source: BindSource): source is ListView {
  return 'ids' in source && 'status' in source && Array.isArray((source as ListView).ids);
}

type Bound =
  | { kind: 'object'; ref: { type: string; id: string }; config?: BindConfig }
  | { kind: 'list'; view: ListView; config?: BindConfig };

export abstract class Component extends HTMLElement {
  /** Default bind config for instances of this class. */
  static bindConfig?: BindConfig;

  /** Current state; mirrored to the `data-state` attribute for CSS. */
  protected state: ComponentState = 'idle';
  protected error: Error | null = null;
  /** The template for the main state: `defineComponent`'s `templateId`, or `'main'`. */
  protected mainTemplateId: string = this.metadata?.templateId ?? 'main';
  protected loadingTemplateId = 'loading';
  protected errorTemplateId = 'error';

  #bound: Bound | null = null;
  /** The binding to restore when a disconnected component is connected again (it was moved). */
  #suspended: Bound | null = null;
  #subscriptions: Array<() => void> = [];
  #lifecycle: AbortController | null = null;
  #mixins: MixinInstance[] = [];
  #renderToken = 0;
  #renderedTemplate: string | null = null;
  #readyResolve: () => void = () => {};
  #items = new Map<string, Element>();
  #sentinel: HTMLElement | null = null;
  #observer: IntersectionObserver | null = null;
  #hydrated = false;

  /** Resolves once the template has rendered for the first time. */
  readonly ready: Promise<void> = new Promise(resolve => {
    this.#readyResolve = resolve;
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async connectedCallback(): Promise<void> {
    this.#lifecycle = new AbortController();
    if (!this.#hydrated) {
      this.#hydrated = true;
      // Children may not be parsed yet (server-rendered islands, innerHTML).
      await childrenParsed();
      if (this.hasAttribute('data-hydrate') || !this.metadata?.templateKey) {
        // Keep server-rendered content and bind to it.
        this.#renderedTemplate = this.mainTemplateId;
      } else if (this.#renderedTemplate === null) {
        await this.render(this.mainTemplateId);
      }
      this.#readyResolve();
    }
    this.onConnected();
    // Moved in the DOM (disconnected, then connected again): pick up where it left off.
    const suspended = this.#suspended;
    this.#suspended = null;
    if (suspended && !this.#bound) this.bind(suspended.kind === 'list' ? suspended.view : suspended.ref, suspended.config);
    this.#bindFromAttributes();
  }

  disconnectedCallback(): void {
    this.#lifecycle?.abort();
    this.#lifecycle = null;
    for (const m of this.#mixins.splice(0)) m.destroy();
    this.#suspended = this.#bound;
    this.#teardownBinding();
    this.onDisconnected();
  }

  /** Abort signal for listeners that should be removed on disconnect. */
  protected get signal(): AbortSignal {
    if (!this.#lifecycle) this.#lifecycle = new AbortController();
    return this.#lifecycle.signal;
  }

  /** `addEventListener` that is cleaned up automatically on disconnect. */
  protected listen<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    type: K | string,
    handler: (event: HTMLElementEventMap[K]) => void,
    options: AddEventListenerOptions = {}
  ): void {
    target.addEventListener(type, handler as EventListener, { ...options, signal: this.signal });
  }

  /**
   * Delegated event handler: `handler` runs when `type` fires on an element
   * matching `selector` inside this component. The item id (from the closest
   * `[data-id]`) is passed for collection items.
   */
  protected delegate(type: string, selector: string, handler: (event: Event, target: Element, itemId: string | null) => void): void {
    this.listen(this, type, (event: Event) => {
      const target = (event.target as Element | null)?.closest?.(selector);
      if (!target || !this.contains(target)) return;
      handler(event, target, target.closest('[data-id]')?.getAttribute('data-id') ?? null);
    });
  }

  /** Apply a mixin to this component (or a child); destroyed on disconnect. */
  protected useMixin(name: string, options: Record<string, unknown> = {}, element: HTMLElement = this): MixinInstance | null {
    const instance = mixinRegistry.apply(element, name, options);
    if (instance) this.#mixins.push(instance);
    return instance;
  }

  // ── Events ───────────────────────────────────────────────────────────────

  /**
   * Listen for a component event; returns an unsubscribe function. Component
   * events are CustomEvents; pick names the DOM doesn't use (e.g. `row-select`
   * rather than `select`), since native events bubble through components too.
   */
  on<T = unknown>(event: string, handler: (detail: T, event: CustomEvent<T>) => void): () => void {
    const listener = (e: Event): void => handler((e as CustomEvent<T>).detail, e as CustomEvent<T>);
    this.addEventListener(event, listener);
    return () => this.removeEventListener(event, listener);
  }

  /** Dispatch a bubbling CustomEvent. */
  emit<T = unknown>(event: string, detail?: T): boolean {
    return this.dispatchEvent(new CustomEvent(event, { detail, bubbles: true, composed: true, cancelable: true }));
  }

  // ── Templates ────────────────────────────────────────────────────────────

  protected get metadata(): ComponentMetadata | undefined {
    return getComponentMetadata(this.constructor as CustomElementConstructor);
  }

  /** Whether the template file defines a template with this id. */
  protected async hasTemplate(templateId: string): Promise<boolean> {
    const key = this.metadata?.templateKey;
    return key ? templateLoader.has(key, templateId).catch(() => false) : false;
  }

  /** Load a template fragment by id. */
  protected async loadTemplate(templateId: string): Promise<DocumentFragment | null> {
    const key = this.metadata?.templateKey;
    if (!key) return null;
    try {
      return await templateLoader.load(key, templateId);
    } catch (err) {
      console.error(`<${this.localName}>: ${String((err as Error).message ?? err)}`);
      return null;
    }
  }

  /**
   * Replace this component's content with a template. Concurrent renders are
   * safe: only the most recent call writes to the DOM.
   */
  protected async render(templateId: string): Promise<boolean> {
    const token = ++this.#renderToken;
    const fragment = await this.loadTemplate(templateId);
    if (token !== this.#renderToken || !fragment) return false;
    this.replaceChildren(fragment);
    this.#renderedTemplate = templateId;
    this.#items.clear();
    this.#sentinel = null;
    this.#observer?.disconnect();
    this.#observer = null;
    return true;
  }

  #setState(state: ComponentState): void {
    this.state = state;
    this.dataset.state = state;
    this.toggleAttribute('aria-busy', state === 'loading');
  }

  // ── Binding ──────────────────────────────────────────────────────────────

  /** The bind config in effect: the argument to `bind()`, else `static bindConfig`. */
  protected get bindConfig(): BindConfig | undefined {
    return this.#bound?.config ?? (this.constructor as typeof Component).bindConfig;
  }

  /** What this component is bound to. */
  get source(): BindSource | null {
    if (!this.#bound) return null;
    return this.#bound.kind === 'object' ? this.#bound.ref : this.#bound.view;
  }

  /**
   * Bind to one object (`{ type, id }`) or a ListView. Rebinding replaces the
   * previous binding. Missing objects are fetched when their type has an `endpoint`.
   */
  bind(source: BindSource, config?: BindConfig): void {
    this.#suspended = null;
    this.#teardownBinding();
    const { store, listViews } = getRuntime();

    if (isListView(source)) {
      this.#bound = { kind: 'list', view: source, config };
      this.#subscriptions.push(listViews.subscribe(source.id, view => void this.#renderList(view)));
      this.#subscriptions.push(store.subscribeToType(source.type, (obj, event) => this.#handleItemChange(obj, event)));
      void this.ready.then(() => this.#renderList(source));
      if (source.status === 'idle' || source.status === 'stale') {
        listViews.load(source).catch(err => console.error(`<${this.localName}>: failed to load list`, err));
      }
      return;
    }

    const ref = { type: source.type, id: String(source.id) };
    this.#bound = { kind: 'object', ref, config };
    this.#subscriptions.push(store.subscribe(ref.type, ref.id, (obj, event) => this.#handleObjectChange(obj, event)));
    const existing = store.get(ref.type, ref.id);
    if (existing) {
      void this.ready.then(() => this.#renderObject(existing));
      if (existing.status === 'stale') void this.refetch();
    } else if (store.getTypeConfig(ref.type).endpoint) {
      void this.refetch();
    }
  }

  /** Bind to a ListView created from a config. */
  bindList(config: ListViewConfig, bindConfig?: BindConfig): ListView {
    const view = getRuntime().listViews.getOrCreate(config);
    this.bind(view, bindConfig);
    return view;
  }

  /** Stop listening to the bound source. */
  unbind(): void {
    this.#suspended = null;
    const had = this.#bound !== null;
    this.#teardownBinding();
    if (had) {
      this.#setState('idle');
      this.onUnbind();
    }
  }

  #teardownBinding(): void {
    for (const off of this.#subscriptions.splice(0)) off();
    this.#observer?.disconnect();
    this.#observer = null;
    const { binder } = getRuntime();
    if (this.#bound) binder.unbind(this);
    // The rows, placeholder and sentinel belong to the list binding: remove them
    // with it, so a new binding starts clean instead of adding to stale rows.
    if (this.#bound?.kind === 'list') {
      const container = this.#itemsContainer();
      this.#clearItems(container);
      this.#sentinel?.remove();
      this.#sentinel = null;
      container.removeAttribute('aria-busy');
    } else {
      for (const el of this.#items.values()) binder.unbind(el);
      this.#items.clear();
    }
    this.#bound = null;
  }

  /** Declarative islands: `data-source="Type:id"` or `data-list="endpointName"`. */
  #bindFromAttributes(): void {
    if (this.#bound) return;
    const src = this.getAttribute('data-source');
    if (src && src.includes(':')) {
      const i = src.indexOf(':');
      this.bind({ type: src.slice(0, i), id: src.slice(i + 1) });
      return;
    }
    const endpoint = this.getAttribute('data-list');
    if (endpoint) {
      const { http } = getRuntime();
      const type = this.getAttribute('data-type') ?? http.getEndpoint(endpoint)?.type;
      if (!type) {
        console.error(`<${this.localName} data-list="${endpoint}">: unknown endpoint or missing data-type`);
        return;
      }
      let filters: Record<string, unknown> = {};
      try {
        filters = JSON.parse(this.getAttribute('data-filters') ?? '{}');
      } catch {
        console.error(`<${this.localName}>: data-filters must be JSON`);
      }
      const pageSize = Number(this.getAttribute('data-page-size')) || undefined;
      this.bindList({ type, endpoint, filters, pageSize });
    }
  }

  /** Refetch the bound object or reload the bound list. */
  async refetch(): Promise<void> {
    const { store, http, listViews } = getRuntime();
    if (!this.#bound) return;
    if (this.#bound.kind === 'list') {
      await listViews.refresh(this.#bound.view).catch(() => undefined);
      return;
    }
    const { type, id } = this.#bound.ref;
    const endpoint = store.getTypeConfig(type).endpoint;
    if (!endpoint) return;
    const hadData = store.has(type, id);
    if (hadData) {
      store.setStatus(type, id, 'updating');
    } else {
      this.#setState('loading');
      await this.#renderIfDefined(this.loadingTemplateId);
    }
    try {
      await http.fetchEndpoint(endpoint, { id });
    } catch (err) {
      if (!this.#bound || this.#bound.kind !== 'object' || this.#bound.ref.id !== id) return;
      if (hadData) {
        store.setStatus(type, id, 'error');
      } else {
        await this.showError(err);
      }
    }
  }

  async #renderIfDefined(templateId: string): Promise<boolean> {
    if (this.#renderedTemplate === templateId) return true;
    if (!(await this.hasTemplate(templateId))) return false;
    return this.render(templateId);
  }

  #handleObjectChange(obj: StoredObject | null, event: SubscriptionEvent): void {
    if (event === 'delete') {
      this.#setState('idle');
      this.onUnbind();
      return;
    }
    if (!obj) return;
    if (event === 'invalidate') {
      this.dataset.stale = '';
      if (getRuntime().store.subscriberCount(obj.type, obj.id) > 0) void this.refetch();
      return;
    }
    void this.#renderObject(obj);
  }

  async #renderObject(obj: StoredObject): Promise<void> {
    const { binder } = getRuntime();
    if (this.#renderedTemplate !== this.mainTemplateId) {
      const rendered = await this.render(this.mainTemplateId);
      if (!rendered && this.metadata?.templateKey) return;
      binder.unbind(this);
    }
    // The binding may have changed while the template loaded.
    if (this.#bound?.kind !== 'object' || this.#bound.ref.id !== obj.id || this.#bound.ref.type !== obj.type) return;
    this.#setState('loaded');
    this.toggleAttribute('data-updating', obj.status === 'updating');
    if (obj.status !== 'stale') delete this.dataset.stale;
    const config = this.bindConfig;
    if (config) {
      const handle = binder.getHandle(this);
      if (handle) handle.update(obj.data);
      else binder.bind(this, obj.data, this.#withWriteBack(config, obj.type, obj.id));
    }
    this.onBind(obj);
  }

  /** Two-way fields write back to the store unless the config has its own `onChange`. */
  #withWriteBack(config: BindConfig, type: string, id: string): BindConfig {
    if (config.onChange) return config;
    return {
      ...config,
      onChange: (field, value) => {
        const { store } = getRuntime();
        const current = store.getData<Record<string, unknown>>(type, id) ?? {};
        store.upsert(type, id, { ...current, [field]: value }, { source: 'local', merge: 'replace' });
        this.emit('data-change', { type, id, field, value });
      },
    };
  }

  // ── Lists ────────────────────────────────────────────────────────────────

  #itemsContainer(): Element {
    const selector = this.bindConfig?.itemsSelector ?? '[data-items]';
    return this.querySelector(selector) ?? this;
  }

  async #renderList(view: ListView): Promise<void> {
    if (this.#bound?.kind !== 'list' || this.#bound.view.id !== view.id) return;
    await this.ready;
    if (this.#renderedTemplate !== this.mainTemplateId) {
      if (!(await this.render(this.mainTemplateId)) && this.metadata?.templateKey) return;
    }
    const config = this.bindConfig ?? { fields: {} };
    const container = this.#itemsContainer();
    container.setAttribute('aria-busy', String(view.status === 'loading' || view.status === 'loading-more'));

    if (view.ids.length === 0) {
      this.#clearItems(container);
      const placeholder = view.status === 'loading' || view.status === 'idle' ? config.loadingTemplate
        : view.status === 'error' ? config.errorTemplate
          : config.emptyTemplate;
      this.#setState(view.status === 'error' ? 'error' : view.status === 'loaded' ? 'empty' : 'loading');
      if (placeholder) await this.#renderPlaceholder(container, placeholder, view.error);
      this.onListChange(view);
      return;
    }

    removePlaceholders(container);
    this.#setState(view.status === 'error' ? 'error' : 'loaded');
    await this.#reconcile(container, view, config);
    if (config.infiniteScroll) this.#ensureSentinel(container, view, config);
    this.onListChange(view);
  }

  #clearItems(container: Element): void {
    const { binder } = getRuntime();
    for (const el of this.#items.values()) {
      binder.unbind(el);
      el.remove();
    }
    this.#items.clear();
    removePlaceholders(container);
  }

  async #renderPlaceholder(container: Element, templateId: string, error?: Error): Promise<void> {
    const fragment = await this.loadTemplate(templateId);
    if (!fragment) return;
    // Mark the template's own elements rather than wrapping them, so a
    // loading `<li>` stays a direct child of its `<ul>`/`<ol>`.
    for (const node of Array.from(fragment.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) continue;
      if (node.nodeType === Node.TEXT_NODE && node.textContent!.trim()) {
        const span = document.createElement('span');
        node.replaceWith(span);
        span.append(node);
      } else {
        node.remove();
      }
    }
    const nodes = Array.from(fragment.children);
    for (const node of nodes) node.setAttribute('data-placeholder', templateId);
    removePlaceholders(container);
    container.append(fragment);
    if (error) {
      const msg = nodes.map(n => n.matches('[data-error-message]') ? n : n.querySelector('[data-error-message]')).find(Boolean);
      if (msg) msg.textContent = this.formatErrorMessage(error);
    }
    const retry = nodes.map(n => n.matches('[data-retry]') ? n : n.querySelector('[data-retry]')).find(Boolean);
    retry?.addEventListener('click', () => void this.retry(), { once: true });
  }

  async #reconcile(container: Element, view: ListView, config: BindConfig): Promise<void> {
    const { store, binder } = getRuntime();
    const templateId = config.itemTemplate ?? 'item';
    const wanted = new Set(view.ids);

    for (const [id, el] of this.#items) {
      if (!wanted.has(id)) {
        binder.unbind(el);
        el.remove();
        this.#items.delete(id);
      }
    }

    let itemTemplate: DocumentFragment | null = null;
    let previous: Element | null = null;
    for (const id of view.ids) {
      const obj = store.get(view.type, id);
      if (!obj) continue;
      let el = this.#items.get(id);
      if (!el) {
        itemTemplate ??= await this.loadTemplate(templateId);
        if (!itemTemplate) return;
        // Bail if the list changed while the template loaded.
        if (this.#bound?.kind !== 'list' || this.#bound.view.id !== view.id) return;
        el = (itemTemplate.cloneNode(true) as DocumentFragment).firstElementChild ?? document.createElement('div');
        el.setAttribute('data-id', id);
        this.#items.set(id, el);
        binder.bind(el, obj.data, this.#withWriteBack(config, view.type, id));
        this.onItemRender(el, obj);
      }
      // Move into position only if needed (keeps focus and avoids layout churn).
      const expectedNext: ChildNode | null = previous ? previous.nextSibling : container.firstChild;
      if (el !== expectedNext) {
        if (previous) previous.after(el);
        else container.prepend(el);
      }
      previous = el;
    }
    if (this.#sentinel && this.#sentinel.parentElement === container) container.append(this.#sentinel);
  }

  #handleItemChange(obj: StoredObject | null, event: SubscriptionEvent): void {
    if (!obj || event !== 'update') return;
    const el = this.#items.get(obj.id);
    if (!el) return;
    getRuntime().binder.update(el, obj.data);
    el.toggleAttribute('data-pending', obj.sources.has('optimistic') && [...obj.sources].pop() === 'optimistic');
    this.onItemRender(el, obj);
  }

  #ensureSentinel(container: Element, view: ListView, config: BindConfig): void {
    const opts = typeof config.infiniteScroll === 'object' ? config.infiniteScroll : {};
    if (!this.#sentinel) {
      this.#sentinel = document.createElement('div');
      this.#sentinel.className = 'ar-scroll-sentinel';
      this.#sentinel.setAttribute('aria-hidden', 'true');
    }
    if (this.#sentinel.parentElement !== container) container.append(this.#sentinel);
    if (!view.hasMore) {
      this.#observer?.disconnect();
      this.#observer = null;
      return;
    }
    if (typeof IntersectionObserver === 'undefined') return;
    // Re-observing fires a fresh callback, so a still-visible sentinel loads the next page.
    this.#observer?.disconnect();
    const root = opts.root === 'self' ? this : null;
    this.#observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && this.#bound?.kind === 'list') {
        getRuntime().listViews.loadMore(this.#bound.view).catch(err => console.error('loadMore failed', err));
      }
    }, { root, rootMargin: `0px 0px ${opts.threshold ?? 300}px 0px` });
    this.#observer.observe(this.#sentinel);
  }

  /** Rendered element for a collection item. */
  protected itemElement(id: string): Element | undefined {
    return this.#items.get(id);
  }

  // ── Fetching & errors ────────────────────────────────────────────────────

  /**
   * Run `fetcher` with loading and error templates. On success the main
   * template is restored and the current binding re-applied.
   */
  protected async fetchData<T>(fetcher: DataFetcher<T>): Promise<T | null> {
    this.error = null;
    this.#setState('loading');
    await this.#renderIfDefined(this.loadingTemplateId);
    try {
      const data = await fetcher();
      await this.#restoreMain();
      return data;
    } catch (err) {
      await this.showError(err);
      return null;
    }
  }

  async #restoreMain(): Promise<void> {
    if (this.#renderedTemplate !== this.mainTemplateId) {
      await this.render(this.mainTemplateId);
      getRuntime().binder.unbind(this);
    }
    this.#setState('loaded');
    if (this.#bound?.kind === 'object') {
      const obj = getRuntime().store.get(this.#bound.ref.type, this.#bound.ref.id);
      if (obj) await this.#renderObject(obj);
    } else if (this.#bound?.kind === 'list') {
      await this.#renderList(this.#bound.view);
    }
  }

  /** Render the error template with a friendly message and a retry button. */
  protected async showError(err: unknown): Promise<void> {
    this.error = err instanceof Error ? err : new Error(String(err));
    this.#setState('error');
    if (!(await this.#renderIfDefined(this.errorTemplateId))) return;
    const messageEl = this.querySelector('[data-error-message]');
    if (messageEl) messageEl.textContent = this.formatErrorMessage(this.error);
    this.querySelector('[data-retry]')?.addEventListener('click', () => void this.retry(), { once: true });
  }

  /** Retry after an error: refetch the bound source, then call `onRetry()`. */
  async retry(): Promise<void> {
    if (this.#bound) await this.refetch();
    this.onRetry();
  }

  /** Turn an error into a user-facing message. Override to customize. */
  protected formatErrorMessage(error: Error): string {
    if (error instanceof HttpError) {
      switch (error.status) {
        case 0: return 'You appear to be offline. Check your connection and try again.';
        case 401: return 'Please sign in to continue.';
        case 403: return 'You don’t have permission to view this.';
        case 404: return 'This item could not be found.';
        case 408: return 'The server took too long to respond.';
        case 429: return 'Too many requests. Please wait a moment.';
        default: return error.status >= 500 ? 'Something went wrong on our side. Please try again.' : error.displayMessage;
      }
    }
    return error.message || 'Something went wrong.';
  }

  // ── Hooks ────────────────────────────────────────────────────────────────

  /** After the first render, each time the element is connected. */
  protected onConnected(): void {}
  /** After removal from the DOM. */
  protected onDisconnected(): void {}
  /** After bound object data is rendered (initially and on every change). */
  protected onBind(_obj: StoredObject): void {}
  /** After the binding is removed or the object deleted. */
  protected onUnbind(): void {}
  /** After a collection item is created or updated. */
  protected onItemRender(_element: Element, _obj: StoredObject): void {}
  /** After a bound ListView changes. */
  protected onListChange(_view: ListView): void {}
  /** After the retry button is used. */
  protected onRetry(): void {}
}

export type { ObjectRef };

/** Remove a list's loading/empty/error placeholder. */
function removePlaceholders(container: Element): void {
  for (const el of Array.from(container.querySelectorAll(':scope > [data-placeholder]'))) el.remove();
}
