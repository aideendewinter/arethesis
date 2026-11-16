# Changelog

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
