/**
 * Keyboard shortcuts, with a help list and command palette entries for free.
 *
 * ```ts
 * const stop = shortcuts({
 *   t: { run: toggleContents, label: 'Contents', group: 'Reading' },
 *   '/': { run: focusSearch, label: 'Search' },
 *   'Mod+k': { run: () => palette.open(), label: 'Command palette' },
 *   '?': { run: showHelp, label: 'Keyboard shortcuts' },
 *   Escape: closeReader,
 * });
 * ```
 *
 * In a component, pass its signal so they last while it's connected:
 * `shortcuts({...}, { signal: this.signal })` in `onConnected`.
 *
 * - **Keys:** printable keys match the character typed (`'?'`, not
 *   `'Shift+/'`), so they work on any keyboard layout. Named keys use
 *   `KeyboardEvent.key` names (`Escape`, `ArrowUp`, `F1`, `Space`).
 *   Modifiers are `Mod` (⌘ on Apple devices, Ctrl elsewhere), `Ctrl`,
 *   `Alt`, `Shift` and `Meta`, and must match exactly.
 * - **Text fields:** shortcuts without Ctrl, Alt or Mod don't fire while
 *   typing in an input, textarea, select or editable element, unless the
 *   binding sets `allowInInput`.
 * - **Escape, in layers:** while a popup or dialog is open, Escape is left to
 *   it. Otherwise the top layer registered with {@link pushLayer} closes.
 *   Only when nothing is open does an `Escape` shortcut run.
 * - Key repeats, IME composition and events already handled
 *   (`defaultPrevented`) are ignored. The newest registration wins a tie.
 *
 * `shortcutList()` and `renderShortcutHelp()` list every labelled shortcut,
 * and `shortcutSource()` adds them to `<a-command-palette>`.
 *
 * @module utils/shortcuts
 */

import { topLayer, type Layer } from './layers';
import { html, setHtml } from './html';

export interface ShortcutBinding {
  run: (event?: KeyboardEvent) => void | boolean | Promise<void>;
  /** Shown in help and the command palette; unlabelled shortcuts aren't listed. */
  label?: string;
  /** Heading in help and the palette. @default 'General' */
  group?: string;
  /** Only while this returns true. */
  when?: () => boolean;
  /** Fire in text fields too. @default false for keys without Ctrl, Alt or Mod */
  allowInInput?: boolean;
  /** Fire on key repeat (held down). @default false */
  repeat?: boolean;
}

export type ShortcutMap = Record<string, ShortcutBinding | ShortcutBinding['run']>;

export interface ShortcutOptions {
  /** Only for key presses inside this element. @default the whole document */
  scope?: Element;
  /** Remove them when this aborts (a component's `this.signal`). */
  signal?: AbortSignal;
}

interface Parsed {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** One printable character (matched as typed). */
  char: boolean;
}

interface Entry {
  keys: string;
  parsed: Parsed;
  binding: ShortcutBinding;
  scope: Element | null;
}

const registrations: Entry[][] = [];

const ALIASES: Record<string, string> = { esc: 'Escape', space: ' ', spacebar: ' ', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', plus: '+', return: 'Enter' };

/** True on Apple platforms, where `Mod` is ⌘. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function parse(keys: string): Parsed {
  // The last part is the key ("Mod++" is Mod and plus).
  const parts = keys === '+' ? ['+'] : keys.endsWith('++') ? [...keys.slice(0, -2).split('+'), '+'] : keys.split('+');
  const rawKey = parts.pop() ?? '';
  const mods = new Set(parts.map(p => p.trim().toLowerCase()));
  const apple = isApplePlatform();
  let key = ALIASES[rawKey.toLowerCase()] ?? rawKey;
  const char = [...key].length === 1;
  if (char) key = key.toLowerCase();
  for (const mod of mods) {
    if (!['mod', 'ctrl', 'control', 'alt', 'option', 'shift', 'meta', 'cmd', 'command'].includes(mod)) throw new Error(`shortcuts: unknown modifier "${mod}" in "${keys}"`);
  }
  return {
    key,
    char,
    ctrl: mods.has('ctrl') || mods.has('control') || (mods.has('mod') && !apple),
    meta: mods.has('meta') || mods.has('cmd') || mods.has('command') || (mods.has('mod') && apple),
    alt: mods.has('alt') || mods.has('option'),
    shift: mods.has('shift'),
  };
}

function matches(p: Parsed, e: KeyboardEvent): boolean {
  if (e.ctrlKey !== p.ctrl || e.metaKey !== p.meta || e.altKey !== p.alt) return false;
  if (!p.char) return e.key.toLowerCase() === p.key.toLowerCase() && e.shiftKey === p.shift;
  const typed = e.key.length === 1 ? e.key.toLowerCase() : '';
  const letter = /^\p{L}$/u.test(p.key);
  if (letter) {
    // Shift is part of a letter shortcut; Alt on a Mac types another character, so use the key's position too.
    if (e.shiftKey !== p.shift) return false;
    return typed === p.key || (p.alt && e.code === `Key${p.key.toUpperCase()}`);
  }
  // Symbols: the character decides (Shift may be needed to type it).
  return typed === p.key || (p.key === ' ' && e.key === ' ');
}

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest('[contenteditable=""], [contenteditable="true"]')) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset', 'file', 'image'].includes(target.type);
  // Form-associated custom elements (a combobox) take typing too.
  return (target.constructor as { formAssociated?: boolean }).formAssociated === true;
}

// The layer on top when the key went down, before anything closed in response.
const layerAtKeydown = new WeakMap<Event, Layer | null>();
let installed = 0;
const onCapture = (e: Event): void => {
  if ((e as KeyboardEvent).key === 'Escape') layerAtKeydown.set(e, topLayer());
};

function onKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const layer = layerAtKeydown.has(e) ? layerAtKeydown.get(e)! : topLayer();
    if (layer) {
      // Popups and dialogs close themselves; app layers are ours to close.
      if (layer.kind === 'app' && layer.close) {
        e.preventDefault();
        layer.close();
      }
      return;
    }
  }
  const field = inTextField(e.target);
  for (let r = registrations.length - 1; r >= 0; r--) {
    for (const entry of registrations[r]) {
      const { parsed, binding, scope } = entry;
      if (scope && !(e.target instanceof Node && scope.contains(e.target))) continue;
      if (!matches(parsed, e)) continue;
      if (e.repeat && !binding.repeat) continue;
      if (field && !(binding.allowInInput ?? (parsed.ctrl || parsed.alt || parsed.meta))) continue;
      if (binding.when && !binding.when()) continue;
      const result = binding.run(e);
      if (result !== false) e.preventDefault();
      return;
    }
  }
}

/** Register shortcuts; returns a function that removes them. */
export function shortcuts(map: ShortcutMap, options: ShortcutOptions = {}): () => void {
  const entries: Entry[] = Object.entries(map).map(([keys, value]) => ({
    keys,
    parsed: parse(keys),
    binding: typeof value === 'function' ? { run: value } : value,
    scope: options.scope ?? null,
  }));
  if (installed++ === 0) {
    document.addEventListener('keydown', onCapture, true);
    document.addEventListener('keydown', onKeydown);
  }
  registrations.push(entries);
  let removed = false;
  const stop = (): void => {
    if (removed) return;
    removed = true;
    const i = registrations.indexOf(entries);
    if (i >= 0) registrations.splice(i, 1);
    if (--installed === 0) {
      document.removeEventListener('keydown', onCapture, true);
      document.removeEventListener('keydown', onKeydown);
    }
  };
  if (options.signal?.aborted) stop();
  else options.signal?.addEventListener('abort', stop, { once: true });
  return stop;
}

const SYMBOLS_APPLE: Record<string, string> = { meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
const NAMES: Record<string, string> = { Escape: 'Esc', ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Delete: 'Del' };

/** The parts of a shortcut as shown to people: `['⌘', 'K']` on Apple, `['Ctrl', 'K']` elsewhere. */
export function shortcutKeys(keys: string): string[] {
  const p = parse(keys);
  const apple = isApplePlatform();
  const out: string[] = [];
  const mods: Array<[boolean, 'ctrl' | 'alt' | 'shift' | 'meta', string]> = [
    [p.ctrl, 'ctrl', 'Ctrl'],
    [p.alt, 'alt', 'Alt'],
    [p.shift, 'shift', 'Shift'],
    [p.meta, 'meta', apple ? '⌘' : 'Meta'],
  ];
  if (apple) mods.unshift(mods.splice(0, 1)[0]); // ⌃ ⌥ ⇧ ⌘, the Apple order
  for (const [on, name, label] of mods) if (on) out.push(apple ? SYMBOLS_APPLE[name] : label);
  out.push(NAMES[p.key] ?? (p.char ? p.key.toUpperCase() : p.key));
  return out;
}

/** A shortcut as text: "⌘K" on Apple, "Ctrl+K" elsewhere. */
export function formatShortcut(keys: string): string {
  return shortcutKeys(keys).join(isApplePlatform() ? '' : '+');
}

export interface ShortcutInfo {
  keys: string;
  label: string;
  group: string;
  run: ShortcutBinding['run'];
}

/** Every labelled, enabled shortcut, grouped (newest registration first within a group). */
export function shortcutList(): Array<{ group: string; shortcuts: ShortcutInfo[] }> {
  const groups = new Map<string, ShortcutInfo[]>();
  const seen = new Set<string>();
  for (let r = registrations.length - 1; r >= 0; r--) {
    for (const { keys, binding } of registrations[r]) {
      if (!binding.label || (binding.when && !binding.when())) continue;
      const id = `${keys}\u0000${binding.label}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const group = binding.group ?? 'General';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push({ keys, label: binding.label, group, run: binding.run });
    }
  }
  return [...groups].map(([group, list]) => ({ group, shortcuts: list }));
}

/** Fill `element` with a list of the shortcuts (a heading and `<dl>` per group). */
export function renderShortcutHelp(element: Element, { headingLevel = 3 }: { headingLevel?: 2 | 3 | 4 | 5 | 6 } = {}): void {
  const kbd = (keys: string) => html`<kbd>${shortcutKeys(keys).map((k, i) => html`${i ? html`<span aria-hidden="true">+</span>` : ''}<kbd>${k}</kbd>`)}</kbd>`;
  const groups = shortcutList();
  setHtml(element, html`${groups.map(({ group, shortcuts: list }) => html`<section class="ar-shortcuts">${heading(headingLevel, group)}<dl>${list.map(s => html`<div><dt>${kbd(s.keys)}</dt><dd>${s.label}</dd></div>`)}</dl></section>`)}`);
}

function heading(level: number, text: string) {
  switch (level) {
    case 2: return html`<h2>${text}</h2>`;
    case 4: return html`<h4>${text}</h4>`;
    case 5: return html`<h5>${text}</h5>`;
    case 6: return html`<h6>${text}</h6>`;
    default: return html`<h3>${text}</h3>`;
  }
}

/** The shape `<a-command-palette>` takes (`palette.addSource(shortcutSource())`). */
export interface ShortcutPaletteSource {
  id: string;
  label: string;
  order?: number;
  commands: () => Array<{ id: string; title: string; subtitle?: string; shortcut?: string; keywords?: string[]; run: () => void }>;
}

/** The labelled shortcuts as command palette entries, with their keys as hints. */
export function shortcutSource({ id = 'shortcuts', label = 'Commands', order = 0 }: { id?: string; label?: string; order?: number } = {}): ShortcutPaletteSource {
  return {
    id,
    label,
    order,
    commands: () => shortcutList().flatMap(({ group, shortcuts: list }) => list.map(s => ({
      id: `shortcut:${s.keys}:${s.label}`,
      title: s.label,
      subtitle: group === 'General' ? undefined : group,
      keywords: [group],
      shortcut: formatShortcut(s.keys),
      run: () => void s.run(),
    }))),
  };
}
