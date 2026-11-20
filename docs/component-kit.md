# Component kit

```ts
import 'arethesis/components';
import 'arethesis/components/theme.css';
```

The theme styles the kit and everything the framework generates (tooltips, menus, dropdowns, the editor, validation messages, skeletons). It's built on CSS custom properties: override `--ar-accent`, `--ar-radius`, `--ar-font` and friends on `:root` or any container.

## Theming

### Light, dark and high contrast

The theme follows the OS:

- **Dark mode** follows `prefers-color-scheme`.
- **High contrast** follows `prefers-contrast: more`. It uses stronger text, borders and focus rings, and every text color reaches WCAG AAA contrast (7:1).

Let users override either from your UI:

```ts
import { setTheme, setContrast, getTheme, getContrast } from 'arethesis/components';

setTheme('dark');       // 'light' | 'dark' | 'system'
setContrast('more');    // 'more' | 'standard' | 'system'
getTheme();             // the theme in effect: 'light' | 'dark'
```

- **Storage:** choices are saved in localStorage (`ar-theme`, `ar-contrast`). You can pass `{ themeKey, contrastKey }` to use other keys.
- **Markup:** choices are applied as `data-theme` and `data-contrast` on `<html>`. You can set those attributes yourself instead.
- **Events:** an `ar-theme-change` event fires on `<html>` whenever the theme or contrast changes.

### No flash of the wrong theme

A saved choice has to be applied before the page first paints, or the page flashes the OS theme (often white) first. Put the boot snippet at the top of `<head>`, using either option:

```html
<!-- A plain (not module) script, so it runs before the first paint: -->
<script src="/node_modules/arethesis/dist/theme-boot.js"></script>
```

```ts
// Or inline it from your server or build. Pass a nonce if your CSP needs one:
import { themeBootHtml } from 'arethesis/components';
const head = themeBootHtml({ nonce });
```

The snippet applies the saved theme and contrast. It also adds a few critical rules: background, text color and `color-scheme` for every theme, so the first frame is right even before `theme.css` loads.

### The Polychrome theme

An optional second palette, the one the examples use. Greek temples and statues were painted in strong colors; the white-marble look is what's left once the paint wears off. Polychrome recolors the theme in those pigments: Egyptian blue, cinnabar, malachite and ochre on limestone in light mode, and terracotta and bone on black glaze in dark mode, like red-figure pottery. It has light, dark and high-contrast variants with the same contrast targets as the default.

```ts
import 'arethesis/components/theme.css';
import 'arethesis/components/theme-polychrome.css'; // after theme.css
```

It only sets custom properties, so everything else works the same. For the boot snippet, use `theme-polychrome-boot.js` or `themeBootHtml({ palette: 'polychrome' })`.

Polychrome also sets `--ar-font-display` (Cinzel, for headings) and `--ar-font-serif` (Gentium Book Plus, for reading text, with polytonic Greek). Both fonts are SIL OFL and are **not bundled**: load them with `@font-face` (the examples self-host them in `examples/shared/fonts/`), or the stacks fall back to system serifs. The default theme defines both properties as system serif stacks, and both palettes define `--ar-accent-2`, a secondary accent for decoration and second data series.

### Design tokens

The theme's values come from design tokens in the [W3C Design Tokens Format](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) (2025.10): colors, shadows, font stacks, radii and spacing. They ship with the package, so designers and other tools can use the same source:

| File | Contents |
| --- | --- |
| `arethesis/tokens/arethesis.resolver.json` | A [resolver document](https://www.w3.org/community/reports/design-tokens/CG-FINAL-resolver-20251028/) that combines the files below. Resolve it with `{ "theme": "light" \| "dark" \| "light-high-contrast" \| "dark-high-contrast" }`. |
| `arethesis/tokens/base.tokens.json` | Fonts, radii, spacing |
| `arethesis/tokens/light.tokens.json`, `dark.tokens.json` | Colors and shadows |
| `arethesis/tokens/light-high-contrast.tokens.json`, `dark-high-contrast.tokens.json` | High-contrast overrides, applied on top of light or dark |
| `arethesis/tokens/polychrome.resolver.json` | The Polychrome theme: the same files, with the `polychrome.*.tokens.json` overrides layered on top |

- **Colors** use the spec's sRGB form (`colorSpace`, `components`), with a 6-digit `hex` fallback for tools that still expect hex.
- **CSS names:** each token maps to a custom property named after its path, without the `color` group. For example, `color.text.muted` becomes `--ar-text-muted`, and `radius.sm` becomes `--ar-radius-sm`.
- **Resolver `version`:** the 2025.10 resolver spec gives two different values for `version`, `2025-10-01` and `2025-11-01`. The tokens use `2025-10-01`, the value in the spec's own property table.

To rebrand, override custom properties as above, or copy the tokens, change them and generate your own CSS with Style Dictionary or a similar tool.

Contributing to Arethesis: `theme.css` and `theme-polychrome.css` are generated from `src/kit/tokens/`. Edit the tokens, then run `npm run tokens`. The tests fail if the CSS is out of date, if a token breaks the spec, or if a theme drops below its contrast target.

## `<a-markdown-editor>`

A Markdown editor around a plain `<textarea>`, which stays the real editing surface: forms, spellcheck, IME, assistive technology and `CollabSession` keep working.

```html
<label for="notes">Notes</label>
<a-markdown-editor layout="split">  <!-- split | write | preview -->
  <textarea id="notes" name="notes"></textarea>
</a-markdown-editor>
```

- **Highlighting** in a layer behind the textarea's transparent text, re-done only for the lines that change, with line numbers that follow soft wraps.
- **Toolbar** (a WAI-ARIA toolbar): bold, italic, strikethrough, code, headings, quotes, lists, checklists, links and code blocks. Ctrl/Cmd+B, I and K. Enter continues a list, Tab and Shift+Tab indent list items.
- **Live preview**, sanitized, scrolled in step with the source.
- **Find and replace** with Ctrl/Cmd+F. Replace all is one edit, so one undo.
- **Undo and redo** of your own edits. Under a `CollabSession` it follows other people's edits (through the textarea's `collab:apply` event) and never undoes them.
- **Marks:** `editor.annotations = [{ id, from, to, color, active }]` highlights ranges, such as comments.

API: `outline` (headings, also sent as `markdown:outline`), `revealOffset(offset)`, `format(command)`, `replaceRange(from, to, text)`, `undo()`, `redo()`, `openFind()`, `refresh()`. Events: `markdown:selection` `{ from, to }`, `markdown:outline`, `markdown:layout`.

Collaborative:

```ts
const session = app.collab.open('notes', editor.textarea!, { user });
session.on('annotations', list => (editor.annotations = list.map(a => ({ ...a, color: a.user?.color }))));
```

The renderer and highlighter are exported on their own too: `renderMarkdown(source)` returns sanitized HTML (CommonMark core plus GFM tables, task lists and strikethrough; raw HTML is shown as text), and `markdownOutline`, `highlightMarkdown` and `highlightLine` power the rest. Add `class="ar-prose"` to style rendered Markdown anywhere.

## `<a-data-table>`

```ts
const table = document.querySelector('a-data-table');
table.configure({
  caption: 'People',
  list: { type: 'Person', endpoint: 'listPeople', pageSize: 50 },
  columns: [
    { field: 'name', label: 'Name', sortable: true, editable: { validation: { rules: [{ type: 'required' }] } } },
    { field: 'role', label: 'Role', displayType: 'badge' },
    { field: 'salary', label: 'Salary', displayType: 'currency', align: 'end', editable: { type: 'number' } },
  ],
  save: { endpoint: 'updatePerson' }, // or (id, changes) => Promise
});
table.on('row-select', ({ id }) => …);
table.on('save', ({ id, changes }) => …);
table.on('save-error', ({ error }) => …);
table.setFilters({ team: 'core' });
table.setSort([{ field: 'name', direction: 'desc' }]);
```

It renders an ARIA grid with sticky headers, sorting from the header (with `aria-sort`), resizable columns, infinite scroll, arrow-key navigation, and type-to-edit inline editing. Edits are validated, saved optimistically, and rolled back (with a visual cue) if the server refuses them. Set the height with `--ar-table-height`.

## `<a-list>`

A list with no JavaScript. Fields come from `data-bind` in the item template; `data-display`, `data-format` and `data-attribute` configure them.

```html
<a-list data-list="listPeople" data-filters='{"team":"core"}' data-page-size="20" infinite>
  <template data-item><li><b data-bind="name"></b> <time data-bind="joined" data-display="relative"></time></li></template>
  <template data-empty><li>Nobody yet.</li></template>
  <template data-loading><li class="ar-skeleton"></li></template>
  <template data-error><li>Couldn’t load. <button data-retry>Retry</button></li></template>
</a-list>
```

## `<a-form>`

Progressive enhancement for a regular `<form>`:

```html
<a-form data-endpoint="createAccount" data-type="Account">
  <form>
    <div data-error-summary hidden></div>
    <label for="email">Email</label> <input id="email" name="email" type="email" required>
    <label for="user">Username</label>
    <input id="user" name="username" required minlength="3" data-rules='[{"type":"usernameAvailable"}]'>
    <button>Create account</button>
  </form>
</a-form>
```

Native attributes (`required`, `type`, `minlength`, `maxlength`, `min`, `max`, `pattern`) become rules, and `data-rules` adds any validator. On submit it validates, shows the summary, sends the values, maps `422 { errors: { field: message } }` onto the inputs, and stores the result. Events: `submit-success`, `submit-error`, and `submit-valid` (when there's no `data-endpoint`). Use `data-source="Type:id"` to edit an existing object (sends `PATCH`) and `data-reset` to clear the form after success.

## `<a-flex-view>`

A dashboard of panels, each hosting any component bound to an object or a list:

```ts
dashboard.configure({
  id: 'home', // the layout is saved in the store under this id (and persisted)
  children: [
    { key: 'revenue', title: 'Revenue', component: 'stat-card', binding: { type: 'Metric', id: 'revenue' } },
    { key: 'orders', title: 'Orders', component: 'order-list', list: { type: 'Order', endpoint: 'listOrders' }, flex: '2', scrollable: true },
  ],
});
dashboard.resetLayout();
```

Users can reorder panels (drag a header, or focus a panel and press Space then the arrow keys) and resize them. The order and sizes are remembered.

Resizing follows the [window splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) pattern:

- **Width:** the gap between two panels in the same row is a splitter. Dragging it moves space from one panel to the other, so the row stays full and no panel jumps to another row mid-drag. The last panel in a row is resized from its left edge. There is no splitter at the end of a row, or between panels that wrapped onto different rows.
- **Keyboard:** splitters are focusable `role="separator"` elements. The arrow keys move them 16px (64px with Shift), and Home and End go to the limits. `aria-valuenow` is the left panel's share of the pair, in percent.
- **Height:** a panel's bottom edge changes its height.
- **Limits and storage:** each panel keeps its `minWidth` and `maxWidth`. Widths are stored as `flex-grow` ratios rather than pixels, so a saved layout still fits on a different screen width.
- **Events:** `panel-resize` (detail `{ key, neighbour }`) and `layout-change`.

Set `resizable: false` on a panel to give it a fixed share; splitters next to it are hidden.
