# HTTP and authentication

## Configuration

```ts
await app.init({
  http: {
    baseUrl: 'https://api.example.com',
    headers: {
      'X-Client': 'web',
      'X-Tenant': () => currentTenant(),     // evaluated per request
      'X-Request-Id': () => crypto.randomUUID(),
    },
    timeout: 30_000,
    retry: { maxAttempts: 3, baseDelay: 500, maxDelay: 10_000 },
    trustedOrigins: ['https://files.example.com'], // also receive the bearer token
    interceptors: {
      request: ctx => { /* mutate ctx.init / ctx.url */ },
      response: (res, ctx) => res,
      error: (err, ctx) => report(err),
    },
    fetch: customFetch, // for tests, SSR or mock backends
  },
});
```

## Requests

```ts
const people = await app.request({ url: '/people', params: { team: 'core', tags: ['a', 'b'] } });
await app.request({ url: '/people/:id', method: 'PATCH', params: { id: 42 }, body: { name: 'Alice' } });
```

- `:name` path segments are filled from `params`; the rest become the query string.
- Bodies are JSON unless they are `FormData`, `Blob`, `URLSearchParams`, `ArrayBuffer` or a string.
- Empty responses resolve to `undefined`. Invalid JSON throws an `HttpError` with `kind: 'parse'`.
- Failures throw `HttpError` with `status`, `body`, `kind` (`http`, `network`, `timeout`, `parse`), and `displayMessage`.
- Identical in-flight GETs are shared.

### Retries

Only **idempotent** methods (GET, HEAD, PUT, DELETE, OPTIONS) are retried, on network errors, timeouts and `408, 425, 429, 500, 502, 503, 504`, with exponential backoff and jitter. `Retry-After` is honored. POST and PATCH are retried only with `retry: { retryNonIdempotent: true }`, which you should use only when your API deduplicates them (for example with an idempotency key).

## Endpoints

```ts
defineEndpoint('listPeople', {
  url: '/people',
  type: 'Person',
  list: true,
  mapping: {
    dataPath: 'data',
    fields: {
      id: 'id',
      name: 'fullName',
      avatar: 'profile.image.url',
      hiredAt: { path: 'employment.start', transform: v => new Date(v) },
    },
    nested: {
      team: { type: 'Team', path: 'team', mapping: { fields: { id: 'teamId', name: 'teamName' } } },
    },
  },
  pagination: { cursorPath: 'meta.nextCursor', totalCountPath: 'meta.total' },
});

const people = await app.fetch('listPeople', { team: 'core' });
```

- `fields` maps target fields to dotted source paths. Without `fields`, items are stored as-is (`keepUnmapped: true` combines both).
- `nested` normalizes related objects into their own type and replaces them with ids (or keeps them inline with `as: 'keep'`).
- `pagination` reads the next cursor, `hasMore` and the total count. The cursor, page size and sort are sent as `cursor`, `limit` and `sort` (rename them with `cursorParam`, `limitParam`, `sortParam`).

### Cache modes

```ts
await app.fetch('getPerson', { id: 42 }, { cache: 'cache-first' }); // fresh store copy or network
await app.fetch('getPerson', { id: 42 }, { cache: 'swr' });         // store copy now, revalidate in the background
```

### Batching

```ts
await app.init({ http: { batch: { url: '/batch', maxOperations: 50 } } });

const results = await app.http.batch([
  { endpoint: 'getPerson', params: { id: 1 } },
  { url: '/tasks/9', method: 'DELETE' },
]);
```

Mark an endpoint `batch: true` and calls made within `batch.window` ms (default 10) are coalesced into one request automatically. Customize the wire format with `buildRequest` and `parseResponse`.

## Authentication

```ts
await app.init({
  auth: {
    loginUrl: '/auth/login',
    refreshUrl: '/auth/refresh',
    logoutUrl: '/auth/logout',
    storage: 'local',          // 'local' | 'session' | 'memory' | Storage
    refreshThreshold: 60,      // refresh when the token expires within 60s
    onSessionExpired: () => location.assign('/login'),
    tokenPaths: { accessToken: 'access_token', refreshToken: 'refresh_token' },
  },
});

await app.login({ email, password });
app.auth.isAuthenticated();
app.auth.getUser(); // decoded JWT claims
await app.logout(); // posts the refresh token to logoutUrl so the server can revoke it, then clears tokens, store and IndexedDB
```

- Tokens are refreshed shortly before they expire; concurrent requests share one refresh.
- A `401` triggers one refresh-and-retry.
- The session only ends when the refresh endpoint rejects the refresh token (400/401/403). Being offline never logs anyone out.
- The bearer token is only attached to requests for the page origin, the `baseUrl` origin and `trustedOrigins`.
- Token changes in other tabs are picked up automatically.
