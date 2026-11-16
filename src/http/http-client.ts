/**
 * HttpClient: config-driven API access that writes straight into the store.
 *
 * - Named endpoints with `:path` params, response mapping and nested normalization
 * - Cursor pagination wired to ListViews
 * - Retries with exponential backoff, for idempotent methods only (opt-in for others)
 * - Bearer token only sent to trusted origins; a 401 triggers a refresh and one retry
 * - Function-valued headers, interceptors, timeouts, AbortSignal, GET dedupe
 * - Cache modes (`network`, `cache-first`, `swr`) and batching
 *
 * @module http/http-client
 */

import type {
  BatchConfig,
  BatchOperation,
  BatchResult,
  EndpointConfig,
  FetchOptions,
  FetchResult,
  HeaderMap,
  HttpConfig,
  HttpMethod,
  Params,
  RequestConfig,
  RequestContext,
  ResolvedBatchOperation,
  RetryConfig,
} from './types';
import type { ObjectStore } from '../data/object-store';
import type { ListViewRegistry } from '../data/list-view-registry';
import type { ListView, PageInfo } from '../data/types';
import { HttpError } from './http-error';
import type { AuthManager } from './auth-manager';
import { extractData, extractPage, mapItem, type NestedWrite } from './mapping';
import { computeBackoff, sleep } from '../utils/backoff';
import { getPath } from '../utils/path';

const DEFAULT_RETRY: Required<RetryConfig> = {
  maxAttempts: 3,
  baseDelay: 500,
  maxDelay: 10000,
  jitter: 0.3,
  retryOn: [408, 425, 429, 500, 502, 503, 504],
  retryNonIdempotent: false,
};

const IDEMPOTENT = new Set<HttpMethod>(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

function isRawBody(body: unknown): boolean {
  return typeof body === 'string' ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    body instanceof ArrayBuffer || ArrayBuffer.isView(body);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export class HttpClient {
  private config: HttpConfig = {};
  private endpoints = new Map<string, EndpointConfig>();
  private auth: AuthManager | null = null;
  private store: ObjectStore | null = null;
  private listViews: ListViewRegistry | null = null;
  private inflight = new Map<string, Promise<unknown>>();
  private batchQueue: Array<{ op: ResolvedBatchOperation; endpoint?: EndpointConfig; resolve: (r: BatchResult) => void; reject: (e: unknown) => void }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private batchCounter = 0;

  constructor(config: HttpConfig = {}) {
    this.configure(config);
  }

  /** Merge new configuration (called by `Arethesis.init()`). */
  configure(config: HttpConfig): void {
    this.config = { ...this.config, ...config, headers: { ...this.config.headers, ...config.headers } };
  }

  /** Wire the store, list views and auth manager. */
  connect(deps: { store?: ObjectStore; listViews?: ListViewRegistry; auth?: AuthManager | null }): void {
    if (deps.store) this.store = deps.store;
    if (deps.listViews) this.listViews = deps.listViews;
    if (deps.auth !== undefined) this.auth = deps.auth;
  }

  get baseUrl(): string {
    return this.config.baseUrl ?? '';
  }

  /** Set a global header (a string or a function evaluated per request). */
  setHeader(name: string, value: HeaderMap[string]): void {
    this.config.headers = { ...this.config.headers, [name]: value };
  }

  removeHeader(name: string): void {
    const headers = { ...this.config.headers };
    delete headers[name];
    this.config.headers = headers;
  }

  // ── Endpoint registry ────────────────────────────────────────────────────

  /** Register a named endpoint. */
  defineEndpoint(name: string, config: EndpointConfig): EndpointConfig {
    this.endpoints.set(name, config);
    return config;
  }

  getEndpoint(name: string): EndpointConfig | undefined {
    return this.endpoints.get(name);
  }

  private requireEndpoint(ref: string | EndpointConfig): EndpointConfig {
    if (typeof ref !== 'string') return ref;
    const endpoint = this.endpoints.get(ref);
    if (!endpoint) throw new Error(`Unknown endpoint "${ref}". Register it with defineEndpoint().`);
    return endpoint;
  }

  // ── URLs ─────────────────────────────────────────────────────────────────

  /** Resolve a relative URL against `baseUrl`. */
  resolveUrl(url: string): string {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || url.startsWith('//')) return url;
    const base = this.baseUrl.replace(/\/+$/, '');
    if (!base) return url;
    return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  /** Fill `:params` in the path and append the rest as a query string. */
  buildUrl(url: string, params: Params = {}): string {
    const used = new Set<string>();
    // Only letters/underscore start a param name, so ports (":8080") and schemes are left alone.
    const path = url.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (match, name: string) => {
      if (!(name in params)) return match;
      used.add(name);
      return encodeURIComponent(String(params[name]));
    });

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (used.has(key) || value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach(v => search.append(key, String(v)));
      else if (value instanceof Date) search.set(key, value.toISOString());
      else search.set(key, String(value));
    }
    const query = search.toString();
    const resolved = this.resolveUrl(path);
    if (!query) return resolved;
    return `${resolved}${resolved.includes('?') ? '&' : '?'}${query}`;
  }

  /** Whether the bearer token may be sent to this URL. */
  isTrustedUrl(url: string): boolean {
    const here = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    let target: URL;
    try {
      target = new URL(url, here);
    } catch {
      return false;
    }
    const trusted = new Set<string>();
    try {
      trusted.add(new URL(here).origin);
    } catch {
      /* ignore */
    }
    if (this.baseUrl) {
      try {
        trusted.add(new URL(this.baseUrl, here).origin);
      } catch {
        /* ignore */
      }
    }
    for (const o of this.config.trustedOrigins ?? []) {
      try {
        trusted.add(new URL(o).origin);
      } catch {
        /* ignore */
      }
    }
    return trusted.has(target.origin);
  }

  private async resolveHeaders(...maps: Array<HeaderMap | undefined>): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const map of maps) {
      if (!map) continue;
      for (const [name, value] of Object.entries(map)) {
        const resolved = typeof value === 'function' ? await value() : value;
        if (resolved === undefined || resolved === null) delete out[name];
        else out[name] = resolved;
      }
    }
    return out;
  }

  // ── Requests ─────────────────────────────────────────────────────────────

  /**
   * Make a request with retries. Resolves with the parsed body (`undefined` for
   * empty responses) or rejects with an `HttpError`.
   */
  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const method = config.method ?? 'GET';
    const url = this.buildUrl(config.url, config.params);
    const dedupe = method === 'GET' && config.dedupe !== false && !config.signal && config.body === undefined;
    if (dedupe) {
      const existing = this.inflight.get(url);
      if (existing) return existing as Promise<T>;
      const promise = this.requestWithRetry<T>(url, method, config).finally(() => this.inflight.delete(url));
      this.inflight.set(url, promise);
      return promise;
    }
    return this.requestWithRetry<T>(url, method, config);
  }

  private async requestWithRetry<T>(url: string, method: HttpMethod, config: RequestConfig): Promise<T> {
    const retry = config.retry === false || this.config.retry === false
      ? { ...DEFAULT_RETRY, maxAttempts: 1 }
      : { ...DEFAULT_RETRY, ...this.config.retry, ...config.retry };
    const canRetry = IDEMPOTENT.has(method) || retry.retryNonIdempotent;
    let attempt = 0;
    let refreshed = false;

    for (;;) {
      try {
        return await this.send<T>(url, method, config, attempt);
      } catch (err) {
        if (isAbortError(err)) throw err;
        const error = err as HttpError;

        if (error.status === 401 && !refreshed && config.auth !== false && this.auth?.getRefreshToken()) {
          refreshed = true;
          if (await this.auth.refreshAccessToken()) continue;
        }

        attempt++;
        const retryable = error.kind === 'network' || error.kind === 'timeout' || retry.retryOn.includes(error.status);
        if (!canRetry || !retryable || error.kind === 'parse' || attempt >= retry.maxAttempts) throw error;

        const delay = error.retryAfter !== undefined
          ? Math.min(error.retryAfter * 1000, retry.maxDelay)
          : computeBackoff(attempt - 1, retry);
        await sleep(delay, config.signal);
      }
    }
  }

  private async send<T>(url: string, method: HttpMethod, config: RequestConfig, attempt: number): Promise<T> {
    const headers = await this.resolveHeaders({ Accept: 'application/json' }, this.config.headers, config.headers);
    if (config.auth !== false && this.auth && this.isTrustedUrl(url)) {
      const token = await this.auth.ensureValidToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    let body: BodyInit | undefined;
    if (config.body !== undefined) {
      if (isRawBody(config.body)) {
        body = config.body as BodyInit;
      } else {
        body = JSON.stringify(config.body);
        if (!Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
      }
    }

    const controller = new AbortController();
    const timeout = config.timeout ?? this.config.timeout ?? 30000;
    let timedOut = false;
    const timer = timeout > 0 ? setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout) : undefined;
    const onAbort = (): void => controller.abort(config.signal?.reason);
    if (config.signal?.aborted) controller.abort(config.signal.reason);
    config.signal?.addEventListener('abort', onAbort, { once: true });

    const ctx: RequestContext = {
      url,
      init: { method, headers, body, signal: controller.signal, credentials: this.config.credentials },
      config,
      attempt,
    };

    try {
      await this.config.interceptors?.request?.(ctx);
      const fetchImpl = this.config.fetch ?? globalThis.fetch.bind(globalThis);
      let response: Response;
      try {
        response = await fetchImpl(ctx.url, ctx.init);
      } catch (err) {
        if (timedOut) throw new HttpError('Request timed out', 408, { url, method, kind: 'timeout' });
        if (config.signal?.aborted) throw config.signal.reason ?? err;
        throw new HttpError('Network error', 0, { url, method, kind: 'network' });
      }
      const replaced = await this.config.interceptors?.response?.(response, ctx);
      if (replaced) response = replaced;

      if (!response.ok) {
        const errBody = await this.readBody(response, 'json', url, method).catch(() => undefined);
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryAfter = retryAfterHeader !== null && !isNaN(Number(retryAfterHeader)) ? Number(retryAfterHeader) : undefined;
        throw new HttpError(response.statusText || `HTTP ${response.status}`, response.status, { body: errBody, url, method, retryAfter });
      }
      return await this.readBody(response, config.responseType ?? 'json', url, method) as T;
    } catch (err) {
      if (err instanceof HttpError) this.config.interceptors?.error?.(err, ctx);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      config.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async readBody(response: Response, type: NonNullable<RequestConfig['responseType']>, url: string, method: string): Promise<unknown> {
    if (type === 'response') return response;
    if (type === 'blob') return response.blob();
    if (response.status === 204 || response.status === 205 || method === 'HEAD') return undefined;
    const text = await response.text();
    if (type === 'text') return text;
    if (text.trim() === '') return undefined;
    const contentType = response.headers.get('Content-Type') ?? '';
    const looksJson = /json/i.test(contentType) || /^\s*[[{"]/.test(text);
    if (!looksJson) return text;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError('Invalid JSON in response', response.status, { url, method, kind: 'parse', body: text });
    }
  }

  // ── Endpoints → store ────────────────────────────────────────────────────

  /**
   * Call an endpoint, map the response and write it to the store.
   *
   * @example
   * ```ts
   * const { data } = await http.fetchEndpoint('getPerson', { id: 7 }, { cache: 'swr' });
   * ```
   */
  async fetchEndpoint<T = unknown>(ref: string | EndpointConfig, params: Params = {}, options: FetchOptions = {}): Promise<FetchResult<T>> {
    const endpoint = this.requireEndpoint(ref);
    const method = endpoint.method ?? 'GET';

    if (options.cache && options.cache !== 'network' && method === 'GET' && endpoint.type && !endpoint.list && this.store && params.id !== undefined && params.id !== null) {
      const cached = this.store.get<T>(endpoint.type, String(params.id));
      if (cached) {
        const fresh = cached.status === 'fresh';
        if (options.cache === 'swr' || fresh) {
          if (options.cache === 'swr' || !fresh) {
            this.store.setStatus(endpoint.type, cached.id, 'updating');
            this.fetchEndpoint(endpoint, params, { ...options, cache: 'network' }).catch(() => {
              this.store?.setStatus(endpoint.type!, cached.id, 'error');
            });
          }
          return { data: cached.data, ids: [cached.id], fromCache: true };
        }
      }
    }

    const body = endpoint.batch && this.config.batch
      ? await this.enqueueBatch(endpoint, params, options.body)
      : await this.request({
        url: endpoint.url,
        method,
        params,
        body: options.body,
        headers: { ...endpoint.headers, ...options.headers },
        retry: endpoint.retry,
        auth: endpoint.auth,
        timeout: endpoint.timeout,
        signal: options.signal,
      });

    return this.ingest<T>(endpoint, body, params, options);
  }

  /** Map a response body for an endpoint and write it to the store. */
  ingest<T>(endpoint: EndpointConfig, body: unknown, params: Params = {}, options: Pick<FetchOptions, 'viewId' | 'append'> = {}): FetchResult<T> {
    const data = extractData(body, endpoint.mapping);
    const nestedWrites: NestedWrite[] = [];
    const collect = (write: NestedWrite): string[] => {
      nestedWrites.push(write);
      return write.items.map(item => this.store?.getId(write.type, item) ?? '').filter(Boolean);
    };

    const isList = endpoint.list ?? Array.isArray(data);
    const items = isList
      ? (Array.isArray(data) ? data : []).map(item => mapItem(item, endpoint.mapping, collect))
      : [mapItem(data, endpoint.mapping, collect)];

    let ids: string[] = [];
    if (this.store) {
      const store = this.store;
      store.batch(() => {
        for (const write of nestedWrites) store.upsertMany(write.type, write.items, { source: 'api' });
        if (endpoint.type) {
          ids = store.upsertMany(endpoint.type, items.filter(i => i !== undefined && i !== null), { source: 'api' });
        }
      });
    }

    let page: FetchResult['page'];
    if (isList) {
      const limitParam = endpoint.pagination?.limitParam ?? 'limit';
      const pageSize = typeof params[limitParam] === 'number' ? params[limitParam] as number : undefined;
      page = extractPage(body, endpoint.pagination, items.length, pageSize);
      if (options.viewId && this.listViews) {
        if (options.append) this.listViews.appendPage(options.viewId, ids, page);
        else this.listViews.populate(options.viewId, ids, page);
      }
    }

    return { data: (isList ? items : items[0]) as T, ids, page, fromCache: false };
  }

  /** Page loader for ListViews (wired up by `Arethesis.init()`). */
  async loadListView(view: ListView, options: { append: boolean; signal?: AbortSignal }): Promise<{ ids: string[]; page: PageInfo }> {
    if (!view.endpoint) throw new Error(`ListView "${view.id}" has no endpoint.`);
    const endpoint = this.requireEndpoint(view.endpoint);
    const p = endpoint.pagination ?? {};
    const params: Params = { ...(view.filters as Params) };
    params[p.limitParam ?? 'limit'] = view.pageSize;
    if (options.append && view.nextCursor) params[p.cursorParam ?? 'cursor'] = view.nextCursor;
    if (view.sort.length) params[p.sortParam ?? 'sort'] = view.sort.map(s => `${s.field}:${s.direction}`).join(',');
    const result = await this.fetchEndpoint(endpoint, params, { signal: options.signal });
    return { ids: result.ids, page: result.page ?? { nextCursor: null, hasMore: false } };
  }

  // ── Batching ─────────────────────────────────────────────────────────────

  private resolveOp(op: BatchOperation): { op: ResolvedBatchOperation; endpoint?: EndpointConfig } {
    const endpoint = op.endpoint ? this.requireEndpoint(op.endpoint) : undefined;
    const rawUrl = endpoint?.url ?? op.url;
    if (!rawUrl) throw new Error('Batch operation needs an endpoint or url.');
    return {
      endpoint,
      op: {
        id: op.id ?? `b${++this.batchCounter}`,
        method: op.method ?? endpoint?.method ?? 'GET',
        // Relative path for the batch server; the batch request itself goes to baseUrl.
        url: this.buildUrl(rawUrl, op.params).replace(this.baseUrl.replace(/\/+$/, ''), '') || '/',
        body: op.body,
      },
    };
  }

  private requireBatch(): Required<Pick<BatchConfig, 'url' | 'maxOperations' | 'window'>> & BatchConfig {
    if (!this.config.batch) throw new Error('No batch endpoint configured (http.batch).');
    return { maxOperations: 50, window: 10, ...this.config.batch };
  }

  /**
   * Send several operations through the batch endpoint. Results for operations
   * that reference a typed endpoint are written to the store.
   */
  async batch(operations: BatchOperation[]): Promise<BatchResult[]> {
    const resolved = operations.map(op => this.resolveOp(op));
    const results = await this.sendBatch(resolved.map(r => r.op));
    resolved.forEach((r, i) => {
      const result = results[i];
      if (r.endpoint?.type && result && result.status >= 200 && result.status < 300) this.ingest(r.endpoint, result.body);
    });
    return results;
  }

  private async sendBatch(ops: ResolvedBatchOperation[]): Promise<BatchResult[]> {
    const cfg = this.requireBatch();
    const results: BatchResult[] = [];
    for (let i = 0; i < ops.length; i += cfg.maxOperations) {
      const chunk = ops.slice(i, i + cfg.maxOperations);
      const body = cfg.buildRequest ? cfg.buildRequest(chunk) : { operations: chunk };
      const response = await this.request<unknown>({ url: cfg.url, method: 'POST', body, retry: { retryNonIdempotent: chunk.every(o => IDEMPOTENT.has(o.method)) } });
      const parsed = cfg.parseResponse
        ? cfg.parseResponse(response)
        : Array.isArray(response) ? response as BatchResult[] : (getPath(response, 'results') as BatchResult[] | undefined) ?? [];
      // Match by id when present, else by position.
      const byId = new Map(parsed.filter(r => r.id !== undefined).map(r => [r.id, r]));
      chunk.forEach((op, j) => results.push(byId.get(op.id) ?? parsed[j] ?? { id: op.id, status: 0 }));
    }
    return results;
  }

  private enqueueBatch(endpoint: EndpointConfig, params: Params, body: unknown): Promise<unknown> {
    const cfg = this.requireBatch();
    const { op } = this.resolveOp({ url: endpoint.url, method: endpoint.method, params, body });
    return new Promise((resolve, reject) => {
      this.batchQueue.push({
        op,
        endpoint,
        resolve: result => {
          if (result.status >= 200 && result.status < 300) resolve(result.body);
          else reject(new HttpError(`Batched request failed (${result.status})`, result.status, { body: result.body, url: op.url, method: op.method }));
        },
        reject,
      });
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => {
          this.batchTimer = null;
          const queued = this.batchQueue.splice(0);
          this.sendBatch(queued.map(q => q.op))
            .then(results => queued.forEach((q, i) => q.resolve(results[i])))
            .catch(err => queued.forEach(q => q.reject(err)));
        }, cfg.window);
      }
    });
  }
}
