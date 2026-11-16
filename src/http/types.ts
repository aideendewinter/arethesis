/**
 * HTTP layer types.
 *
 * @module http/types
 */

import type { HttpError } from './http-error';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** A header value, or a function evaluated at request time (e.g. a tenant id or request id). */
export type HeaderValue = string | (() => string | undefined | null | Promise<string | undefined | null>);

export type HeaderMap = Record<string, HeaderValue>;

/** Query/path parameter values. Arrays repeat the key; Dates become ISO strings. */
export type ParamValue = string | number | boolean | Date | null | undefined | Array<string | number | boolean>;
export type Params = Record<string, ParamValue>;

export interface RetryConfig {
  /** Total attempts including the first. @default 3 */
  maxAttempts?: number;
  /** @default 500 */
  baseDelay?: number;
  /** @default 10000 */
  maxDelay?: number;
  /** Random extra delay as a fraction (0–1). @default 0.3 */
  jitter?: number;
  /** Status codes worth retrying. @default [408, 425, 429, 500, 502, 503, 504] */
  retryOn?: number[];
  /**
   * Also retry POST and PATCH. Only enable this if your API makes them idempotent
   * (e.g. with an idempotency key). @default false
   */
  retryNonIdempotent?: boolean;
}

export interface RequestConfig {
  url: string;
  method?: HttpMethod;
  /** Path (`:id`) and query parameters. */
  params?: Params;
  /** JSON-serialized unless it is FormData, Blob, URLSearchParams, ArrayBuffer or a string. */
  body?: unknown;
  headers?: HeaderMap;
  /** Milliseconds before the request is aborted with a 408. */
  timeout?: number;
  signal?: AbortSignal;
  /** Retry policy for this request, or `false` to disable retries. */
  retry?: RetryConfig | false;
  /** Attach the bearer token. @default true */
  auth?: boolean;
  /** How to read the body. @default 'json' (falls back to text) */
  responseType?: 'json' | 'text' | 'blob' | 'response';
  /** Share identical in-flight GET requests. @default true */
  dedupe?: boolean;
}

/** Maps one field; `path` is a dotted path into the response item. */
export interface FieldMapping {
  path: string;
  transform?: (value: unknown, item: unknown) => unknown;
}

/** Extracts related objects into their own type during normalization. */
export interface NestedMapping {
  /** Type of the nested objects, e.g. `'Person'`. */
  type: string;
  /** Path to the nested object or array. Defaults to the mapping key. */
  path?: string;
  /** Mapping applied to each nested item. */
  mapping?: ResponseMapping;
  /** Store ids in the parent (`'ids'`, default) or keep the mapped objects inline (`'keep'`). */
  as?: 'ids' | 'keep';
}

export interface ResponseMapping {
  /** Path to the data in the response (`'data'`, `'data.users'`). @default '' (the whole body) */
  dataPath?: string;
  /** Applied to the data at `dataPath` before field mapping. */
  transform?: (data: unknown) => unknown;
  /** `target: 'source.path'` or `target: { path, transform }`. */
  fields?: Record<string, string | FieldMapping>;
  /** Also copy fields that are not listed in `fields`. @default false */
  keepUnmapped?: boolean;
  /** Related objects to normalize into their own types. */
  nested?: Record<string, NestedMapping>;
}

export interface PaginationMapping {
  /** Path to the next cursor in the response body, e.g. `'meta.nextCursor'`. */
  cursorPath?: string;
  /** Path to a boolean "has more" flag. Defaults to `nextCursor != null`. */
  hasMorePath?: string;
  /** Path to the total item count. */
  totalCountPath?: string;
  /** Query parameter that carries the cursor. @default 'cursor' */
  cursorParam?: string;
  /** Query parameter that carries the page size. @default 'limit' */
  limitParam?: string;
  /** Query parameter for sort (`field:dir,field:dir`). @default 'sort' */
  sortParam?: string;
}

/** A named endpoint, registered with `defineEndpoint(name, config)`. */
export interface EndpointConfig {
  /** Path relative to `http.baseUrl`; `:name` segments are filled from params. */
  url: string;
  method?: HttpMethod;
  /** Store results as this object type. */
  type?: string;
  /** The response is a list of `type`. */
  list?: boolean;
  headers?: HeaderMap;
  mapping?: ResponseMapping;
  pagination?: PaginationMapping;
  retry?: RetryConfig | false;
  /** Attach the bearer token. @default true */
  auth?: boolean;
  timeout?: number;
  /** Route through the batch endpoint. */
  batch?: boolean;
}

export type CacheMode = 'network' | 'cache-first' | 'swr';

export interface FetchOptions {
  /**
   * - `network` (default): always request
   * - `cache-first`: return a fresh stored object without a request
   * - `swr`: return the stored object now and revalidate in the background
   */
  cache?: CacheMode;
  signal?: AbortSignal;
  body?: unknown;
  headers?: HeaderMap;
  /** Populate (or append to) this ListView with the result ids. */
  viewId?: string;
  append?: boolean;
}

export interface FetchResult<T = unknown> {
  /** Mapped data: an item, or an array for list endpoints. */
  data: T;
  /** Ids written to the store. */
  ids: string[];
  /** Pagination info for list endpoints. */
  page?: { nextCursor: string | null; hasMore: boolean; totalCount?: number };
  /** True if served from the store without a request. */
  fromCache: boolean;
}

export interface RequestContext {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
  config: RequestConfig;
  attempt: number;
}

export interface Interceptors {
  /** Runs before every attempt; may mutate `ctx.init` / `ctx.url`. */
  request?: (ctx: RequestContext) => void | Promise<void>;
  /** Runs on every response; may return a replacement Response. */
  response?: (response: Response, ctx: RequestContext) => Response | void | Promise<Response | void>;
  /** Runs on every failed attempt. */
  error?: (error: HttpError, ctx: RequestContext) => void;
}

export interface BatchConfig {
  /** Batch endpoint URL. */
  url: string;
  /** Operations per request. @default 50 */
  maxOperations?: number;
  /** Coalesce `batch: true` endpoint calls made within this many ms. @default 10 */
  window?: number;
  /** Build the request body. @default `{ operations: [...] }` */
  buildRequest?: (operations: ResolvedBatchOperation[]) => unknown;
  /** Read per-operation results from the response. @default the array, or `body.results` */
  parseResponse?: (body: unknown) => BatchResult[];
}

export interface BatchOperation {
  /** Client id for matching results. Generated if omitted. */
  id?: string;
  /** A registered endpoint name… */
  endpoint?: string;
  /** …or a raw URL. */
  url?: string;
  method?: HttpMethod;
  params?: Params;
  body?: unknown;
}

export interface ResolvedBatchOperation {
  id: string;
  method: HttpMethod;
  url: string;
  body?: unknown;
}

export interface BatchResult {
  id?: string;
  status: number;
  body?: unknown;
}

export interface HttpConfig {
  /** Prefix for relative endpoint URLs, e.g. `'https://api.example.com'` or `'/api'`. */
  baseUrl?: string;
  /** Headers for every request; function values are evaluated per request. */
  headers?: HeaderMap;
  retry?: RetryConfig | false;
  /** Default timeout in ms. @default 30000 */
  timeout?: number;
  /** `fetch` implementation (for tests, SSR or mock backends). */
  fetch?: typeof fetch;
  credentials?: RequestCredentials;
  interceptors?: Interceptors;
  batch?: BatchConfig;
  /**
   * Extra origins allowed to receive the bearer token. The `baseUrl` origin and
   * the page origin are always trusted; every other origin is not.
   */
  trustedOrigins?: string[];
}

export type TokenStorage = 'local' | 'session' | 'memory' | Storage;

export interface AuthConfig {
  loginUrl: string;
  refreshUrl: string;
  logoutUrl?: string;
  /** Where tokens live. @default 'local' */
  storage?: TokenStorage;
  /** @default 'access_token' */
  accessTokenKey?: string;
  /** @default 'refresh_token' */
  refreshTokenKey?: string;
  /** Refresh when the token expires within this many seconds. @default 60 */
  refreshThreshold?: number;
  /** Called when the session can't be refreshed. */
  onSessionExpired?: () => void;
  /** Custom token parser (e.g. for opaque tokens with a separate expiry). */
  parseToken?: (token: string) => TokenPayload | null;
  /** Paths to tokens in login/refresh responses. */
  tokenPaths?: { accessToken?: string; refreshToken?: string };
  /** Field name for the refresh token in the refresh request body. @default 'refresh_token' */
  refreshBodyField?: string;
  credentials?: RequestCredentials;
}

export interface TokenPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  [claim: string]: unknown;
}
