# Data

## ObjectStore

```ts
const store = app.store;

store.upsert('Person', 42, { name: 'Alice' });           // create
store.upsert('Person', 42, { role: 'Engineer' });      // shallow merge
store.get('Person', 42);       // { id, type, data, version, lastUpdated, sources, status }
store.getData('Person', 42);   // just the data
store.getByType('Person');
store.query('Person', p => p.role === 'Engineer');
store.delete('Person', 42);
```

### Types

```ts
defineType({
  name: 'Person',
  idField: 'uuid',            // default 'id'
  defaultMerge: 'shallow',    // 'replace' | 'shallow' | 'deep' | (existing, incoming, ctx) => merged
  ttl: 5 * 60_000,            // objects older than this read as 'stale'
  versionField: 'updatedAt',  // ignore incoming data older than what's stored
  persist: true,              // save to IndexedDB (default true)
  endpoint: 'getPerson',      // used to fetch/refetch single objects for bound components
});
```

### Subscriptions

```ts
const off = store.subscribe('Person', 42, (obj, event) => { /* 'update' | 'delete' | 'invalidate' */ });
store.subscribeToType('Person', (obj, event) => {});
off();
```

`store.batch(() => { … })` delivers notifications once at the end. `upsertMany(type, items)` reads ids with the type's `idField` and batches automatically.

### Status

Each object has a `status`: `fresh`, `stale` (invalidated or past its TTL), `updating`, or `error`. Components reflect it with `data-stale` and `data-updating` attributes, so you can style refreshes.

## List views

```ts
const view = app.listViews.getOrCreate({
  type: 'Person',
  endpoint: 'listPeople',
  filters: { team: 'core' },            // sent as query params
  sort: [{ field: 'name', direction: 'asc' }], // sent as sort=name:asc
  pageSize: 50,                          // sent as limit=50
});

await app.listViews.load(view);
await app.listViews.loadMore(view);  // uses view.nextCursor
await app.listViews.update(view.id, { filters: { team: 'web' } }); // reset and reload
app.listViews.subscribe(view.id, v => console.log(v.ids, v.status, v.hasMore));
```

`status` is `idle`, `loading`, `loaded`, `loading-more`, `error` or `stale`. Concurrent loads share one request, and starting a fresh load aborts a pending `loadMore`.

## Optimistic updates

```ts
await app.optimistic.update('Task', 7, { done: true },
  () => app.request({ url: '/tasks/:id', method: 'PATCH', params: { id: 7 }, body: { done: true } }));

await app.optimistic.create('Task', { title: 'New' },
  () => app.request({ url: '/tasks', method: 'POST', body: { title: 'New' } }),
  { views: [view.id], position: 'start' });

await app.optimistic.delete('Task', 7, () => app.request({ url: '/tasks/:id', method: 'DELETE', params: { id: 7 } }));
```

Rollbacks are **field-level**: only the fields this operation changed are restored, and only if nobody else changed them in the meantime. Deletes are restored at their original positions in every list view. Listen to `start`, `commit` (with `resultId` for creates) and `rollback` events to show feedback.

## Persistence

Persistence is on by default. Every object of a type with `persist !== false` is written to IndexedDB in batches and restored into the store on the next page load (marked with the `indexeddb` source).

```ts
await app.init({ persistence: { dbName: 'my-app', maxAge: 24 * 3600_000 } });
await app.init({ persistence: false }); // off
```

If IndexedDB is unavailable or never answers (some private modes and sandboxes), persistence switches itself off and the app keeps working. `app.logout()` clears both the store and IndexedDB.
