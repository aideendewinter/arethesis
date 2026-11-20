# Changelog

## 0.2.1

### Changed

- **Import only what you use.** The package is now one module per source file, and bundlers can tree-shake it. An app that only uses `ObjectStore` bundles about 2 KB gzipped instead of the whole framework.
  - New entry points: `arethesis/core` (lean, nothing registered globally), `arethesis/realtime`, `arethesis/collab`, `arethesis/mixins`, `arethesis/mixins/<name>`, `arethesis/plugins/<name>`, and `arethesis/components/<name>` for a single kit element.
  - `import 'arethesis'` and `import 'arethesis/components'` work as before.
  - With `arethesis/core`, add `import 'arethesis/realtime'` to use the `sse`, `websocket` and `azurePubSub` options, and `import 'arethesis/collab'` for `app.collab`. `import 'arethesis'` includes both.
  - Minified bundles for `<script type="module">` are in `arethesis/cdn/`.
  - CI checks bundle sizes and that partial imports stay small.
- Importing a mixin or plugin module no longer registers it as a side effect. `import 'arethesis'` still registers all the built-ins. With `arethesis/core`, call `registerBuiltInMixins()` from `arethesis/mixins`, or `mixinRegistry.register()` for just the ones you use.

- **Tooltips, context menus and dropdown lists open as popovers** where the browser supports them. A scrolling table or a card with `overflow: hidden` no longer clips them, and lists follow their input as the page scrolls. Inside a modal `<dialog>` they open in the dialog.
- New rows are inserted in one batch.
- `<a-data-table>`'s `aria-rowcount` now counts the header row, and is `-1` while the total is unknown.
- A list's loading, empty and error placeholders are no longer wrapped in a `<div>`, so a loading `<li>` stays a direct child of its `<ul>`.

### Added

- **`<a-presence>`**: avatars for the people in a collaborative session, with readable initials, tooltips, an overflow list, and optional join and leave announcements. The editor example shows it in its toolbar.
- **`<a-calendar>`**: a date grid with the full keyboard pattern, locale-aware weeks, single or range selection, `min`/`max`, events from a ListView whose date filters follow the month, and form submission.
- **`<a-tree>`**: a tree whose branches are ListViews loaded when they're opened. It has the full tree keyboard pattern, single or multiple selection, "Show more" for long branches, and it's a form control when it has a `name`.
- **`<a-dialog>`** and **`confirm()`**: a native `<dialog>` with a heading, a close button, `closedby`, focus management and a promise for its result, plus a ready-made yes-or-no `alertdialog`. `<a-command-palette>` shares its modal handling. The kanban example asks before deleting a card.
- **`<a-tabs>`**: tabs over headings and sections (or your own tab list), with arrow keys, automatic or manual activation, `hidden="until-found"` panels that find-in-page can open, the tab in the URL with `data-hash`, and lazy panels.
- **`<a-toast>`**, `toast()` and `connectToasts()`: notifications in polite and assertive live regions that are in the page from the start. A toast pauses while hovered or focused, and a toast with an action stays until it's used. `connectToasts(app)` shows rolled-back changes and, if you ask, failed requests. The examples use it.
- `app.http.onError(listener)` reports every failed request; several listeners can subscribe.
- **`<a-combobox>`**: a text field with suggestions, from `<option>`s in the markup, a function or an endpoint. It does fuzzy filtering with highlighted matches, debounced searches that ignore stale results, and it's a form control. The signup example has one.
- **`<a-kanban>`**: a board of cards drawn from the store, grouped by a field and sorted by another. Drag with a mouse, finger or keyboard, or move cards from their menu. Moves are optimistic and roll back if the server refuses. It has optional work-in-progress limits, inline add, and delete (with an optional `beforeDelete` check). The kanban example now uses it.
- **Virtualized lists.** `virtualize` on a list binding renders only the items on screen (`'window'`) or lets the browser skip off-screen ones (`'css'`). `<a-data-table>` takes `virtualize: true`, keeps `aria-rowindex` on every row, and keeps the row being edited. `<a-list>` takes a `virtualize` attribute. New `Component` hooks: `onItemPosition`, `onItemRemove`, `pinItem`, `itemIndex` and `revealItem`.
- **`FormAssociatedComponent`**: a base class for components that are form controls. They submit with a native `<form>`, report `validity`, and handle reset, disabled fieldsets and state restore. `DataBinder` and `<a-form>` treat them as controls.
- `highlightMatch()` wraps fuzzy-matched characters in `<mark>`.
- `attachPopup()` (in `arethesis/mixins`): the popover helper behind the mixins, for your own floating UI.
- `mixinRegistry.ensure(name, mixin)` registers a mixin unless the name is taken.

## 0.2.0

### Added

- **Polychrome theme** (`arethesis/components/theme-polychrome.css`): an optional palette in the pigments of painted Greek architecture: Egyptian blue, cinnabar, malachite and ochre on limestone, or terracotta and bone on black glaze in dark mode. It has light, dark and high-contrast variants, its own design tokens (`polychrome.resolver.json`), a boot script (`theme-polychrome-boot.js`) and `themeBootHtml({ palette: 'polychrome' })`.
- New tokens in both themes: `--ar-accent-2` (a secondary accent), `--ar-font-display` and `--ar-font-serif`.
- **`<a-markdown-editor>`**: a Markdown editor around a plain textarea, with syntax highlighting, line numbers, a toolbar, a live sanitized preview, find and replace, list editing, per-user undo and highlighted ranges. It works under `CollabSession`. `renderMarkdown`, `markdownOutline` and the highlighter are exported too.
- **Per-user undo** for collaborative editing (`{ undo: true }`, `UndoManager`): undo reverts only your own edits.
- **Comments on shared documents**: `session.annotate()` and friends. They stay attached to their text as people edit, and the server stores them.
- Remote collaborators' selections are drawn as well as their carets. `TextareaAdapter` fires `collab:apply` when it changes the value.

### Fixed

- `editable` select editors no longer save (and close) on the first arrow key press on Windows and Linux.
- Fast typing to start editing a table cell no longer drops characters, and IME input works.

- **`<a-command-palette>`**: Ctrl/Cmd+K to search commands and data, with fuzzy matching (`fuzzyMatch`, `fuzzyFilter`), grouped sources (static, searched, or from the store with `storeSource`), recents, and a modal dialog that keeps focus.
- **`<a-sheet>`**: a spreadsheet with formulas, a dependency graph that recalculates only what changed and catches cycles, range selection, fill, clipboard compatible with other spreadsheet apps, per-user undo, and highlighted edits from collaborators. The engine (`SheetModel`, `parseFormula`, `shiftFormula`) is exported.
- **`<a-chart>`**: line, area, bar and stacked-bar SVG charts that stream, resize, and are readable by keyboard and screen reader (crosshair tooltip, arrow-key readout, legend toggles, data table). New `--ar-chart-1` … `--ar-chart-6` tokens in both palettes, checked for color-vision deficiency.
- **`listbox` mixin**: an accessible select-only combobox whose arrow keys never pick a value by accident.
- `openCellEditor()`: the spreadsheet-style cell editor behind `<a-data-table>`, for other grids.

### Changed

- **Editing in `<a-data-table>` works like a spreadsheet.** A click edits the cell; moving with the keyboard only selects. Typing replaces the value, after which the arrow keys save and move. Tab saves and moves right, Enter saves (and can move down with `enterMoves: 'down'`), Escape reverts. The editor floats over the cell, so the table no longer shifts, and edits are announced to screen readers. Choice columns use the new `listbox` instead of a native select.
- The examples have a new look in the Polychrome theme, with self-hosted fonts (Cinzel and Gentium Book Plus, SIL OFL) and a new home page.
- Every example has a command palette ("Ask the Oracle", Ctrl/Cmd+K): go to any page, switch themes, find people, cards, sections, cells and poleis.
- New example: **The Agora**, a live threaded discussion ("Is virtue teachable?") with Socrates, Aristotle, Hypatia and others: top-level threads are a ListView with cursor pagination, infinite scroll and server-side sort; votes are optimistic with rollback; replies arrive over SSE; the feed follows the WAI-ARIA feed pattern. The examples' navigation labels are shorter, to fit eight pages.
- New example: **The Treasury of Athens**, a shared spreadsheet of the Delian League's tribute, with a live chart and Pericles as an optional auditor.
- The dashboard example streams a multi-series traffic chart and grouped bars, and its stat cards use `<a-chart>` sparklines.
- The collaborative editor example is now a Markdown studio, with an outline, comments, presence by section, and Socrates as an optional co-author.

## 0.1.5

### Fixed

- `defineComponent`'s `templateId` option is now used. Components render that template on connect, and return to it after loading or binding. Before, they always looked for `#main`, so a template file without one rendered nothing.

## 0.1.4

### Fixed

- Binding a component to another list now replaces its rows. Before, the old rows were forgotten but stayed on the page, and the new list's rows were added after them. `unbind()` now removes a list's rows too.
- A component moved in the DOM keeps its binding (and live rows) instead of silently losing it.
- `CollabSession` keeps its textarea read-only until the document has loaded. Before, anything typed in that moment was silently replaced by the server's copy, which was easy to hit on a slow connection.

## 0.1.3

0.1.2 was tagged but never published; its changes are in this release.

### Changed

- **Smoother drag and drop** (`sortable`), following [dnd kit](https://dndkit.com/)'s approach:
  - **Starting:** a drag starts after a few pixels of movement, or a press-and-hold on touch screens, so clicks, taps and scrolling still work.
  - **The item stays in place in the DOM** while it's lifted, so components inside it keep their state. Dragging a dashboard panel no longer re-renders it.
  - **The drop position** is the item under the pointer, or the nearest one in two dimensions, so grids, wrapping rows and panels of mixed sizes behave. The closest container wins even from the gap between containers.
  - **Animation:** neighbours slide aside instead of jumping, and the item glides into place on drop. There's no animation with reduced motion.
  - **Auto-scroll** near the edges of scroll containers and the page.
  - New options: `animation`, `activationDistance`, `touchDelay`, `autoScroll`. New event: `sortable:move`.

### Fixed

- `<a-flex-view>`: splitters now appear next to a panel as soon as it's dragged into another row.
- `sortable:end` now fires once the dropped item is in its final position, so listeners can measure it.
- Mixins destroyed with `instance.destroy()` are now removed from the registry, so they can be applied to the same element again. Before, `<a-flex-view>` panels could no longer be dragged after "Reset layout".

## 0.1.1

### Added

- **Design tokens.** The theme is now defined as [W3C design tokens](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) (Design Tokens Format Module 2025.10), with a resolver document for light, dark and high-contrast themes. They're published as `arethesis/tokens/*`, so design tools (such as Tokens Studio) and Style Dictionary can use the same values. `theme.css` is generated from them, and tests keep the two in sync.
- **High-contrast theme.** Follows `prefers-contrast: more`, or `data-contrast="more"` on `<html>`. Every text color meets WCAG AAA contrast (7:1), borders reach 3:1, and focus rings are solid.
- **Flash-free theme switching.**
  - `setTheme()`, `setContrast()`, `getTheme()` and `getContrast()` switch and remember the user's choice.
  - A boot snippet applies a saved choice before the first paint, so the page never flashes the wrong theme: either the drop-in `arethesis/components/theme-boot.js`, or `themeBootHtml()` for servers.

### Changed

- The release workflow is safe to re-run: it skips versions already on npm and releases that already exist.

## 0.1.0

The first public release.

### Highlights

- **Component kit** (`arethesis/components`): `<a-data-table>`, `<a-flex-view>`, `<a-list>`, `<a-form>` and a themeable light/dark stylesheet.
- **Collaborative editing**: a convergent OT implementation (`TextOperation`, `OTClient`), a reference `CollabServer`, and `CollabSession` with presence, live cursors and offline edits.
- **Endpoints**: named endpoints with path params, response mapping with nested normalization, cursor pagination, cache modes (`cache-first`, `swr`) and batching.
- **List views** that load, page, sort, filter and refetch themselves.
- **Components** bind to lists with keyed reconciliation, loading/empty/error templates, infinite scroll, events and declarative islands (`data-source`, `data-list`, `data-hydrate`).
- **Nine mixins**: `draggable`, `editable`, `grid-navigation`, `infinite-scroll`, `sortable`, `resizable`, `dropdown`, `tooltip`, `context-menu`. All are keyboard accessible and emit events for declarative use.
- **Plugins**: a dependency-free `rich-text` editor, `date-utils` and `async-validators`, loadable by name.
- **Auth**: token storage options, 401 refresh-and-retry, cross-tab sync.
- **Persistence**: on by default, batched writes, `maxAge`, graceful fallback.

### Security

- Bearer tokens are only sent to trusted origins.
- Link and image URLs are sanitized; `html` bindings are sanitized by default.
- Merges and mappings are protected against prototype pollution.
- Logout clears cached data from memory and IndexedDB.
- Azure Web PubSub cache invalidation only honors server messages.

### Reliability

- Concurrent optimistic updates never undo each other (field-level rollback).
- Empty responses are handled cleanly, and POST/PATCH are never retried unless you opt in.
- A network blip during token refresh never logs the user out.
- Dates are parsed and formatted in local time everywhere.
- The OT engine is property-tested to converge for concurrent edits.
- Keyboard focus is never trapped by grid navigation.
