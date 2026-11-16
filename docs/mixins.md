# Mixins

Mixins add behavior to existing elements. Apply them in code or declaratively:

```ts
import { applyMixin, removeMixin } from 'arethesis';
const instance = applyMixin(element, 'tooltip', { content: 'Saves your work', placement: 'bottom' });
removeMixin(element, 'tooltip');
```

```html
<button data-mixin="tooltip" data-tooltip="Saves your work">Save</button>
<table data-mixin="grid-navigation" data-mixin-grid-navigation-tab-behavior="cells">…</table>
<div data-mixin="sortable" data-mixin-sortable='{"group":"board"}'>…</div>
```

`app.init()` applies `data-mixin` declarations and keeps watching the DOM: mixins are applied to elements added later and destroyed when elements are removed. Options are read from `data-mixin-<name>-<option>` (kebab-case, so `tab-behavior` becomes `tabBehavior`) or a JSON `data-mixin-<name>` attribute. Every mixin also reports what happens through bubbling CustomEvents, so declarative use doesn't need callbacks.

| Mixin | What it does | Events |
| --- | --- | --- |
| `draggable` | Pointer and touch dragging; axis, grid snapping, containment; arrow keys move it | `draggable:start/move/end` |
| `editable` | Click-to-edit (double-click, Enter, F2); validation; rollback on failed save | `editable:start/save/cancel/error` |
| `grid-navigation` | Spreadsheet keyboard navigation with a roving tabindex; Tab leaves the grid unless `tabBehavior: 'cells'` | `grid:navigate`, `grid:edit` |
| `infinite-scroll` | Loads more near the end; pass `loadMore` or a ListView id via `view` | `infinite-scroll:load/loaded/error` |
| `sortable` | Reorder by pointer or keyboard (Space to pick up, arrows, Space to drop), across containers sharing a `group`, with screen-reader announcements | `sortable:start`, `sortable:end` (cancelable: reverts the move) |
| `resizable` | Edge and corner handles (`role="separator"`), keyboard resizing, min/max; works on flex items | `resizable:start/resize/end` |
| `dropdown` | Turns a `<select>` into an accessible, filterable combobox; the select keeps working for forms and bindings | `dropdown:change` |
| `tooltip` | On hover and focus, Escape dismisses, linked with `aria-describedby`, flips to stay on screen | none |
| `context-menu` | Right-click, Shift+F10 or the Menu key; arrow keys, Home/End and typeahead | `context-menu:select` |

## Writing a mixin

```ts
import { registerMixin } from 'arethesis';

registerMixin('autosize', (element: HTMLTextAreaElement, { max = 400 }) => {
  const resize = () => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, max)}px`;
  };
  element.addEventListener('input', resize);
  resize();
  return { name: 'autosize', element, options: { max }, destroy: () => element.removeEventListener('input', resize) };
});
```

Register a mixin with `{ fn, dependencies, conflicts }` to declare mixins it needs or can't be combined with.
