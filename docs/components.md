# Components

Components extend `Component` and are registered with `defineComponent`. They render into the Light DOM, so global CSS, `querySelector` and dev tools work as usual.

```ts
@defineComponent({ tag: 'task-item', template: '/templates/task-item.html' })
export class TaskItem extends Component {
  static bindConfig = { fields: { title: {}, due: { displayType: 'date' }, done: { displayType: 'boolean' } } };

  protected onConnected() {
    this.delegate('click', '[data-action=toggle]', () => this.toggle());
  }

  protected onBind(obj) {
    this.classList.toggle('is-done', obj.data.done);
  }
}
```

## Templates

A template source (an inline `html` string or a file) holds `<template id>` elements:

| id | Used for |
| --- | --- |
| `main` | The component's content (required, or the whole file if it has no `<template>`s). Use another id with `defineComponent({ …, templateId: 'login' })`, for example to share one template file between components. |
| `loading` | While a missing object is fetched, or during `fetchData()` |
| `error` | When loading fails. Put the message in `[data-error-message]` and add a `[data-retry]` button |
| `item` | Each collection item (override with `bindConfig.itemTemplate`) |
| any | `emptyTemplate`, `loadingTemplate`, `errorTemplate` for lists |

## Binding to one object

```ts
card.bind({ type: 'Person', id: 42 });
card.bind({ type: 'Person', id: 42 }, { fields: { name: {} } }); // explicit config
card.unbind();
```

If the object isn't in the store and its type has an `endpoint`, it's fetched. When it's invalidated (for example by SSE), it's refetched and the content stays visible with `data-updating` set meanwhile.

## Binding to a list

```ts
const view = list.bindList({ type: 'Task', endpoint: 'listTasks', pageSize: 20 }, {
  fields: { title: {}, assignee: {} },
  itemTemplate: 'item',
  emptyTemplate: 'empty',
  loadingTemplate: 'loading',
  infiniteScroll: { threshold: 300 },
});
```

Items render into `[data-items]` (or the component itself), keyed by id. Existing elements are reused and moved, never re-created, so focus and scroll position survive updates. Each item element gets `data-id`. When an object changes, only its element is patched.

### Long lists

Set `virtualize` to keep long lists light:

- **`'window'` (or `true`):** only the items on screen are in the DOM, plus `overscan` (default 8) on each side, with spacers standing in for the rest. Items scroll in and out as you scroll. The item that has focus stays rendered, and so does any item you pin with `this.pinItem(id)` (it returns a function that unpins). Items must be one height. It's measured from the first item, or set with `itemSize`. Tell it what scrolls with `scroller`: a selector inside the component, `'self'`, or `'viewport'` (the default).
- **`'css'`:** every item stays in the DOM, but the browser skips rendering the ones off screen (`content-visibility: auto`). Find-in-page and screen readers' browse mode still see every item, so prefer it unless the list is very long. It has no effect on table rows.

```ts
list.bindList({ type: 'Task', endpoint: 'listTasks' }, { fields: { title: {} }, virtualize: { mode: 'window', itemSize: 48 } });
```

Override `onItemPosition(el, index, view)` to annotate items with their position, for example `aria-rowindex`; it's called for every rendered item. `revealItem(index)` scrolls a virtualized list to an item and returns its element, and `onItemRemove(el)` runs before an item's element is removed.

### Rebinding and moving

- **One binding at a time:** a component has one binding. Calling `bind()` or `bindList()` again replaces it. The previous list's rows, placeholder and infinite-scroll sentinel are removed, and the new list renders in their place.
- **`unbind()`:** stops listening and removes the list's rows. An object binding's content is left as it is.
- **Moving a component:** a component moved in the DOM (disconnected, then connected again) keeps its binding, and its rows stay live. It's only unbound if you call `unbind()`.

## Islands

```html
<person-card data-source="Person:42"></person-card>
<task-list data-list="listTasks" data-filters='{"done":false}' data-page-size="20"></task-list>
<person-card data-source="Person:42" data-hydrate>
  <h2 data-bind="name">Alice Hopper</h2> <!-- server-rendered, kept, and kept up to date -->
</person-card>
```

## Events

```ts
const off = card.on('data-change', ({ field, value }) => {});
this.emit('task-toggled', { id }); // bubbling, cancelable CustomEvent
```

Choose event names the DOM doesn't use (`row-select`, not `select`), because native events bubble through components too.

## Helpers

| Method | Purpose |
| --- | --- |
| `this.listen(target, type, handler)` | `addEventListener` that's removed on disconnect |
| `this.delegate(type, selector, (event, el, itemId) => …)` | Delegated events within the component |
| `this.useMixin(name, options, element?)` | Apply a mixin; destroyed on disconnect |
| `this.fetchData(fn)` | Run with the loading/error templates; the binding is restored afterwards |
| `this.render(templateId)` | Swap in a template (race-safe) |
| `this.refetch()` / `this.retry()` | Reload the bound source |
| `this.ready` | Resolves after the first render |

Lifecycle hooks: `onConnected`, `onDisconnected`, `onBind(obj)`, `onUnbind`, `onItemRender(el, obj)`, `onListChange(view)`, `onRetry`. Override `formatErrorMessage(error)` to customize error text.

Component internals use true `#private` fields, so your subclass can use any property names (`items`, `bound`, …) without clashing.

## Form controls

A component that is a form control extends `FormAssociatedComponent`. It then works in a native `<form>` like an `<input>`: its value is submitted under its `name`, `required` and `setCustomValidity()` feed `validity`, and a form reset, a disabled `<fieldset>` and back/forward restore all work. `DataBinder` and `<a-form>` treat it as a control.

```ts
import { FormAssociatedComponent, defineComponent } from 'arethesis';

@defineComponent({ tag: 'star-rating', html: '<template id="main"><div role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="5"></div></template>' })
class StarRating extends FormAssociatedComponent<number> {
  protected get focusTarget() { return this.querySelector<HTMLElement>('[role=slider]')!; }
  protected serialize(value: number) { return value ? String(value) : null; }
  protected parse(state: string) { return Number(state); }
  protected emptyValue() { return 0; }
  protected override onValueChange(value: number) { this.focusTarget.setAttribute('aria-valuenow', String(value)); }
  // Call this.commitValue(n) when the user picks n stars.
}
```

Components live in the Light DOM, so the inner control must not have a `name` of its own. A `<label for>` pointing at the component names its `focusTarget`.
