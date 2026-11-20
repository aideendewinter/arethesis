# Component kit

```ts
import 'arethesis/components';            // every element, or one at a time:
import 'arethesis/components/data-table'; // just <a-data-table>
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

## `<a-command-palette>`

A keyboard-first launcher: Ctrl/Cmd+K opens it anywhere on the page.

```html
<a-command-palette placeholder="Search or run a command…"></a-command-palette>
```

```ts
import { storeSource } from 'arethesis/components';
palette.addSource({
  id: 'actions', label: 'Actions',
  commands: () => [{ id: 'dark', title: 'Use the dark theme', keywords: ['night'], shortcut: 'Ctrl+Shift+L', run: () => setTheme('dark') }],
});
palette.addSource(storeSource({ type: 'Person', label: 'People', title: p => p.name, run: (p, id) => show(id) }));
palette.addSource({ id: 'docs', label: 'Docs', search: async q => fetchDocs(q) }); // your own (async) search
```

- A modal `<dialog>`: focus stays in it, the page behind is inert, and focus goes back where it was.
- The input is a combobox over a grouped listbox: ↑/↓ and Page Up/Down move, Enter runs, Escape clears the query and then closes.
- Fuzzy matching (`fuzzyMatch`, `fuzzyFilter`, exported from `arethesis`) ignores case and accents, prefers word starts and runs, and highlights what matched; keywords and subtitles count for less than titles.
- With no query it lists recent commands (in localStorage when it's available) and then each source's commands.
- Attributes: `hotkey` (default `k`, `""` turns the shortcut off) and `placeholder`. Events: `palette:open`, `palette:close`, `palette:run`.

## `<a-sheet>`

A spreadsheet: formulas, range selection, clipboard, fill and undo.

```ts
sheet.configure({ rows: 200, cols: 12, cells: { A1: 'Polis', B1: 'Tribute', B9: '=SUM(B2:B8)' }, label: 'Ledger' });
sheet.on('sheet:change', ({ changes }) => save(changes));       // your edits, raw content by address
sheet.setCells({ B2: '6' }, { remote: true, by: 'Pericles' });   // someone else's (briefly highlighted)
sheet.getValue('B9');                                            // computed: number, text, boolean or FormulaError
```

- **Formulas** start with `=`: arithmetic, `&`, comparisons, references (`A1`, `$A$1`), ranges (`A1:B9`), and SUM, AVERAGE, MIN, MAX, COUNT, IF, ROUND, ABS, CONCAT. A dependency graph recalculates only what changed, in order; cycles show `#CYCLE!` instead of hanging. Other errors are `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?` and `#ERROR!`, each with an explanation on hover.
- **Keys:** editing works like `<a-data-table>` (a click edits, typing replaces, Enter saves and moves down). Shift+arrows (or dragging) select a range, Delete clears it, Ctrl/Cmd+D and R fill down and right with shifted references, Ctrl/Cmd+C, X and V copy, cut and paste as tab-separated text (compatible with other spreadsheet apps), and Ctrl/Cmd+Z and Y undo and redo your own edits.
- **Accessibility:** one focusable `role="grid"` with `aria-activedescendant`, row and column headers, `aria-selected` ranges and announcements; only visible rows are rendered.
- Options: `readOnly(addr)`, `formatNumber(value, addr)`, `widths`. The engine is exported as `SheetModel`, with `parseFormula`, `evaluateFormula` and `shiftFormula`.

## `<a-chart>`

Line, area, bar and stacked-bar charts in SVG, with no dependencies.

```ts
chart.configure({
  type: 'line',                       // 'line' | 'area' | 'bar' | 'stacked-bar'
  label: 'Requests per second',       // accessible name and table caption
  series: [{ key: 'web', label: 'Web' }, { key: 'api', label: 'API' }],
  x: { type: 'time' },                // 'time' | 'number' | 'category'
  y: { format: v => `${v}/s` },
  data: [{ x: Date.now(), web: 120, api: 80 }],
  maxPoints: 60,
});
chart.push({ x: Date.now(), web: 131, api: 77 }); // stream: the oldest point drops off
```

- **Colors:** series take `--ar-chart-1` … `--ar-chart-6` in order. Both palettes' chart colors are checked for color-vision deficiency on adjacent pairs, in light and dark. A hidden series never changes the others' colors.
- **Reading it:** hovering shows a crosshair and one tooltip with every series at that point. The plot is focusable: ← and → step through the points, Home and End jump, and each point is announced. Every chart keeps a data table for screen readers, and the "Table" button shows it.
- **Legend:** with two or more series, legend buttons show and hide series.
- **Marks:** 2px lines with an end dot, area washes, bars at most 24px wide with rounded data ends and 2px gaps, hairline gridlines and "nice" ticks.
- `sparkline: true` draws only the line (a `role="img"` with the label), for stat tiles.

API: `configure`, `setData`, `push`, `setSeriesVisible`, `redraw`, `data`. `niceTicks(min, max, count)` is exported too.

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

It renders an ARIA grid with sticky headers, sorting from the header (with `aria-sort`), resizable columns, infinite scroll, arrow-key navigation and inline editing. Edits are validated, saved optimistically, and rolled back (with a visual cue) if the server refuses them. Set the height with `--ar-table-height`.

Editing works like a spreadsheet, and the editor floats over the cell, so nothing shifts:

| | |
| --- | --- |
| Click an editable cell | Edit it, with the caret where you clicked |
| Arrows, Tab, Home/End (not editing) | Move between cells only |
| Enter or F2 | Edit, with the caret at the end |
| Type a character | Edit, replacing the value; the arrow keys then save and move (F2 switches them back to moving the caret) |
| Enter | Save and stay (`enterMoves: 'down'` to move down; Shift+Enter moves up) |
| Tab / Shift+Tab | Save and move right / left |
| Escape | Revert |
| Choice columns (`editable: { type: 'select', choices }`) | A list opens; arrows move through it without saving; typing jumps to a match; Enter or a click saves |

Invalid values keep the editor open with the message underneath, and starting, saving and errors are announced to screen readers. The editor itself is `openCellEditor()` (exported), for building other grids.

For long lists, `virtualize: true` renders only the rows on screen. Rows keep their `aria-rowindex`, so screen readers still say "row 812 of 10,001". The row being edited stays rendered even if it scrolls away. Rows must be one height; pass `virtualize: { rowHeight }` if it isn't measured right.

## `<a-dialog>`

A native `<dialog>` with a heading and a close button, whose `open()` returns a promise of the result.

```html
<a-dialog id="rename" heading="Rename card">
  <form method="dialog">
    <label>Title <input name="title" autofocus></label>
    <button value="cancel" formnovalidate>Cancel</button>
    <button value="save">Save</button>
  </form>
</a-dialog>
```

```ts
const result = await document.querySelector('#rename').open(); // 'save', 'cancel', or '' if dismissed
```

- **Modal by default:** focus moves into the dialog (to `[autofocus]`, or its first control), the page behind is inert, and focus returns to where it was on close. `modal="false"` opens it without a backdrop.
- **What closes it:** its buttons; a `<form method="dialog">` (which closes with the pressed button's `value`); and, depending on `closedby`, the backdrop and Escape (`any`, the default), Escape only (`closerequest`), or neither (`none`, which also hides the close button). A drag that starts inside and ends on the backdrop doesn't close it.
- **In code:** `open()`, `close(value)`, `isOpen` and `returnValue`. Events: `dialog:open`, and `dialog:close` (`{ returnValue }`).

For a yes-or-no question, `confirm()` builds one for you:

```ts
import { confirm } from 'arethesis/components/dialog';

if (await confirm({ title: 'Delete this card?', body: 'It can’t be undone.', confirmLabel: 'Delete', danger: true })) remove();
```

It's an `alertdialog`, and with `danger` the Cancel button has focus, so a stray Enter is safe. `<a-kanban>`'s `beforeDelete` takes it directly.

## `<a-tabs>`

Tabs over plain markup. Before scripts run (or without them), it's headings and sections. With them, the headings become a tab list.

```html
<a-tabs aria-label="Account" data-hash>
  <h3 data-tab>Profile</h3>
  <section id="profile">…</section>
  <h3 data-tab>Billing</h3>
  <section id="billing"><template data-lazy><invoice-list data-list="listInvoices"></invoice-list></template></section>
</a-tabs>
```

You can also write the `role="tablist"` and `role="tab"` buttons yourself. Panels are matched by `aria-controls`, or by order.

- **Keys:** arrows move between tabs (Up and Down with `orientation="vertical"`; reversed in right-to-left text), and Home and End go to the ends. Disabled tabs are skipped. By default the focused tab opens. With `activation="manual"`, Enter or Space opens it.
- **Find in page:** hidden panels use `hidden="until-found"`, so the browser's find still searches them and opens their tab.
- **`data-hash`:** the open tab's panel id is kept in the URL, and links to `#billing` open that tab.
- **Lazy panels:** a `<template data-lazy>` in a panel is rendered the first time the panel is shown, so components in it don't fetch early.
- **Choosing the first tab:** `selected="2"`, or `aria-selected="true"` on a tab.

`tabs.select(index)` opens a tab, and `tabs.selectedIndex` says which is open. Event: `tabs:change` (`{ index, tab, panel }`).

## `<a-toast>`

Short notifications in a corner of the screen.

```ts
import { toast, connectToasts } from 'arethesis/components/toast';

toast('Saved', 'success');
toast('Card deleted', { action: { label: 'Undo', run: restore } });
connectToasts(app); // a toast whenever an optimistic change is rolled back
connectToasts(app, { rollback: false, httpError: e => `Request failed (${e.status ?? e.kind})` });
```

`toast()` uses the page's `<a-toast>`, and adds one if there's none. Place your own to choose its corner: `<a-toast position="top-end">` (or `bottom-end`, the default, `top-start` and `bottom-start`).

- **Screen readers:** info and success messages go in a `role="status"` region and are read politely. Errors go in a `role="alert"` region and are read at once. Both regions are in the page from the start, so the first message isn't missed.
- **Time to read:** a toast stays while it's hovered or has focus. One with an action stays until it's used or dismissed (WCAG 2.2.1). Otherwise it goes after `timeout` (5 s, 8 s for errors).
- **Above everything:** the region opens in the top layer. While a modal dialog is open, the message is also announced, because the page behind the dialog is inert.

`connectToasts(app, options)` returns a function that disconnects. `httpError` is off unless you give it a message function, since most failed requests also roll back a change. `app.http.onError(listener)` reports failed requests if you'd rather handle them yourself.

## `<a-combobox>`

A text field with a list of suggestions, for when a `<select>` has too many options or they come from a search. It's a form control: it submits its value under its `name` in a native `<form>` or `<a-form>`, and `required`, reset and `<label for>` work.

```html
<label for="polis">Home polis</label>
<a-combobox id="polis" name="polis" placeholder="Type to search" required>
  <option value="athens">Athens</option>
  <option value="sparta">Sparta</option>
</a-combobox>
```

The options in the markup work before scripts run. To search instead, configure a source:

```ts
combobox.configure({ source: { endpoint: 'searchPeople', param: 'q' }, valueField: 'id', labelField: 'name' });
combobox.configure({ source: async (query, signal) => (await fetch(`/cities?q=${query}`, { signal })).json() });
```

Typing filters local options with fuzzy matching and highlights the letters that matched. Searches are debounced (`debounce`, default 200 ms) and need `minChars` (default 1). A slower, older search never replaces a newer one's results, and the number of results is announced to screen readers.

| Key | |
| --- | --- |
| Down / Up | Open the list and move through it (disabled options are skipped) |
| Alt+Down | Open without moving |
| Enter or a click | Pick |
| Escape | Close; again to clear |

Leaving the field without picking restores the current choice's label, or picks an option whose label you typed exactly. With `allowCustom: true`, the typed text becomes the value. Event: `combobox:select` (`{ value, label, data }`), plus `input` and `change`.

## `<a-kanban>`

A board of cards in columns. The cards are objects of one type in the store, grouped by a field and sorted by another, so changes from anywhere (an SSE update, another tab, an edit elsewhere on the page) show up on the board.

```ts
const board = document.querySelector('a-kanban');
board.configure({
  type: 'Task',
  list: { type: 'Task', endpoint: 'listTasks' },   // loads the cards
  groupBy: 'status',
  orderField: 'order',
  columns: [
    { value: 'todo', label: 'To do' },
    { value: 'doing', label: 'In progress', limit: 5 },
    { value: 'done', label: 'Done' },
  ],
  card: { html: '<p class="ar-kanban__title" data-bind="title"></p>', fields: { title: {} }, label: t => t.title },
  save: { endpoint: 'updateTask' },        // PATCH /tasks/:id with { status, order }
  create: { endpoint: 'createTask' },      // adds "+ Add a card" to each column
  remove: { endpoint: 'deleteTask' },      // adds Delete to the menu and the Delete key
});
```

- **Moving cards:** drag with a mouse or finger, or use the keyboard (Space picks up, arrows move, Space drops). Each card also has a menu (right-click, Shift+F10) with "Move to…" for every column. Moves are optimistic: the card moves at once, and goes back with `kanban:move-error` if the server refuses. A card is placed between its new neighbours by giving it an `order` halfway between theirs.
- **Limits:** a column's `limit` shows its count as "3 / 5", and the column gets `data-over-limit` when it's exceeded.
- **Events:** `kanban:move` (cancelable, before a move), `kanban:moved`, `kanban:move-error`, `kanban:create`, `kanban:delete`, `kanban:error`, and `kanban:action` for your own `menu` items.
- **In code:** `board.move(id, column, index)`, `board.createCard(column, fields)`, `board.deleteCard(id)`, `board.orderAt(column, index)`.

`save`, `create` and `remove` also take a function, such as `(id, changes) => api.patch(…)`.

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

Add `virtualize` (or `virtualize="css"`) for long lists: off-screen items stay in the DOM but aren't rendered. `virtualize="window"` keeps only the items on screen, with `data-item-size` (in px) and `data-scroller` (a selector, `self` or `viewport`). Items get `aria-posinset` and `aria-setsize` either way.

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
