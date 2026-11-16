# Core concepts

Arethesis is built around three ideas.

## 1. One normalized store

Every piece of data lives in the **ObjectStore** exactly once, keyed by `type:id`:

```
Person:42  → { id: 42, name: 'Alice', … }
Company:7  → { id: 7, name: 'Acme', employees: ['42', '43'] }
```

Endpoints, SSE messages, WebSocket events and optimistic edits all write to the store. Anything showing `Person:42` (a card, a table row, a list item) subscribes to it and updates when it changes, no matter where the change came from.

Incoming data is **merged**, shallowly by default. So a list endpoint that returns a few fields and a detail endpoint that returns many build up the same object instead of fighting over it.

## 2. List views are ids, not objects

A **ListView** is a thin, ordered list of ids plus pagination state for one query:

```ts
const view = app.list({ type: 'Person', endpoint: 'listPeople', filters: { team: 'core' }, pageSize: 25 });
await app.listViews.load(view);     // first page
await app.listViews.loadMore(view); // next page (cursor-based)
```

Views are keyed deterministically by their config, so two components asking for the same query share one view and one set of requests. When a type is invalidated, views of that type that are on screen refetch automatically.

## 3. Components are views over the store

A **Component** is a Light DOM custom element that renders an HTML template into itself and binds to either one object or a ListView. There's no virtual DOM: bindings remember which DOM nodes show which fields, and only those nodes are touched when data changes.

```
 server ──HTTP──▶ endpoints ──▶ ObjectStore ◀── SSE / WebSocket / optimistic edits
                                   │
                         subscriptions (type:id)
                                   │
                     Components ─ DataBinder ─▶ DOM
```

## Islands

Arethesis is designed for server-rendered pages. Components are islands within static HTML: each binds itself (`data-source="Person:42"`, `data-list="listPeople"`) and shares the global store with every other island on the page. Add `data-hydrate` to keep server-rendered children and bind to them instead of rendering a template.

## Where things live

| You want to… | Use |
| --- | --- |
| Read or write data | `app.store` |
| Fetch from an API | `app.fetch(name, params)` / `app.http` |
| Show a list | `app.list(config)` and a component's `bind(view)` |
| Edit with instant feedback | `app.optimistic.update/create/delete` |
| React to server pushes | `sse`, `websocket` or `azurePubSub` in `init()` |
| Add behavior to elements | mixins (`data-mixin="tooltip"`) |
| Extend the framework | plugins |
