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
| `editable` | Click-to-edit (double-click, Enter, F2); validation; rollback on failed save. Select editors save on Enter or a pick from the popup, never on arrow keys | `editable:start/save/cancel/error` |
| `grid-navigation` | Spreadsheet keyboard navigation with a roving tabindex; Tab leaves the grid unless `tabBehavior: 'cells'`. Typing requests an edit; call `preventDefault()` on `grid:edit` if your editor takes the typed character | `grid:navigate`, `grid:edit` |
| `infinite-scroll` | Loads more near the end; pass `loadMore` or a ListView id via `view` | `infinite-scroll:load/loaded/error` |
| `sortable` | Reorder by pointer, touch or keyboard (Space to pick up, arrows, Space to drop), across containers sharing a `group`, with screen-reader announcements. Works in lists, grids and wrapping rows; neighbours slide aside, the item glides into place, and containers auto-scroll. | `sortable:start`, `sortable:move`, `sortable:end` (cancelable: reverts the move) |
| `resizable` | Edge and corner handles (`role="separator"`), keyboard resizing, min/max; works on flex items | `resizable:start/resize/end` |
| `dropdown` | Turns a `<select>` into an accessible, filterable combobox; the select keeps working for forms and bindings | `dropdown:change` |
| `tooltip` | On hover (after a delay), focus and tap; Escape or a tap elsewhere dismisses; linked with `aria-describedby`; flips to stay on screen | none |
| `intent` | Hover, tap and focus as show, commit and cancel, for anything that previews on hover and sticks on tap | `intent:show`, `intent:commit`, `intent:cancel` |
| `selection-menu` | A toolbar next to selected text, which keeps the selection while you use it | `selection-menu:open/select/close` |
| `listbox` | A select-only combobox (APG pattern) in place of `<select>`: arrows move through the options without picking, typing jumps to a match, Enter, Tab or a click picks, Escape closes | `listbox:change`, `listbox:commit`, `listbox:cancel` |
| `context-menu` | Right-click, Shift+F10 or the Menu key; arrow keys, Home/End and typeahead | `context-menu:select` |

## Popups

Tooltips, context menus and the `dropdown` and `listbox` lists open as [popovers](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API) where the browser supports them. They render in the top layer, so a scrolling table, a card with `overflow: hidden` or a sticky header can't clip or cover them, and they follow their anchor as the page scrolls. Inside an open modal `<dialog>` they're placed in the dialog, because the rest of the page is inert. Elsewhere they fall back to fixed positioning. Either way, `hidden` reflects whether a popup is open.

Your own floating UI can use the same helper:

```ts
import { attachPopup } from 'arethesis/mixins';

const popup = attachPopup(panel, { anchor: () => button, placement: 'bottom', matchWidth: true });
button.addEventListener('click', () => (popup.isOpen() ? popup.hide() : popup.show()));
```

## `intent`

Tooltips, glosses, link previews and footnotes all need the same judgment about what a pointer, a finger or the keyboard means. `intent` makes it once and reports three events:

```ts
import { intentMixin } from 'arethesis/mixins';

intentMixin(article, { selector: 'dfn' });
article.addEventListener('intent:show', e => preview(e.detail.target));   // hover or focus
article.addEventListener('intent:commit', e => pin(e.detail.target));     // tap, click or Enter
article.addEventListener('intent:cancel', e => unpin(e.detail.target));   // leave, blur, Escape, tap elsewhere
```

| Input | Show | Commit | Cancel |
| --- | --- | --- | --- |
| Mouse, pen | Resting on a target for `delay` (280 ms); once one is shown, the next shows at once | A click (unless `click: false`) | Leaving (after a short `grace`), or a click outside |
| Touch | (none) | A tap; tapping another target moves the commit | Tapping the same target again, or tapping outside |
| Keyboard | Focus | Enter (except on buttons, links and fields) | Blur, Escape |

- **What counts as a tap:** the finger moves less than `tolerance` px, lifts within `longPress` ms, and doesn't scroll the page or select text. Swipes, scrolls, long presses and text selections are ignored. A finger lifting off isn't "leaving".
- **One target at a time.** `active()` reports it and whether it's committed. `commit(target)` and `cancel()` change it from code.
- **Detail:** events carry `{ target, via }`, where `via` is `hover`, `focus`, `click`, `tap` or `key`. For cancel, it's `{ target, reason }` instead.
- **Callbacks:** use `onShow`, `onCommit` and `onCancel`, with `events: false`, when the events would only be noise.

- **Clicks that aren't commits:** a click that ends a text selection, and the second click of a double click, are ignored.

### Words as targets, without spans

Pass `ranges` instead of `selector` and the targets are text Ranges, so a reader can respond to words without wrapping each one in an element:

```ts
import { intentMixin, highlighter, wordRanges } from 'arethesis';

const words = wordRanges(passage);
const pointed = highlighter('pointed');
intentMixin(passage, {
  ranges: words,                          // or () => words, if the list changes
  onShow: word => pointed.set([word]),
  onCancel: () => pointed.clear(),
  onCommit: (word, via) => readFrom(words.indexOf(word)),
});
```

- **Finding the word:** the pointer's caret position is found by binary search in the list, then checked against the word's boxes, so the gaps between words aren't targets and a long book stays fast. The list must be in reading order (as `wordRanges` and `findRanges` give it). A function is called on every pointer move, so return a list you keep.
- **The same word:** ranges with the same boundaries count as the same target, so recomputing the list doesn't break a hover or a commit.
- **Keyboard:** the host becomes focusable (unless it already is, or `keyboard: false`). While it has focus, the arrow keys, Home and End move from range to range (reversed in right-to-left text), showing each; Enter commits; once committed, the arrows move the commit. Screen readers read the text itself, so give them what the hover adds another way too.
- **Showing it:** a Range can't be styled, so highlight it with `highlighter`, and anchor a popup to `() => range.getBoundingClientRect()`.
- Events and callbacks get the Range as `target`, and in TypeScript the callbacks are typed for it.

`tooltip` is built on it.

## `selection-menu`

A small toolbar beside selected text: Highlight, Note, Copy, Define.

```ts
import { selectionMenuMixin } from 'arethesis/mixins';

selectionMenuMixin(article, {
  items: (range, text) => [
    { label: 'Highlight', action: 'highlight', icon: '✎' },
    { label: 'Define', action: 'define', disabled: text.includes(' ') },
  ],
});
article.addEventListener('selection-menu:select', e => {
  const { action, range, text } = e.detail;
});
```

- **When it appears:** for a selection inside the element, but not in a form field, and at least `minLength` characters long. It sits at the end the selection grows from, and follows the selection as it changes. With a coarse pointer it goes below the selection, out of the way of the system's own menu.
- **Keeping the selection:** pressing its buttons doesn't clear the selection, and the selection is put back before `selection-menu:select` fires. After an action, or after Escape, the same selection doesn't reopen it.
- **Keyboard:** while text is selected, Shift+F10 or the Menu key moves into it, ahead of a `context-menu` on the same element. It's a `toolbar`, so the arrow keys, Home and End move between its buttons. Escape or Tab goes back to the text with the selection intact. Screen readers are told it's available.
- **Your own content:** `render(menu, range, text)` fills the toolbar yourself; buttons with `data-action` are its items.

## How `sortable` drags

The model follows [dnd kit](https://dndkit.com/):

- **Starting a drag:** the pointer must move a few pixels first (`activationDistance`, default 5), so clicks still work. On touch screens, a press-and-hold starts the drag (`touchDelay`, default 200 ms), so swiping still scrolls.
- **The item stays where it is in the DOM.** It's lifted above the page, but components inside it keep their state, and it isn't clipped by scroll containers.
- **The drop position** is the closest item in two dimensions, so grids and wrapping rows behave. The closest container in a `group` wins, even when the pointer is in the gap between containers.
- **Animation:** neighbours slide out of the way, and the item glides into place on drop (`animation`, default 180 ms; off when the user prefers reduced motion).
- **Auto-scroll:** scroll containers and the page scroll when you drag near their edges (`autoScroll`).

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
