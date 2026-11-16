/**
 * Arethesis: wires the store, HTTP, auth, persistence, real-time, binding,
 * mixins and plugins together.
 *
 * ```ts
 * const app = getArethesis();
 * defineType({ name: 'Person', endpoint: 'getPerson' });
 * defineEndpoint('getPerson', { url: '/people/:id', type: 'Person' });
 * await app.init({ http: { baseUrl: '/api' }, sse: { url: '/api/events' } });
 * ```
 *
 * @module core/arethesis
 */

import type { ArethesisConfig } from './types';
import type { EndpointConfig, FetchOptions, Params, RequestConfig } from '../http/types';
import type { ListView, ListViewConfig, TypeConfig } from '../data/types';
import type { PluginRef, PluginRegistrationOptions } from '../plugins/types';

import { ObjectStore } from '../data/object-store';
import { ListViewRegistry } from '../data/list-view-registry';
import { OptimisticUpdateManager } from '../data/optimistic-updates';
import { PersistenceManager } from '../data/persistence-manager';
import { HttpClient } from '../http/http-client';
import { AuthManager } from '../http/auth-manager';
import { SSEManager } from '../realtime/sse-manager';
import { WebSocketManager } from '../realtime/websocket-manager';
import { AzurePubSubManager } from '../realtime/azure-pubsub-manager';
import { CollabManager } from '../realtime/collab/collab-session';
import { ValidationEngine } from '../binding/validation-engine';
import { DataBinder } from '../binding/data-binder';
import { setRuntime } from '../components/runtime';
import { templateLoader } from '../components/template-loader';
import { mixinRegistry } from '../mixins/registry';
import { PluginManager } from '../plugins/plugin-manager';
import { Emitter } from '../utils/emitter';
import { registerBuiltInMixins } from '../mixins/index';
import { registerBuiltInPlugins } from '../plugins/builtins';

import { VERSION } from '../version';
export { VERSION };

export interface ArethesisEvents extends Record<string, unknown> {
  ready: void;
  logout: void;
}

export class Arethesis extends Emitter<ArethesisEvents> {
  private static instance: Arethesis | null = null;

  readonly version = VERSION;
  /** Normalized object cache. */
  readonly store = new ObjectStore();
  /** Paginated list views. */
  readonly listViews = new ListViewRegistry();
  /** Optimistic create/update/delete with rollback. */
  readonly optimistic: OptimisticUpdateManager;
  /** HTTP client and endpoint registry. */
  readonly http = new HttpClient();
  /** Validators. */
  readonly validation = new ValidationEngine();
  /** DOM binding. */
  readonly binder: DataBinder;
  /** Plugins. */
  readonly plugins: PluginManager;
  /** Collaborative editing (needs `websocket`). */
  readonly collab: CollabManager;
  /** Mixin registry. */
  readonly mixins = mixinRegistry;

  auth: AuthManager | null = null;
  persistence: PersistenceManager | null = null;
  sse: SSEManager | null = null;
  ws: WebSocketManager | null = null;
  azurePubSub: AzurePubSubManager | null = null;

  private _config: ArethesisConfig = {};
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private stopObserving: (() => void) | null = null;

  constructor() {
    super();
    registerBuiltInMixins();
    registerBuiltInPlugins();
    this.optimistic = new OptimisticUpdateManager(this.store, this.listViews);
    this.binder = new DataBinder(this.validation);
    this.plugins = new PluginManager(this);
    this.collab = new CollabManager(() => this.ws);
    this.http.connect({ store: this.store, listViews: this.listViews });
    this.listViews.setLoader((view, options) => this.http.loadListView(view, options));
    setRuntime({ store: this.store, listViews: this.listViews, binder: this.binder, http: this.http });
  }

  /** The shared instance. */
  static getInstance(): Arethesis {
    if (!Arethesis.instance) Arethesis.instance = new Arethesis();
    return Arethesis.instance;
  }

  /** Destroy the shared instance (mainly for tests). */
  static resetInstance(): void {
    Arethesis.instance?.destroy();
    Arethesis.instance = null;
  }

  get config(): ArethesisConfig {
    return this._config;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  // ── Registration ─────────────────────────────────────────────────────────

  /** Register a plugin. Chainable. */
  use(plugin: PluginRef, options?: unknown, registration?: PluginRegistrationOptions): this {
    this.plugins.use(plugin, options, registration);
    return this;
  }

  /** Register a type. */
  defineType(config: TypeConfig): TypeConfig {
    this.store.registerType(config);
    return config;
  }

  /** Register a named endpoint. */
  defineEndpoint(name: string, config: EndpointConfig): EndpointConfig {
    return this.http.defineEndpoint(name, config);
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  /** Configure and start the framework. Calling it again returns the same promise. */
  init(config: ArethesisConfig = {}): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit(config);
    return this.initPromise;
  }

  private async doInit(initial: ArethesisConfig): Promise<void> {
    for (const plugin of initial.plugins ?? []) this.use(plugin);
    const config = await this.plugins.beforeInit(initial);
    this._config = config;

    this.http.configure(config.http ?? {});
    if (config.http?.fetch) templateLoader.setFetch(config.http.fetch);
    for (const type of config.types ?? []) this.defineType(type);
    for (const [name, endpoint] of Object.entries(config.endpoints ?? {})) this.defineEndpoint(name, endpoint);
    for (const [name, message] of Object.entries(config.validation?.messages ?? {})) this.validation.setMessage(name, message);

    if (config.auth) {
      this.auth = new AuthManager(config.auth, {
        fetch: () => config.http?.fetch ?? globalThis.fetch.bind(globalThis),
        resolveUrl: url => this.http.resolveUrl(url),
      });
      this.http.connect({ auth: this.auth });
    }

    if (config.persistence !== false) await this.initPersistence(typeof config.persistence === 'object' ? config.persistence : {});

    const tokenFor = (url: string) => () => {
      const httpUrl = url.replace(/^ws(s?):\/\//i, 'http$1://');
      return this.auth && this.http.isTrustedUrl(httpUrl) ? this.auth.ensureValidToken() : null;
    };
    if (config.sse) {
      this.sse = new SSEManager({ ...config.sse, url: this.http.resolveUrl(config.sse.url) });
      this.sse.connectStore(this.store, this.listViews);
      this.sse.setTokenProvider(tokenFor(this.sse.config.url));
    }
    if (config.websocket) {
      this.ws = new WebSocketManager(config.websocket);
      this.ws.setTokenProvider(tokenFor(config.websocket.url));
    }
    if (config.azurePubSub) {
      this.azurePubSub = new AzurePubSubManager({
        ...config.azurePubSub,
        negotiateUrl: this.http.resolveUrl(config.azurePubSub.negotiateUrl),
        fetch: config.azurePubSub.fetch ?? config.http?.fetch,
      });
      this.azurePubSub.connectStore(this.store, this.listViews);
      this.azurePubSub.setTokenProvider(tokenFor(this.azurePubSub.config.negotiateUrl));
    }

    if (config.mixins !== false && typeof document !== 'undefined') {
      const opts = typeof config.mixins === 'object' ? config.mixins : {};
      const root = opts.root ?? document;
      if (opts.observe === false) mixinRegistry.init(root);
      else this.stopObserving = mixinRegistry.observe(root);
    }

    await this.plugins.afterInit();
    this.initialized = true;
    if (config.autoConnect !== false) this.connect();
    this.emit('ready', undefined);
  }

  private async initPersistence(options: ConstructorParameters<typeof PersistenceManager>[0]): Promise<void> {
    const persistence = new PersistenceManager(options);
    const db = await persistence.open();
    if (!db) return;
    this.persistence = persistence;
    for (const obj of await persistence.loadAll()) this.store.hydrate(obj);
    this.store.setPersistence({
      save: obj => persistence.save(obj),
      remove: (type, id) => persistence.delete(type, id),
      clear: () => void persistence.clear(),
    });
  }

  // ── Real-time ────────────────────────────────────────────────────────────

  /** Connect configured real-time services. */
  connect(): void {
    void this.sse?.connect();
    void this.ws?.connect();
    void this.azurePubSub?.connect();
  }

  disconnect(): void {
    this.sse?.disconnect();
    this.ws?.disconnect();
    this.azurePubSub?.disconnect();
  }

  // ── Data helpers ─────────────────────────────────────────────────────────

  /** Call a named endpoint, store the result, and return the mapped data. */
  async fetch<T = unknown>(endpoint: string | EndpointConfig, params?: Params, options?: FetchOptions): Promise<T> {
    return (await this.http.fetchEndpoint<T>(endpoint, params, options)).data;
  }

  /** Make a raw request (with retries, auth and interceptors). */
  request<T = unknown>(config: RequestConfig): Promise<T> {
    return this.http.request<T>(config);
  }

  /** Get or create a ListView. */
  list(config: ListViewConfig): ListView {
    return this.listViews.getOrCreate(config);
  }

  // ── Session ──────────────────────────────────────────────────────────────

  /** Log in through the auth manager and reconnect real-time services with the new token. */
  async login<T = unknown>(credentials: Record<string, unknown>): Promise<T | null> {
    if (!this.auth) throw new Error('No auth configured');
    const result = await this.auth.login<T>(credentials);
    if (result !== null && this.initialized && this._config.autoConnect !== false) {
      this.disconnect();
      this.connect();
    }
    return result;
  }

  /**
   * Log out: tell the server, clear tokens, and wipe every cached object from
   * memory and IndexedDB so the next user of this device sees nothing.
   */
  async logout(): Promise<void> {
    this.disconnect();
    await this.auth?.logout();
    this.store.clear();
    this.listViews.clear();
    await this.persistence?.clear();
    this.emit('logout', undefined);
  }

  /** Tear everything down. */
  destroy(): void {
    this.disconnect();
    this.stopObserving?.();
    this.stopObserving = null;
    this.plugins.destroy();
    this.auth?.destroy();
    void this.persistence?.close();
    this.clear();
    if (Arethesis.instance === this) Arethesis.instance = null;
  }
}

/** The shared Arethesis instance. */
export function getArethesis(): Arethesis {
  return Arethesis.getInstance();
}

/** Register a type on the shared instance. */
export function defineType(config: TypeConfig): TypeConfig {
  return getArethesis().defineType(config);
}

/** Register a named endpoint on the shared instance. */
export function defineEndpoint(name: string, config: EndpointConfig): EndpointConfig {
  return getArethesis().defineEndpoint(name, config);
}
