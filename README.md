# Arethesis

[![CI](https://github.com/aideendewinter/arethesis/actions/workflows/ci.yml/badge.svg)](https://github.com/aideendewinter/arethesis/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Data-driven web components, without the framework tax.**

Arethesis gives server-rendered pages a normalized data store, config-driven APIs, live updates, collaborative editing, and accessible UI behaviors, all built on plain HTML and Light DOM custom elements. There's no virtual DOM, no compiler and no runtime dependencies.

```bash
npm install arethesis
```

- **Light DOM components.** Your CSS and dev tools just work, and server-rendered markup hydrates in place.
- **One normalized store.** Every object lives once under `type:id`. Change it anywhere and every view of it updates.
- **Config-driven HTTP.** Named endpoints, response mapping, nested normalization, cursor pagination, safe retries, batching and cache modes.
- **Live by default.** SSE cache invalidation, WebSocket channels, Azure Web PubSub, and convergent operational transformation for collaborative text.
- **Offline-ready.** IndexedDB persistence, TTLs, optimistic updates with field-level rollback.
- **Pay for what you use.** One module per file and per-feature entry points (`arethesis/core`, `arethesis/realtime`, `arethesis/components/<name>`), with bundle sizes checked in CI.
- **Accessible behaviors.** Ten keyboard-friendly mixins with ARIA built in: sortable, grid navigation, dropdown, context menu and more.
- **Secure defaults.** Sanitized HTML and URLs, origin-scoped auth headers, prototype-pollution-safe merges, and a logout that wipes cached data.

**[Live examples →](https://aideendewinter.github.io/arethesis/)**: a 10,000-row directory, a kanban board, a collaborative editor, a live dashboard, a signup form, and an offline/caching playground. Run them locally with `npm run examples`; the source is in [`examples/`](examples/).

---

## 60-second tour

```ts
import { getArethesis, defineType, defineEndpoint, Component, defineComponent } from 'arethesis';

// 1. Describe your data and where it comes from.
defineType({ name: 'Person', endpoint: 'getPerson', ttl: 5 * 60_000 });
defineEndpoint('getPerson', {
  url: '/people/:id',
  type: 'Person',
  mapping: { fields: { id: 'id', name: 'fullName', email: 'contact.email' } },
});

// 2. Start the app.
const app = getArethesis();
await app.init({
  http: { baseUrl: 'https://api.example.com' },
  auth: { loginUrl: '/auth/login', refreshUrl: '/auth/refresh' },
  sse: { url: '/events' }, // server pushes { type, id } to invalidate objects
});

// 3. Define a component. Its template is plain HTML.
@defineComponent({
  tag: 'person-card',
  html: `
    <template id="main">
      <h2 data-bind="name"></h2>
      <a data-bind="email"></a>
    </template>
    <template id="loading"><div class="skeleton"></div></template>`,
})
class PersonCard extends Component {
  static bindConfig = {
    fields: { name: {}, email: { displayType: 'link', href: v => `mailto:${v}` } },
  };
}
```

```html
<!-- 4. Use it anywhere. It fetches, renders, and refetches when the server says the data changed. -->
<person-card data-source="Person:42"></person-card>
```

When the server sends `invalidate { type: "Person", id: 42 }` over SSE, every `<person-card>` showing person 42 refetches and patches only the text that changed.

## What's inside

| Area | What you get |
| --- | --- |
| **Store** | `ObjectStore` with shallow/deep/custom merges, TTL, version-based conflict rejection, batching, per-object and per-type subscriptions |
| **Lists** | `ListView`s: deterministic ids, filters and sort sent to the server, cursor pagination, `load` / `loadMore` / `refresh`, auto-refetch when invalidated |
| **HTTP** | Named endpoints with `:params`, response mapping with nested normalization, retries only for idempotent methods, Retry-After, timeouts, AbortSignal, interceptors, GET dedupe, `cache-first` / `swr`, batching |
| **Auth** | JWT lifecycle with refresh before expiry, a 401 triggers refresh and one retry, local/session/memory storage, cross-tab sync, bearer token only sent to trusted origins |
| **Components** | `Component` base class: object and list binding, keyed reconciliation, loading/empty/error templates, retry, infinite scroll, `on`/`emit`, islands via `data-source` / `data-list` |
| **Binding** | `DataBinder`: 15 display types, two-way inputs, safe URL/HTML rendering, validation UI with an accessible error summary |
| **Validation** | 16 built-in validators, async validators with cancellation, `{param}` messages, translations |
| **Real-time** | `SSEManager`, `WebSocketManager`, `AzurePubSubManager` with shared reconnect/backoff, token refresh on reconnect, status events |
| **Collaboration** | `TextOperation` OT, `OTClient`, a reference `CollabServer`, and `CollabSession` with presence, live cursors and selections, per-user undo, and comments anchored to their text |
| **Mixins** | `draggable`, `editable`, `grid-navigation`, `infinite-scroll`, `sortable`, `resizable`, `dropdown`, `listbox`, `tooltip`, `context-menu` |
| **Plugins** | `date-utils`, `async-validators`, a dependency-free `rich-text` editor, and an API for your own |
| **Component kit** | `<a-data-table>` with spreadsheet-style editing and virtualized rows, `<a-sheet>` (formulas, fill, clipboard), `<a-chart>` (streaming SVG charts), `<a-kanban>`, `<a-combobox>`, `<a-tree>` (lazy branches), `<a-calendar>`, `<a-tabs>`, `<a-dialog>` and `confirm()`, `<a-toast>`, `<a-presence>`, `<a-markdown-editor>`, `<a-command-palette>`, `<a-flex-view>`, `<a-list>`, `<a-form>`, and a themeable stylesheet: light, dark and high contrast, without a flash on load, plus the optional Polychrome palette. Import them all, or one at a time (`arethesis/components/kanban`) |
| **Design tokens** | The theme as [W3C design tokens](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) (2025.10) with a resolver, published as `arethesis/tokens/*` |

## Documentation

- [Getting started](docs/getting-started.md)
- [Core concepts](docs/concepts.md)
- [Data: store, list views, optimistic updates, persistence](docs/data.md)
- [HTTP and authentication](docs/http.md)
- [Components](docs/components.md)
- [Binding and validation](docs/binding.md)
- [Real-time and collaboration](docs/realtime.md)
- [Mixins](docs/mixins.md)
- [Text, settings and keyboard](docs/text-and-input.md)
- [Plugins](docs/plugins.md)
- [Component kit](docs/component-kit.md)
- [Security](docs/security.md)
- API reference: `npm run docs` generates it into `docs/api/`.

## Browser support

Arethesis targets evergreen browsers (the last two versions of Chrome, Edge, Firefox and Safari). It uses Custom Elements, ES2022 classes and private fields, `AbortController`, `IntersectionObserver`, and (optionally) IndexedDB, `EventSource` and `WebSocket`.

## Using decorators

`@defineComponent` works with TypeScript's `experimentalDecorators` and with standard decorators. If your toolchain does neither, call it as a function:

```ts
class PersonCard extends Component {}
defineComponent({ tag: 'person-card', html: '…' })(PersonCard);
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
