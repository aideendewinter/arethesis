import 'arethesis/components';
import type { Dialog } from 'arethesis/components';
import {
  attachPopup,
  definePrefs,
  findRanges,
  highlighter,
  html,
  intentMixin,
  pushLayer,
  renderShortcutHelp,
  selectionMenuMixin,
  setHtml,
  shortcutSource,
  shortcuts,
  textOffset,
  textRange,
  wordRanges,
  type IntentVia,
} from 'arethesis';
import { startApp } from '../shared/boot';
import { addCommands, mountShell, toast } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'reader',
  title: 'The Reader',
  description: 'Heraclitus, in pieces. Search, marks and follow-along reading highlight the text without changing it, and words respond to taps without being wrapped in spans; glosses appear on hover and stick on tap; selections get a menu; settings persist and follow other tabs; and every shortcut is listed for you.',
  features: ['highlighter', 'selection-menu', 'intent', 'shortcuts', 'definePrefs', 'html'],
  source,
  footnote: 'Free renderings of the fragments, numbered after Diels and Kranz.',
});

await startApp('reader', { persistence: false }, { live: false });

const text = document.querySelector<HTMLOListElement>('.reader__fragments')!;
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

// ── Settings: typed, saved, and shared between tabs ──

const prefs = definePrefs({
  key: 'arethesis-reader',
  version: 1,
  defaults: { size: 19, leading: '1.75', pace: 240, glosses: true, marks: [] as Array<[number, number]> },
  validate: {
    size: v => v >= 14 && v <= 28,
    leading: v => ['1.5', '1.75', '2'].includes(v),
    pace: v => [160, 240, 360].includes(v),
  },
});

const size = $<HTMLInputElement>('#size');
const leading = $<HTMLSelectElement>('#leading');
const pace = $<HTMLSelectElement>('#pace');
const glosses = $<HTMLInputElement>('#glosses');

function applySettings(): void {
  const s = prefs.all();
  text.style.fontSize = `${s.size}px`;
  text.style.lineHeight = s.leading;
  size.value = String(s.size);
  size.setAttribute('aria-valuetext', `${s.size} pixels`);
  leading.value = s.leading;
  pace.value = String(s.pace);
  glosses.checked = s.glosses;
  renderMarks();
}

size.addEventListener('input', () => prefs.set('size', Number(size.value)));
leading.addEventListener('change', () => prefs.set('leading', leading.value));
pace.addEventListener('change', () => prefs.set('pace', Number(pace.value)));
glosses.addEventListener('change', () => prefs.set('glosses', glosses.checked));
$('#settings-reset').addEventListener('click', () => prefs.update({ size: 19, leading: '1.75', pace: 240, glosses: true }));
prefs.on('*', applySettings);

// The settings panel is a layer: Escape closes it before anything else.
const panel = $('#settings');
const panelToggle = $<HTMLButtonElement>('#settings-toggle');
let releasePanel: (() => void) | null = null;

function toggleSettings(open = panel.hidden): void {
  if (open === !panel.hidden) return;
  panel.hidden = !open;
  panelToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    releasePanel = pushLayer(panel, () => toggleSettings(false));
    size.focus();
  } else {
    releasePanel?.();
    releasePanel = null;
    if (panel.contains(document.activeElement) || document.activeElement === document.body) panelToggle.focus();
  }
}
panelToggle.addEventListener('click', () => toggleSettings());

// ── Marks: highlighted ranges, kept as text offsets ──

const marks = highlighter('reader-mark');
const offsets = (range: Range): [number, number] => [textOffset(text, range.startContainer, range.startOffset) ?? 0, textOffset(text, range.endContainer, range.endOffset) ?? 0];
const overlaps = ([s, e]: [number, number]) => prefs.get('marks').filter(([ms, me]) => ms < e && me > s);

function renderMarks(): void {
  marks.set(prefs.get('marks').map(([s, e]) => textRange(text, s, e)).filter((r): r is Range => r !== null));
}

selectionMenuMixin(text, {
  items: range => [
    { label: 'Mark', action: 'mark', icon: '✎' },
    ...(overlaps(offsets(range)).length ? [{ label: 'Unmark', action: 'unmark', icon: '⌫' }] : []),
    { label: 'Copy', action: 'copy', icon: '⧉' },
  ],
});

text.addEventListener('selection-menu:select', e => {
  const { action, range, text: selected } = (e as CustomEvent<{ action: string; range: Range; text: string }>).detail;
  const [s, end] = offsets(range);
  if (action === 'mark') {
    // Merge with any marks it touches.
    const touching = overlaps([s, end]);
    const merged: [number, number] = [Math.min(s, ...touching.map(m => m[0])), Math.max(end, ...touching.map(m => m[1]))];
    prefs.set('marks', [...prefs.get('marks').filter(m => !touching.includes(m)), merged].sort((a, b) => a[0] - b[0]));
  } else if (action === 'unmark') {
    const touching = overlaps([s, end]);
    prefs.set('marks', prefs.get('marks').filter(m => !touching.some(t => t[0] === m[0] && t[1] === m[1])));
  } else if (action === 'copy') {
    navigator.clipboard?.writeText(selected).then(() => toast('Copied.', 'success'), () => toast('Copying isn’t allowed here.', 'error'));
  }
});

// ── Find: matches highlighted in place ──

const find = $<HTMLInputElement>('#find');
const count = $('#find-count');
const matches = highlighter('ar-search');
const current = highlighter('ar-search-current', { priority: 1 });
let found: Range[] = [];
let index = -1;

function search(): void {
  const query = find.value.trim();
  found = query.length >= 2 ? findRanges(text, query) : [];
  matches.set(found);
  go(found.length ? 0 : -1);
}

function go(i: number): void {
  index = found.length ? (i + found.length) % found.length : -1;
  current.set(index >= 0 ? [found[index]] : []);
  setHtml(count, find.value.trim().length < 2 ? html`` : found.length ? html`<b>${index + 1}</b> of ${found.length}` : html`No matches`);
  const hit = found[index]?.startContainer.parentElement;
  hit?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

find.addEventListener('input', search);
find.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    go(index + (e.shiftKey ? -1 : 1));
  }
});
document.querySelector('[data-find=prev]')!.addEventListener('click', () => go(index - 1));
document.querySelector('[data-find=next]')!.addEventListener('click', () => go(index + 1));

function clearSearch(): boolean {
  if (!find.value) return false;
  find.value = '';
  search();
  return true;
}

// ── Follow along: one word at a time ──

const word = highlighter('reader-word', { priority: 2 });
const followButton = $<HTMLButtonElement>('#follow');
let words: Range[] = [];
let wordIndex = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function follow(on = timer === null): void {
  if (timer) clearInterval(timer);
  timer = null;
  followButton.setAttribute('aria-pressed', String(on));
  if (!on) {
    word.clear();
    jump.cancel();
    return;
  }
  words = wordRanges(text);
  if (wordIndex >= words.length) wordIndex = 0;
  const step = (): void => {
    const range = words[wordIndex++];
    if (!range) return follow(false);
    word.set([range]);
  };
  step();
  timer = setInterval(step, 60_000 / prefs.get('pace'));
}
followButton.addEventListener('click', () => follow());

// While following, point at a word (no spans: the words are Ranges) and tap,
// click or press Enter to read on from there. The arrow keys move between words.
const pointed = highlighter('reader-hover', { priority: 1 });
const jump = intentMixin(text, {
  ranges: () => (timer ? words : []),
  events: false,
  onShow: range => pointed.set([range]),
  onCancel: () => pointed.clear(),
  onCommit: range => {
    wordIndex = Math.max(0, words.indexOf(range));
    queueMicrotask(() => {
      jump.cancel();
      follow(true);
    });
  },
});

// ── Glosses: shown on hover or focus, pinned on tap or click ──

const gloss = document.createElement('div');
gloss.className = 'reader-gloss';
gloss.id = 'gloss';
gloss.setAttribute('role', 'tooltip');
document.body.append(gloss);
let term: HTMLElement | null = null;
const glossPopup = attachPopup(gloss, { anchor: () => term ?? text, placement: 'top', mode: 'hint' });

intentMixin(text, { selector: '.gloss' });
text.addEventListener('intent:show', e => {
  const { target, via } = (e as CustomEvent<{ target: HTMLElement; via: IntentVia }>).detail;
  if (via === 'hover' && !prefs.get('glosses')) return;
  showGloss(target, false);
});
text.addEventListener('intent:commit', e => showGloss((e as CustomEvent<{ target: HTMLElement }>).detail.target, true));
text.addEventListener('intent:cancel', () => {
  term?.removeAttribute('aria-describedby');
  term = null;
  glossPopup.hide();
});

function showGloss(target: HTMLElement, pinned: boolean): void {
  term?.removeAttribute('aria-describedby');
  term = target;
  setHtml(gloss, html`<strong lang="grc-Latn">${target.textContent}</strong> ${target.dataset.gloss}`);
  gloss.classList.toggle('is-pinned', pinned);
  target.setAttribute('aria-describedby', gloss.id);
  glossPopup.show();
  glossPopup.reposition();
}

// ── Shortcuts, listed in help and in the command palette ──

const help = $<Dialog>('#help');
function showHelp(): void {
  renderShortcutHelp($('#help-list'), { headingLevel: 3 });
  void help.open();
}
$('#help-toggle').addEventListener('click', showHelp);

shortcuts({
  '/': { run: () => find.focus(), label: 'Find in text', group: 'Find' },
  n: { run: () => go(index + 1), label: 'Next match', group: 'Find', when: () => found.length > 0 },
  'Shift+N': { run: () => go(index - 1), label: 'Previous match', group: 'Find', when: () => found.length > 0 },
  Escape: { run: () => clearSearch() || (follow(false), false), label: 'Clear the search', group: 'Find', allowInInput: true },
  f: { run: () => follow(), label: 'Follow along', group: 'Reading' },
  '+': { run: () => prefs.set('size', Math.min(28, prefs.get('size') + 1)), label: 'Larger text', group: 'Reading' },
  '-': { run: () => prefs.set('size', Math.max(14, prefs.get('size') - 1)), label: 'Smaller text', group: 'Reading' },
  s: { run: () => toggleSettings(), label: 'Settings', group: 'Reading' },
  '?': { run: showHelp, label: 'Keyboard shortcuts' },
});
addCommands(shortcutSource({ id: 'reader', label: 'Reader' }));

applySettings();
