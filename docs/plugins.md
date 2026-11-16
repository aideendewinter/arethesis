# Plugins

A plugin bundles mixins, validators and lifecycle hooks.

```ts
import type { ArethesisPlugin } from 'arethesis';

export const analytics: ArethesisPlugin<{ key: string }> = {
  name: 'analytics',
  install(app, options) { /* registered: mixins and validators are available now */ },
  beforeInit(config, app) { return { ...config, http: { ...config.http, headers: { ...config.http?.headers, 'X-Trace': 'on' } } }; },
  afterInit(app) { app.optimistic.on('rollback', e => track('rollback', e)); },
  mixins: { 'track-clicks': (el, opts) => ({ name: 'track-clicks', element: el, options: opts, destroy() {} }) },
  validators: { notDisposable: { fn: v => !String(v).endsWith('@mailinator.com'), message: 'Use a permanent address' } },
  extendComponent(Component) { /* patch Component.prototype if you must */ },
  destroy(app) {},
};

app.use(analytics, { key: '…' });
// or: init({ plugins: [{ plugin: analytics, options: { key: '…' } }] })
```

Plugins listed in `init({ plugins })` get every hook. Plugins added after `init()` get `afterInit` right away.

## Built-in plugins

Load them by name: `init({ plugins: ['date-utils', 'rich-text', { plugin: 'async-validators', options: { debounce: 400 } }] })`.

### date-utils

All dates are parsed in the user's timezone (`'2026-03-02'` is March 2nd everywhere).

- Mixins: `datepicker` (`min`, `max`; emits `datepicker:change`) and `daterange` (two inputs that constrain each other; emits `daterange:change` with `{ start, end }`).
- Validators: `futureDate {includeToday}`, `pastDate {includeToday}`, `dateRange {min, max}`, `businessDay`, `minAge {years}`.

### async-validators

Server-side checks, debounced per field and cancelled when superseded. Requests go through `app.http`, so `baseUrl` and auth apply. If a check can't complete, the value is accepted (`failOpen: false` changes that).

- `usernameAvailable {endpoint, param, minLength}` expects `{ available }`
- `uniqueField {endpoint, field, excludeId}` expects `{ exists }`
- `validEmailDomain {allowed, blocked, checkMx, mxEndpoint}`
- `remote {endpoint, param, validPath, messagePath}`: anything else

### rich-text

A dependency-free editor: `data-mixin="rich-text"` on a `<div>` (which becomes editable) or a `<textarea>` (hidden and kept in sync for forms). It has a WAI-ARIA toolbar with `aria-pressed` state, keyboard shortcuts (Ctrl/Cmd+B/I/U/K), an inline link editor, and sanitized paste. Output is always sanitized. It emits `rich-text:change` with `{ html, text }`.

Options: `toolbar` (any of `bold italic underline strike h2 h3 paragraph bulletList orderedList blockquote code link clear undo redo`), `placeholder`, `label`, `sanitize`.
Validators: `richTextMinLength {min}`, `richTextMaxLength {max}`, `noEmptyParagraphs`.
