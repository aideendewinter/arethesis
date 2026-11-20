# Changelog

## Unreleased

### Added

- **Polychrome theme** (`arethesis/components/theme-polychrome.css`): an optional palette in the pigments of painted Greek architecture: Egyptian blue, cinnabar, malachite and ochre on limestone, or terracotta and bone on black glaze in dark mode. It has light, dark and high-contrast variants, its own design tokens (`polychrome.resolver.json`), a boot script (`theme-polychrome-boot.js`) and `themeBootHtml({ palette: 'polychrome' })`.
- New tokens in both themes: `--ar-accent-2` (a secondary accent), `--ar-font-display` and `--ar-font-serif`.

### Changed

- The examples have a new look in the Polychrome theme, with self-hosted fonts (Cinzel and Gentium Book Plus, SIL OFL) and a new home page.

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
