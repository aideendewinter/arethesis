# Getting started

## Install

```bash
npm install arethesis
```

Arethesis ships as ES modules with TypeScript types. It has no runtime dependencies.

## Import only what you use

`import … from 'arethesis'` gives you everything, with the defaults installed: the built-in mixins work in `data-mixin`, the built-in plugins load by name, and `app.collab` is ready. For a smaller bundle, start from the lean core and add what you need. Your bundler drops the rest.

| Import | What you get |
| --- | --- |
| `arethesis` | Everything, with the defaults installed |
| `arethesis/core` | The store, list views, HTTP, components, binding and utilities. Nothing is registered globally |
| `arethesis/realtime` | SSE, WebSocket and Azure Web PubSub managers, and OT; importing it enables the `sse`, `websocket` and `azurePubSub` options |
| `arethesis/collab` | Collaborative editing; importing it enables `app.collab` |
| `arethesis/mixins` | The mixins; call `registerBuiltInMixins()` to use them in `data-mixin` |
| `arethesis/plugins/<name>` | One plugin: `date-utils`, `async-validators` or `rich-text` |
| `arethesis/components` | Every kit element |
| `arethesis/components/<name>` | One kit element, such as `data-table` or `chart` |

```ts
import { getArethesis } from 'arethesis/core';
import 'arethesis/components/data-table';
import { richTextPlugin } from 'arethesis/plugins/rich-text';

await getArethesis().use(richTextPlugin()).init({ http: { baseUrl: '/api' } });
```

With `arethesis/core`, `init()` throws if you pass `sse`, `websocket` or `azurePubSub` without importing `arethesis/realtime`, and names the import.

Without a bundler, use the minified files in `arethesis/cdn/`: `arethesis.min.js` and `components.min.js`, which share their chunks.

## Initialize once per page

```ts
import { getArethesis } from 'arethesis';

const app = getArethesis();
await app.init({
  http: { baseUrl: '/api' },
});
```

`getArethesis()` returns a shared instance. `init()` is idempotent: calling it again returns the same promise.

Everything is optional. A typical setup adds authentication, live updates and a few types and endpoints:

```ts
await app.init({
  http: { baseUrl: 'https://api.example.com', headers: { 'X-Client': 'web' } },
  auth: { loginUrl: '/auth/login', refreshUrl: '/auth/refresh', logoutUrl: '/auth/logout' },
  sse: { url: '/events' },
  types: [{ name: 'Person', endpoint: 'getPerson' }],
  endpoints: {
    getPerson: { url: '/people/:id', type: 'Person' },
    listPeople: { url: '/people', type: 'Person', list: true, pagination: { cursorPath: 'meta.next' } },
  },
  plugins: ['date-utils'],
});
```

## Your first component

```ts
import { Component, defineComponent } from 'arethesis';

@defineComponent({
  tag: 'person-card',
  html: `
    <template id="main">
      <h2 data-bind="name"></h2>
      <p data-bind="title"></p>
    </template>
    <template id="loading"><p>Loading…</p></template>
    <template id="error"><p data-error-message></p><button data-retry>Retry</button></template>`,
})
export class PersonCard extends Component {
  static bindConfig = { fields: { name: {}, title: {} } };
}
```

Place it in HTML and point it at an object:

```html
<person-card data-source="Person:42"></person-card>
```

The component renders the `main` template, finds `Person:42` in the store (fetching it through the type's `endpoint` if needed, with the `loading` and `error` templates shown along the way), fills in `[data-bind]` elements, and updates them whenever the object changes.

You can also bind from code:

```ts
document.querySelector('person-card').bind({ type: 'Person', id: 42 });
```

## Templates in files

Instead of `html`, point `template` at an HTML file containing `<template id="…">` elements. Files are fetched once and cached:

```ts
@defineComponent({ tag: 'person-card', template: '/templates/person-card.html' })
```

## A list in pure HTML

With the component kit you can render a paginated, live-updating list without writing any JavaScript:

```html
<script type="module">
  import 'arethesis/components';
</script>
<link rel="stylesheet" href="/node_modules/arethesis/dist/theme.css">

<a-list data-list="listPeople" infinite>
  <template data-item>
    <li><strong data-bind="name"></strong> <span data-bind="role" data-display="badge"></span></li>
  </template>
  <template data-empty><li>No one here yet.</li></template>
</a-list>
```

## Next steps

- [Core concepts](concepts.md) explains the store, list views and components.
- [HTTP](http.md) covers endpoints, mapping, pagination and auth.
- [Components](components.md) covers lists, events, templates and islands.
