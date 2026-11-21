# Text, settings and keyboard

Tools for text-heavy apps (readers, editors, documentation, chat), all in `arethesis/core` and the root `arethesis` entry. None of them registers anything until you call it, so unused ones are left out of your bundle.

| Tool | For |
| --- | --- |
| [`html`](#html-escaping-templates) | Building markup from strings, with every value escaped |
| [`definePrefs`](#saved-settings-defineprefs) | Settings that are typed, versioned, saved, and shared between tabs |
| [`highlighter`](#highlights-without-wrapping) | Highlighting ranges of text without changing the page |
| [`shortcuts`](#keyboard-shortcuts) | Keyboard shortcuts, with help, palette entries and Escape that closes the right thing |
| [`intent`](mixins.md#intent) and [`selection-menu`](mixins.md#selection-menu) | Hover, tap and focus as show, commit and cancel; a toolbar next to selected text |

## `html`: escaping templates

```ts
import { html, setHtml } from 'arethesis';

setHtml(list, html`
  <h3>${title}</h3>
  <ul>${items.map(item => html`<li data-id="${item.id}"><a href="${item.url}">${item.name}</a></li>`)}</ul>
`);
```

- Every value is escaped. Nested `html` results, and arrays of them, stay markup. `null`, `undefined` and `false` render as nothing, so `${done && html`<b>Done</b>`}` works.
- Where escaping can't make a value safe, `html` throws instead of guessing: an unquoted attribute (`title=${x}`), a value between attributes (`<p ${x}>`), an event handler (`onclick="${x}"`), and the inside of `<script>` or `<style>`.
- A value that starts a URL attribute (`href`, `src`, `srcset`, `action`, `formaction` and a few more) must be a safe URL. `javascript:` and its disguises become `about:invalid`.
- `unsafeHtml(trusted)` inserts a string you trust as markup. For HTML from users, use [`sanitizeHtml`](security.md) instead.
- The result is a `SafeHtml`. `setHtml(element, markup)` accepts only that, and `String(markup)` gives you the string.

## Saved settings: `definePrefs`

```ts
import { definePrefs } from 'arethesis';

export const prefs = definePrefs({
  key: 'reader',
  version: 2,
  defaults: { fontSize: 18, theme: 'system', hints: true, recent: [] as string[] },
  validate: { fontSize: size => size >= 12 && size <= 32 },
  migrate: (old, from) => (from < 2 ? { ...old, fontSize: old.size } : old),
});

prefs.get('fontSize');                 // 18, typed as number
prefs.set('fontSize', 20);
prefs.update({ hints: false, theme: 'dark' });
prefs.reset('hints');
const stop = prefs.on('fontSize', (size, previous) => applySize(size));
prefs.on('*', all => render(all));
```

- **Stored:** everything goes in one JSON entry, `{ v, data }`. Only values that differ from their default are written, so a changed default reaches everyone who never changed that setting.
- **Read safely:** a stored value of the wrong type (checked against its default), or one that `validate` rejects, reads as the default. Unknown keys are dropped. `set` throws on unknown keys and invalid values.
- **Versions:** when the stored version is older, `migrate` runs once and its result is saved.
- **Other tabs:** a change in another tab updates this one and fires the listeners.
- **Storage that throws** (private windows, blocked cookies, a full quota) falls back to memory, and `prefs.persistent` is false.
- Pass `storage: 'session'`, or any `Storage` object, to keep the settings somewhere else.

`safeStorage()` and `watchStorage()` are the pieces underneath, for values that don't need the rest.

The theme helpers keep their own keys, because the boot script reads them before the first paint. Call `syncThemeAcrossTabs()` (from `arethesis/components/theme`) and a theme picked in one tab applies in the others.

## Highlights without wrapping

```ts
import { highlighter, wordRanges, findRanges } from 'arethesis';

const words = wordRanges(passage);            // the words, as Ranges
const reading = highlighter('reading');
reading.set([words[12]]);                      // highlight the 13th word

const search = highlighter('ar-search');
search.set(findRanges(article, 'logos'));
```

```css
::highlight(reading),
.ar-highlight[data-highlight="reading"] { background-color: var(--ar-accent); color: var(--ar-bg); }
```

`highlighter` uses the [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API), so the page itself doesn't change. Copying, selecting, find-in-page, reading aloud and screen readers see exactly the text that was there. Where the API is missing, the text is wrapped in `<mark class="ar-highlight" data-highlight="name">` and unwrapped again on every change, and the highlighted Ranges are kept up to date. Style both selectors. `fallback: 'none'` shows nothing instead.

- **Methods:** `set`, `add`, `delete`, `has`, `clear` and `destroy`.
- **Options:** `priority` decides which highlight is on top where two overlap. `type` can be `spelling-error` or `grammar-error`.
- **Built-in styles:** `theme.css` styles `ar-search` (every match) and `ar-search-current` (the one you're on), including in forced-colors mode.

Ranges to highlight come from these helpers. Offsets count the characters of an element's text in document order, so they are stable to save and restore:

| Helper | Returns |
| --- | --- |
| `textRange(root, start, end)` | A Range over characters `start` to `end` |
| `textOffset(root, node, offset)` | The character offset of a DOM position |
| `textOf(root)` | The text these offsets count (no `<script>` or `<style>`) |
| `wordRanges(root, { locale })` | Every word, using `Intl.Segmenter`. Punctuation and spaces are left out, and a word may span inline elements (`<b>Hel</b>lo` is one word) |
| `findRanges(root, query, { caseSensitive, wholeWord, limit })` | Every match of a plain-text query |
| `rangeAtPoint(ranges, x, y)` | The range under a point. Highlights don't receive clicks, so this is how a tap finds its word. For hover, tap and keyboard all at once, give the ranges to [`intent`](mixins.md#words-as-targets-without-spans) |
| `caretAt(x, y)` | The DOM position under a point |

## Keyboard shortcuts

```ts
import { shortcuts, renderShortcutHelp, shortcutSource } from 'arethesis';

shortcuts({
  '/': { run: () => search.focus(), label: 'Search', group: 'Find' },
  n: { run: next, label: 'Next match', group: 'Find', when: () => matches.length > 0 },
  'Mod+s': { run: save, label: 'Save' },
  '?': { run: showHelp, label: 'Keyboard shortcuts' },
  Escape: closeReader,
});
```

- **Keys.** A printable key matches the character typed, so `'?'` works on every keyboard layout (it isn't `Shift+/`). Letters take Shift explicitly (`'Shift+N'`). Named keys use their `KeyboardEvent.key` names (`Escape`, `ArrowUp`, `F1`), plus `Space` and `Esc`.
- **Modifiers** must match exactly. They are `Ctrl`, `Alt`, `Shift`, `Meta`, and `Mod`, which is ⌘ on Apple devices and Ctrl elsewhere.
- **Typing is safe.** Shortcuts without Ctrl, Alt or Mod don't fire while focus is in a text field, a select, an editable element or a form-associated control. `allowInInput: true` overrides this.
- **Options per binding:**
  - `when` switches a binding off conditionally.
  - `repeat: true` fires on key repeat.
  - A `run` that returns `false` leaves the key's default action alone.
  - Key presses during IME composition, or already handled (`defaultPrevented`), are ignored.
- **Lifetime.** `shortcuts()` returns a function that removes them. `scope: element` limits them to key presses inside it. In a component, pass its signal so they last while it's connected: `shortcuts(map, { signal: this.signal })` in `onConnected`. Newer registrations win over older ones.

### Help and the command palette

Every labelled, currently enabled shortcut is listed:

- `shortcutList()` gives them grouped.
- `renderShortcutHelp(element)` fills an element with a heading and a `<dl>` per group, with `<kbd>` keys.
- `palette.addSource(shortcutSource())` adds them to `<a-command-palette>` with their keys as hints.
- `formatShortcut('Mod+Shift+k')` gives "⌘⇧K" on a Mac and "Ctrl+Shift+K" elsewhere.

### Escape, in layers

Escape should close the topmost thing, and only that. Arethesis keeps a stack of what's open:

- **Popups and dialogs** (menus, lists, the selection menu, `<a-dialog>`, the command palette) add themselves while open and close themselves on Escape. While one is on top, Escape is left to it.
- **Your own panels** (a settings sheet, a drawer) register with `pushLayer(element, close)`, which returns a function to call when the panel closes by other means. Escape closes the top one.
- **The `Escape` shortcut** runs only when nothing is open.

```ts
import { pushLayer } from 'arethesis';

function openSheet() {
  sheet.hidden = false;
  const release = pushLayer(sheet, closeSheet);
  sheet.addEventListener('close', release, { once: true });
}
```

Tooltips aren't layers: Escape hides them and still reaches whatever is below.
