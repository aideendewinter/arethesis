import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../http-client';
import { HttpError } from '../http-error';
import { AuthManager } from '../auth-manager';
import { ObjectStore } from '../../data/object-store';
import { ListViewRegistry } from '../../data/list-view-registry';
import { makeJwt, mockFetch, type RouteHandler } from '../../../test/helpers';

afterEach(() => vi.useRealTimers());

function client(handler: RouteHandler, config: ConstructorParameters<typeof HttpClient>[0] = {}) {
  const fetch = mockFetch(handler);
  const http = new HttpClient({ baseUrl: 'http://localhost/api', fetch, retry: { baseDelay: 1, jitter: 0 }, ...config });
  const store = new ObjectStore();
  const listViews = new ListViewRegistry();
  http.connect({ store, listViews });
  return { http, fetch, store, listViews };
}

describe('HttpClient URLs', () => {
  it('resolves, fills path params and serializes queries', () => {
    const { http } = client(() => ({}));
    expect(http.resolveUrl('/people')).toBe('http://localhost/api/people');
    expect(http.resolveUrl('people')).toBe('http://localhost/api/people');
    expect(http.resolveUrl('https://other.com/x')).toBe('https://other.com/x');
    expect(http.buildUrl('/people/:id/notes', { id: 'a b', q: 'x', tags: ['a', 'b'], skip: undefined, none: null, at: new Date(0), flag: false }))
      .toBe('http://localhost/api/people/a%20b/notes?q=x&tags=a&tags=b&at=1970-01-01T00%3A00%3A00.000Z&flag=false');
    expect(http.buildUrl('http://localhost:8080/x/:missing')).toBe('http://localhost:8080/x/:missing');
    expect(http.buildUrl('/x?a=1', { b: 2 })).toBe('http://localhost/api/x?a=1&b=2');
    expect(new HttpClient().resolveUrl('/x')).toBe('/x');
  });

  it('trusts only the page, baseUrl and configured origins', () => {
    const { http } = client(() => ({}), { baseUrl: 'https://api.example.com', trustedOrigins: ['https://cdn.example.com', 'bad url'] });
    expect(http.isTrustedUrl('/relative')).toBe(true);
    expect(http.isTrustedUrl('https://api.example.com/x')).toBe(true);
    expect(http.isTrustedUrl('https://cdn.example.com/y')).toBe(true);
    expect(http.isTrustedUrl('https://evil.com/steal')).toBe(false);
    expect(http.isTrustedUrl('http://[bad')).toBe(false);
  });
});

describe('HttpClient requests', () => {
  it('parses JSON, text and empty bodies', async () => {
    const { http } = client(url => {
      if (url.pathname.endsWith('/json')) return { body: { a: 1 } };
      if (url.pathname.endsWith('/text')) return { body: 'plain' };
      if (url.pathname.endsWith('/empty')) return { body: '' };
      return { status: 204 };
    });
    expect(await http.request({ url: '/json' })).toEqual({ a: 1 });
    expect(await http.request({ url: '/text' })).toBe('plain');
    expect(await http.request({ url: '/empty', method: 'POST' })).toBeUndefined();
    expect(await http.request({ url: '/none', method: 'DELETE' })).toBeUndefined();
    expect(await http.request({ url: '/text', responseType: 'text' })).toBe('plain');
    expect(await http.request<Response>({ url: '/json', responseType: 'response' })).toBeInstanceOf(Response);
    expect(await http.request<Blob>({ url: '/json', responseType: 'blob' })).toBeInstanceOf(Blob);
  });

  it('does not retry a successful POST with an empty body (regression)', async () => {
    const { http, fetch } = client(() => ({ body: '' }));
    await http.request({ url: '/save', method: 'POST', body: { a: 1 } });
    expect(fetch.calls).toHaveLength(1);
  });

  it('reports invalid JSON as a parse error without retrying', async () => {
    const { http, fetch } = client(() => ({ body: '{bad', headers: { 'Content-Type': 'application/json' } }));
    const err = await http.request<never>({ url: '/x' }).catch((e: HttpError) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.kind).toBe('parse');
    expect(fetch.calls).toHaveLength(1);
  });

  it('sends JSON bodies (including falsy ones) and raw bodies', async () => {
    const { http, fetch } = client(() => ({ body: {} }));
    await http.request({ url: '/a', method: 'PUT', body: 0 });
    await http.request({ url: '/a', method: 'PUT', body: false });
    const form = new FormData();
    await http.request({ url: '/a', method: 'PUT', body: form });
    await http.request({ url: '/a', method: 'PUT', body: 'raw', headers: { 'content-type': 'text/plain' } });
    expect(fetch.calls[0].init.body).toBe('0');
    expect(fetch.calls[1].init.body).toBe('false');
    expect((fetch.calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(fetch.calls[2].init.body).toBe(form);
    expect((fetch.calls[2].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((fetch.calls[3].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('resolves static and dynamic headers in order', async () => {
    let tenant = 't1';
    const { http, fetch } = client(() => ({ body: {} }), { headers: { 'X-Tenant': () => tenant, 'X-Static': 'a', 'X-Drop': 'x' } });
    http.setHeader('X-Async', async () => 'async');
    await http.request({ url: '/a', headers: { 'X-Static': 'b', 'X-Drop': () => undefined } });
    tenant = 't2';
    http.removeHeader('X-Async');
    await http.request({ url: '/b' });
    const h1 = fetch.calls[0].init.headers as Record<string, string>;
    const h2 = fetch.calls[1].init.headers as Record<string, string>;
    expect(h1).toMatchObject({ 'X-Tenant': 't1', 'X-Static': 'b', 'X-Async': 'async' });
    expect(h1['X-Drop']).toBeUndefined();
    expect(h2['X-Tenant']).toBe('t2');
    expect(h2['X-Async']).toBeUndefined();
  });

  it('retries idempotent requests on 5xx and network errors with backoff', async () => {
    let n = 0;
    const { http, fetch } = client(() => (++n === 1 ? { status: 503 } : n === 2 ? { networkError: true } : { body: { ok: true } }));
    expect(await http.request({ url: '/x' })).toEqual({ ok: true });
    expect(fetch.calls).toHaveLength(3);
  });

  it('does not retry POST/PATCH unless allowed', async () => {
    const { http, fetch } = client(() => ({ status: 500 }));
    await expect(http.request({ url: '/x', method: 'POST' })).rejects.toBeInstanceOf(HttpError);
    expect(fetch.calls).toHaveLength(1);
    await expect(http.request({ url: '/x', method: 'PATCH', retry: { retryNonIdempotent: true, baseDelay: 1, jitter: 0 } })).rejects.toThrow();
    expect(fetch.calls).toHaveLength(4);
  });

  it('does not retry 4xx and honors Retry-After', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { http, fetch } = client(() => (++n === 1 ? { status: 429, headers: { 'Retry-After': '2' } } : n === 2 ? { status: 404, body: { message: 'Nope' } } : {}));
    const p = http.request<never>({ url: '/x' }).catch((e: HttpError) => e);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const err = await p;
    expect(fetch.calls).toHaveLength(2);
    expect(err.status).toBe(404);
    expect(err.displayMessage).toBe('Nope');
    expect(err.isClientError).toBe(true);
  });

  it('can disable retries globally or per request', async () => {
    const { http, fetch } = client(() => ({ status: 500 }), { retry: false });
    await expect(http.request({ url: '/x' })).rejects.toThrow();
    expect(fetch.calls).toHaveLength(1);
  });

  it('times out with a 408 and supports abort signals', async () => {
    const { http } = client(() => ({ delay: 50, body: {} }), { retry: false });
    const err = await http.request<never>({ url: '/slow', timeout: 5 }).catch((e: HttpError) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.isTimeout).toBe(true);
    const c = new AbortController();
    const p = http.request({ url: '/slow', signal: c.signal });
    c.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    const pre = new AbortController();
    pre.abort();
    await expect(http.request({ url: '/slow', signal: pre.signal })).rejects.toBeDefined();
  });

  it('shares identical in-flight GETs', async () => {
    const { http, fetch } = client(() => ({ body: { n: 1 }, delay: 5 }));
    const [a, b] = await Promise.all([http.request({ url: '/x' }), http.request({ url: '/x' })]);
    expect(a).toBe(b);
    expect(fetch.calls).toHaveLength(1);
    await http.request({ url: '/x', dedupe: false });
    expect(fetch.calls).toHaveLength(2);
  });

  it('runs interceptors', async () => {
    const seen: string[] = [];
    const { http } = client(url => (url.pathname.endsWith('fail') ? { status: 500 } : { body: { v: 1 } }), {
      retry: false,
      interceptors: {
        request: ctx => {
          ctx.init.headers['X-Trace'] = 'abc';
          seen.push(`req:${ctx.attempt}`);
        },
        response: res => (res.url.endsWith('swap') ? new Response('{"v":2}', { headers: { 'Content-Type': 'application/json' } }) : undefined),
        error: err => seen.push(`err:${err.status}`),
      },
    });
    expect(await http.request({ url: '/ok' })).toEqual({ v: 1 });
    await http.request({ url: '/fail' }).catch(() => {});
    expect(seen).toEqual(['req:0', 'req:0', 'err:500']);
  });
});

describe('HttpClient auth', () => {
  function withAuth(handler: RouteHandler, token = makeJwt({ exp: Date.now() / 1000 + 3600 })) {
    const ctx = client(handler);
    const auth = new AuthManager({ loginUrl: '/login', refreshUrl: '/refresh', storage: 'memory' }, { fetch: () => ctx.fetch });
    auth.setTokens(token, 'refresh-1');
    ctx.http.connect({ auth });
    return { ...ctx, auth };
  }

  it('sends the token only to trusted origins (regression)', async () => {
    const { http, fetch } = withAuth(() => ({ body: {} }));
    await http.request({ url: '/me' });
    await http.request({ url: 'https://evil.example.com/steal' });
    await http.request({ url: '/public', auth: false });
    expect((fetch.calls[0].init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    expect((fetch.calls[1].init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((fetch.calls[2].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('refreshes once on 401 and retries', async () => {
    let refreshed = false;
    const { http, fetch } = withAuth(url => {
      if (url.pathname === '/refresh') {
        refreshed = true;
        return { body: { access_token: makeJwt({ exp: Date.now() / 1000 + 3600, v: 2 }) } };
      }
      return refreshed ? { body: { ok: true } } : { status: 401 };
    });
    expect(await http.request({ url: '/me', method: 'POST' })).toEqual({ ok: true });
    expect(fetch.calls.map(c => new URL(c.url).pathname)).toEqual(['/api/me', '/refresh', '/api/me']);
  });

  it('gives up after one refresh attempt', async () => {
    const { http, fetch } = withAuth(url => (url.pathname === '/refresh' ? { body: { access_token: 'x.y.z' } } : { status: 401 }));
    await expect(http.request({ url: '/me' })).rejects.toMatchObject({ status: 401 });
    expect(fetch.calls.filter(c => c.url.endsWith('/refresh'))).toHaveLength(1);
  });
});

describe('HttpClient endpoints', () => {
  it('maps, normalizes nested objects and stores results', async () => {
    const { http, store } = client(() => ({
      body: {
        data: {
          companyId: 7,
          companyName: 'Acme',
          employees: [{ employeeId: 1, name: 'Alice' }, { employeeId: 2, name: 'Bo' }],
          ceo: { employeeId: 1, name: 'Alice' },
        },
      },
    }));
    store.registerType({ name: 'Company' });
    http.defineEndpoint('getCompany', {
      url: '/companies/:id',
      type: 'Company',
      mapping: {
        dataPath: 'data',
        fields: { id: 'companyId', name: { path: 'companyName', transform: v => String(v).toUpperCase() } },
        nested: {
          employees: { type: 'Person', mapping: { fields: { id: 'employeeId', name: 'name' } } },
          ceo: { type: 'Person', mapping: { fields: { id: 'employeeId', name: 'name' } }, as: 'keep' },
        },
      },
    });
    const result = await http.fetchEndpoint('getCompany', { id: 7 });
    expect(result.data).toEqual({ id: 7, name: 'ACME', employees: ['1', '2'], ceo: { id: 1, name: 'Alice' } });
    expect(result.ids).toEqual(['7']);
    expect(store.getData('Person', '2')).toEqual({ id: 2, name: 'Bo' });
    expect(http.getEndpoint('getCompany')).toBeDefined();
    await expect(http.fetchEndpoint('nope')).rejects.toThrow(/Unknown endpoint/);
  });

  it('extracts pagination and populates list views', async () => {
    const { http, listViews } = client(url => ({
      body: {
        items: [{ id: url.searchParams.get('cursor') ? 3 : 1 }, { id: 2 }],
        meta: { next: url.searchParams.get('cursor') ? null : 'c2', total: '3' },
      },
    }));
    http.defineEndpoint('list', { url: '/people', type: 'Person', list: true, mapping: { dataPath: 'items' }, pagination: { cursorPath: 'meta.next', totalCountPath: 'meta.total' } });
    listViews.setLoader((view, opts) => http.loadListView(view, opts));
    const view = listViews.getOrCreate({ type: 'Person', endpoint: 'list', filters: { active: true }, sort: [{ field: 'name', direction: 'desc' }], pageSize: 2 });
    await listViews.load(view);
    expect(view).toMatchObject({ ids: ['1', '2'], nextCursor: 'c2', hasMore: true, totalCount: 3 });
    await listViews.loadMore(view);
    expect(view.ids).toEqual(['1', '2', '3']);
    expect(view.hasMore).toBe(false);
    const result = await http.fetchEndpoint('list', {}, { viewId: view.id, append: true });
    expect(result.page?.nextCursor).toBe('c2');
  });

  it('infers hasMore from full pages without pagination config', async () => {
    const { http } = client(() => ({ body: [{ id: 1 }, { id: 2 }] }));
    http.defineEndpoint('l', { url: '/l', type: 'T', list: true });
    expect((await http.fetchEndpoint('l', { limit: 2 })).page).toEqual({ nextCursor: null, hasMore: true });
    expect((await http.fetchEndpoint('l', { limit: 5 })).page?.hasMore).toBe(false);
    await expect(http.loadListView({ id: 'v', type: 'T', ids: [], filters: {}, sort: [], pageSize: 5, nextCursor: null, hasMore: true, status: 'idle' }, { append: false })).rejects.toThrow(/no endpoint/);
  });

  it('serves cache-first and stale-while-revalidate', async () => {
    let n = 0;
    const { http, store } = client(() => ({ body: { id: 1, v: ++n }, delay: 5 }));
    http.defineEndpoint('get', { url: '/t/:id', type: 'T' });
    expect((await http.fetchEndpoint('get', { id: 1 }, { cache: 'cache-first' })).fromCache).toBe(false);
    const cached = await http.fetchEndpoint('get', { id: 1 }, { cache: 'cache-first' });
    expect(cached).toMatchObject({ fromCache: true, data: { v: 1 } });
    const swr = await http.fetchEndpoint('get', { id: 1 }, { cache: 'swr' });
    expect(swr.data).toEqual({ id: 1, v: 1 });
    expect(store.get('T', '1')?.status).toBe('updating');
    await new Promise(r => setTimeout(r, 20));
    expect(store.getData('T', '1')).toEqual({ id: 1, v: 2 });
    store.invalidate('T', '1');
    const stale = await http.fetchEndpoint('get', { id: 1 }, { cache: 'cache-first' });
    expect(stale.fromCache).toBe(false);
  });

  it('marks objects as errored when background revalidation fails', async () => {
    let fail = false;
    const { http, store } = client(() => (fail ? { status: 500 } : { body: { id: 1 } }), { retry: false });
    http.defineEndpoint('get', { url: '/t/:id', type: 'T' });
    await http.fetchEndpoint('get', { id: 1 });
    fail = true;
    await http.fetchEndpoint('get', { id: 1 }, { cache: 'swr' });
    await new Promise(r => setTimeout(r, 10));
    expect(store.get('T', '1')?.status).toBe('error');
  });
});

describe('HttpClient batching', () => {
  it('sends chunks and stores typed results', async () => {
    const { http, fetch, store } = client((_u, init) => {
      const { operations } = JSON.parse(String(init.body));
      return { body: { results: operations.map((o: { id: string; url: string }) => ({ id: o.id, status: 200, body: { id: o.url.split('/').pop() } })) } };
    }, { batch: { url: '/batch', maxOperations: 2 } });
    http.defineEndpoint('get', { url: '/t/:id', type: 'T' });
    const results = await http.batch([{ endpoint: 'get', params: { id: 1 } }, { endpoint: 'get', params: { id: 2 } }, { url: '/raw/3', method: 'DELETE' }]);
    expect(fetch.calls).toHaveLength(2);
    expect(results.map(r => r.status)).toEqual([200, 200, 200]);
    expect(store.has('T', '1')).toBe(true);
    expect(JSON.parse(String(fetch.calls[0].init.body)).operations[0]).toMatchObject({ method: 'GET', url: '/t/1' });
    await expect(http.batch([{}])).rejects.toThrow(/endpoint or url/);
  });

  it('coalesces batch endpoints and supports custom formats', async () => {
    const { http, fetch, store } = client((_u, init) => {
      const body = JSON.parse(String(init.body)) as Array<{ url: string }>;
      return { body: body.map(o => (o.url.endsWith('/9') ? { status: 404 } : { status: 200, body: { id: o.url.split('/').pop() } })) };
    }, { batch: { url: '/batch', window: 5, buildRequest: ops => ops, parseResponse: b => b as never } });
    http.defineEndpoint('get', { url: '/t/:id', type: 'T', batch: true });
    const [a, b, c] = await Promise.allSettled([1, 2, 9].map(id => http.fetchEndpoint('get', { id })));
    expect(fetch.calls).toHaveLength(1);
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    expect(c.status).toBe('rejected');
    expect(store.has('T', '2')).toBe(true);
    await expect(new HttpClient().batch([])).rejects.toThrow(/No batch endpoint/);
  });
});
