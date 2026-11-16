# Component kit

```ts
import 'arethesis/components';
import 'arethesis/components/theme.css';
```

The theme styles the kit and everything the framework generates (tooltips, menus, dropdowns, the editor, validation messages, skeletons). It's built on CSS custom properties: override `--ar-accent`, `--ar-radius`, `--ar-font` and friends on `:root` or any container. Light and dark modes follow the OS unless `<html data-theme="light|dark">` is set.

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
