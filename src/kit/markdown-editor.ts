/**
 * `<a-markdown-editor>`: a Markdown editor around a plain `<textarea>`.
 *
 * ```html
 * <label for="doc">Notes</label>
 * <a-markdown-editor layout="split">
 *   <textarea id="doc" name="notes"></textarea>
 * </a-markdown-editor>
 * ```
 *
 * The textarea stays the real editing surface (forms, `CollabSession`,
 * spellcheck, IME and assistive technology all keep working); the editor
 * draws around and behind it:
 *
 * - **Syntax highlighting**, in a layer behind the textarea's transparent
 *   text. Only changed lines are re-highlighted.
 * - **Line numbers** that follow soft-wrapped lines, and the current line.
 * - **A toolbar** (a WAI-ARIA toolbar: arrow keys move between buttons) for
 *   bold, italic, strikethrough, code, headings, quotes, lists, checklists,
 *   links and code blocks. Ctrl/Cmd+B, I and K work too.
 * - **A live preview**, sanitized, beside or instead of the source
 *   (`layout="split" | "write" | "preview"`), scrolled in step with it.
 * - **Find and replace** (Ctrl/Cmd+F). Replace all is a single edit.
 * - **Undo and redo** of your own edits. Under `CollabSession`, other
 *   people's edits are never undone: the editor follows them through the
 *   textarea's `collab:apply` event.
 * - **Marks**: highlight ranges, such as comments (`annotations`).
 *
 * Events: `markdown:selection` `{ from, to }`, `markdown:outline`
 * (`OutlineEntry[]`), `markdown:layout` `{ layout }`.
 *
 * @module kit/markdown-editor
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import { TextOperation } from '../realtime/ot/text-operation';
import { caretAfter, UndoManager } from '../realtime/collab/undo-manager';
import type { CollabApplyDetail } from '../realtime/collab/textarea-adapter';
import { highlightLine, START_STATE, type LineState } from './markdown/highlight';
import { markdownOutline, renderMarkdown, type OutlineEntry } from './markdown/render';
import { uniqueId } from '../utils/dom';

export type MarkdownLayout = 'split' | 'write' | 'preview';

/** A highlighted range, e.g. a comment. */
export interface MarkdownMark {
  id: string;
  from: number;
  to: number;
  /** CSS color (hex, rgb() or hsl()). */
  color?: string;
  /** Drawn more strongly, e.g. the comment being read. */
  active?: boolean;
}

type Command = 'bold' | 'italic' | 'strike' | 'code' | 'heading' | 'quote' | 'bullet' | 'numbered' | 'task' | 'link' | 'codeblock';

const COMMANDS: Array<{ id: Command; label: string; icon: string; shortcut?: string } | '|'> = [
  { id: 'bold', label: 'Bold', icon: '<b>B</b>', shortcut: 'b' },
  { id: 'italic', label: 'Italic', icon: '<i>I</i>', shortcut: 'i' },
  { id: 'strike', label: 'Strikethrough', icon: '<s>S</s>' },
  { id: 'code', label: 'Inline code', icon: '<svg viewBox="0 0 20 20"><path d="M7 6l-4 4 4 4M13 6l4 4-4 4"/></svg>' },
  '|',
  { id: 'heading', label: 'Heading (repeat for smaller)', icon: '<b>H</b>' },
  { id: 'quote', label: 'Quote', icon: '<svg viewBox="0 0 20 20"><path d="M4 5v10M8 7h8M8 10h8M8 13h5"/></svg>' },
  { id: 'bullet', label: 'Bulleted list', icon: '<svg viewBox="0 0 20 20"><path d="M8 6h9M8 10h9M8 14h9"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="10" r="1"/><circle cx="4" cy="14" r="1"/></svg>' },
  { id: 'numbered', label: 'Numbered list', icon: '<svg viewBox="0 0 20 20"><path d="M8 6h9M8 10h9M8 14h9M3 4.5l1.2-.7V7.5M2.8 12.2c.4-.6 1.8-.6 1.8.4 0 .8-1.8 1.2-1.8 2.1h1.9"/></svg>' },
  { id: 'task', label: 'Checklist', icon: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="5" height="5" rx="1"/><path d="M4.2 13.6l1.2 1.2 2.2-2.6M11 6.5h6M11 13.5h6"/></svg>' },
  '|',
  { id: 'link', label: 'Link', icon: '<svg viewBox="0 0 20 20"><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1"/></svg>', shortcut: 'k' },
  { id: 'codeblock', label: 'Code block', icon: '<svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M8 8l-2 2 2 2M12 8l2 2-2 2"/></svg>' },
];

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/-]+\))$/i;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

export class MarkdownEditor extends Component {
  #textarea: HTMLTextAreaElement | null = null;
  #source!: HTMLElement;
  #stack!: HTMLElement;
  #highlight!: HTMLElement;
  #marksLayer!: HTMLElement;
  #gutter!: HTMLElement;
  #preview!: HTMLElement;
  #body!: HTMLElement;
  #toolbar!: HTMLElement;
  #find!: HTMLElement;
  #findStatus!: HTMLElement;
  #lines: string[] = [];
  #states: LineState[] = [];
  #lineEls: HTMLElement[] = [];
  #previous = '';
  #history = new UndoManager();
  #applyingHistory = false;
  #marks: MarkdownMark[] = [];
  #matches: Array<{ from: number; to: number }> = [];
  #current = -1;
  #frame = 0;
  #previewTimer: ReturnType<typeof setTimeout> | undefined;
  #outlineKey = '';
  #built = false;

  static get observedAttributes(): string[] {
    return ['layout'];
  }

  attributeChangedCallback(name: string): void {
    if (name === 'layout' && this.#built) this.#applyLayout();
  }

  /** The textarea being edited. */
  get textarea(): HTMLTextAreaElement | null {
    return this.#textarea;
  }

  get value(): string {
    return this.#textarea?.value ?? '';
  }

  get layout(): MarkdownLayout {
    const l = this.getAttribute('layout');
    return l === 'write' || l === 'preview' ? l : 'split';
  }

  set layout(layout: MarkdownLayout) {
    this.setAttribute('layout', layout);
  }

  /** The document's headings. */
  get outline(): OutlineEntry[] {
    return markdownOutline(this.value);
  }

  /** Ranges to highlight (comments and the like), in document positions. */
  get annotations(): MarkdownMark[] {
    return this.#marks;
  }

  set annotations(marks: MarkdownMark[]) {
    this.#marks = marks.filter(m => m.to >= m.from);
    this.#schedule();
  }

  protected override onConnected(): void {
    if (!this.#built) this.#build();
    const ta = this.#textarea;
    if (!ta) return;
    this.listen(ta, 'input', () => this.#onInput());
    this.listen(ta, 'collab:apply', (e: Event) => this.#onApply((e as CustomEvent<CollabApplyDetail>).detail));
    this.listen(ta, 'keydown', (e: Event) => this.#onKeydown(e as KeyboardEvent));
    this.listen(ta, 'beforeinput', (e: Event) => {
      const type = (e as InputEvent).inputType;
      if (type !== 'historyUndo' && type !== 'historyRedo') return;
      e.preventDefault();
      if (type === 'historyUndo') this.undo();
      else this.redo();
    });
    for (const type of ['keyup', 'pointerup', 'focus', 'select']) this.listen(ta, type, () => this.#onSelection());
    this.listen(document, 'selectionchange', () => {
      if (document.activeElement === ta) this.#onSelection();
    });
    this.listen(this.#source, 'scroll', () => this.#syncPreviewScroll(), { passive: true });
    this.listen(window, 'resize', () => this.#schedule());
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.#schedule());
      ro.observe(this.#stack);
      this.signal.addEventListener('abort', () => ro.disconnect());
    }
    this.#previous = ta.value;
    this.refresh();
  }

  protected override onDisconnected(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    clearTimeout(this.#previewTimer);
  }

  #build(): void {
    const ta = this.querySelector('textarea');
    if (!ta) {
      console.error('<a-markdown-editor> needs a <textarea> child.');
      return;
    }
    this.#built = true;
    this.#textarea = ta;
    ta.classList.add('ar-md__input');
    ta.spellcheck = ta.hasAttribute('spellcheck') ? ta.spellcheck : true;
    ta.setAttribute('wrap', 'soft');
    const id = uniqueId('ar-md');

    this.#toolbar = document.createElement('div');
    this.#toolbar.className = 'ar-md__toolbar';
    this.#toolbar.setAttribute('role', 'toolbar');
    this.#toolbar.setAttribute('aria-label', 'Formatting');
    this.#toolbar.setAttribute('aria-controls', ta.id || (ta.id = `${id}-input`));
    const buttons = COMMANDS.map(c => {
      if (c === '|') return '<span class="ar-md__sep" role="separator"></span>';
      const shortcut = c.shortcut ? ` (${mod}${c.shortcut.toUpperCase()})` : '';
      return `<button type="button" class="ar-md__button" data-command="${c.id}" aria-label="${c.label}" title="${c.label}${shortcut}" tabindex="-1">${c.icon}</button>`;
    }).join('');
    this.#toolbar.innerHTML = `${buttons}<span class="ar-md__spacer"></span>
      <button type="button" class="ar-md__button" data-find aria-label="Find and replace" title="Find and replace (${mod}F)" tabindex="-1"><svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2L17 17"/></svg></button>
      <span class="ar-md__sep" role="separator"></span>
      <span class="ar-md__layout" role="group" aria-label="View">
        <button type="button" class="ar-md__button ar-md__button--text" data-layout="write" tabindex="-1">Write</button>
        <button type="button" class="ar-md__button ar-md__button--text" data-layout="split" tabindex="-1">Split</button>
        <button type="button" class="ar-md__button ar-md__button--text" data-layout="preview" tabindex="-1">Preview</button>
      </span>`;
    this.#toolbar.querySelector<HTMLElement>('button')!.tabIndex = 0;

    this.#find = document.createElement('div');
    this.#find.className = 'ar-md__find';
    this.#find.hidden = true;
    this.#find.setAttribute('role', 'search');
    this.#find.innerHTML = `
      <input type="search" class="ar-md__find-input" data-find-input aria-label="Find" placeholder="Find" autocomplete="off">
      <input type="text" class="ar-md__find-input" data-replace-input aria-label="Replace with" placeholder="Replace with" autocomplete="off">
      <label class="ar-md__check"><input type="checkbox" data-case> Match case</label>
      <span class="ar-md__find-status" aria-live="polite"></span>
      <span class="ar-md__find-actions">
        <button type="button" class="ar-md__button" data-find-prev aria-label="Previous match" title="Previous match (Shift+Enter)"><svg viewBox="0 0 20 20"><path d="M5 12l5-5 5 5"/></svg></button>
        <button type="button" class="ar-md__button" data-find-next aria-label="Next match" title="Next match (Enter)"><svg viewBox="0 0 20 20"><path d="M5 8l5 5 5-5"/></svg></button>
        <button type="button" class="ar-md__button ar-md__button--text" data-replace>Replace</button>
        <button type="button" class="ar-md__button ar-md__button--text" data-replace-all>Replace all</button>
        <button type="button" class="ar-md__button" data-find-close aria-label="Close find" title="Close (Escape)"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15"/></svg></button>
      </span>`;
    this.#findStatus = this.#find.querySelector('.ar-md__find-status')!;

    this.#body = document.createElement('div');
    this.#body.className = 'ar-md__body';
    this.#source = document.createElement('div');
    this.#source.className = 'ar-md__source';
    this.#gutter = document.createElement('div');
    this.#gutter.className = 'ar-md__gutter';
    this.#gutter.setAttribute('aria-hidden', 'true');
    this.#stack = document.createElement('div');
    this.#stack.className = 'ar-md__stack';
    this.#marksLayer = document.createElement('div');
    this.#marksLayer.className = 'ar-md__layer ar-md__marks';
    this.#marksLayer.setAttribute('aria-hidden', 'true');
    this.#highlight = document.createElement('div');
    this.#highlight.className = 'ar-md__layer ar-md__highlight';
    this.#highlight.setAttribute('aria-hidden', 'true');
    this.#preview = document.createElement('div');
    this.#preview.className = 'ar-md__preview ar-prose';
    this.#preview.setAttribute('role', 'region');
    this.#preview.setAttribute('aria-label', 'Preview');
    this.#preview.tabIndex = 0;

    this.#stack.append(this.#marksLayer, this.#highlight, ta);
    this.#source.append(this.#gutter, this.#stack);
    this.#body.append(this.#source, this.#preview);
    this.replaceChildren(this.#toolbar, this.#find, this.#body);
    this.classList.add('ar-md');

    this.#wireToolbar();
    this.#wireFind();
    this.#applyLayout();
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  /** Re-read the textarea (call after changing its value from code without an `input` event). */
  refresh(): void {
    this.#previous = this.value;
    this.#renderLines();
    this.#schedule();
    this.#queuePreview();
    this.#emitOutline();
  }

  /** Re-highlight only the lines that changed. */
  #renderLines(): void {
    const next = this.value.split('\n');
    const prev = this.#lines;
    let start = 0;
    while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
    let endPrev = prev.length;
    let endNext = next.length;
    while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
      endPrev--;
      endNext--;
    }
    // The state that used to flow into the first unchanged line after the edit.
    const oldFlow = endPrev > 0 ? this.#states[endPrev - 1] : START_STATE;
    const created: HTMLElement[] = [];
    const states: LineState[] = [];
    let state = start > 0 ? this.#states[start - 1] : START_STATE;
    for (let i = start; i < endNext; i++) {
      const el = document.createElement('div');
      el.className = 'ar-md__line';
      const result = highlightLine(next[i], state);
      el.innerHTML = result.html || '<br>';
      state = result.state;
      created.push(el);
      states.push(state);
    }
    const removed = this.#lineEls.splice(start, endPrev - start, ...created);
    this.#states.splice(start, endPrev - start, ...states);
    for (const el of removed) el.remove();
    const anchor = this.#lineEls[start + created.length] ?? null;
    for (const el of created) this.#highlight.insertBefore(el, anchor);
    this.#lines = next;
    // If the edit opened or closed a code block, the change ripples down until the state matches again.
    if (state.fence === oldFlow.fence) return;
    for (let i = start + created.length; i < next.length; i++) {
      const result = highlightLine(next[i], state);
      const old = this.#states[i];
      this.#lineEls[i].innerHTML = result.html || '<br>';
      this.#states[i] = result.state;
      state = result.state;
      if (result.state.fence === old.fence) break;
    }
  }

  #schedule(): void {
    if (this.#frame || !this.#built) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#layout();
    });
  }

  /** Size the textarea to its content, place line numbers, draw marks. */
  #layout(): void {
    const ta = this.#textarea;
    if (!ta) return;
    ta.style.height = `${Math.max(this.#highlight.offsetHeight, 0)}px`;
    const caretLine = this.value.slice(0, ta.selectionStart ?? 0).split('\n').length - 1;
    const numbers: string[] = [];
    this.#lineEls.forEach((el, i) => {
      el.classList.toggle('is-current', i === caretLine && document.activeElement === ta);
      numbers.push(`<span style="top:${el.offsetTop}px"${i === caretLine ? ' class="is-current"' : ''}>${i + 1}</span>`);
    });
    this.#gutter.innerHTML = numbers.join('');
    this.#gutter.style.height = `${this.#highlight.offsetHeight}px`;
    this.#renderMarks();
  }

  #renderMarks(): void {
    type Range = { from: number; to: number; cls: string; color?: string };
    const ranges: Range[] = [
      ...this.#marks.map(m => ({ from: m.from, to: m.to, cls: `ar-md__mark${m.active ? ' is-active' : ''}`, color: m.color && SAFE_COLOR.test(m.color) ? m.color : undefined })),
      ...this.#matches.map((m, i) => ({ ...m, cls: `ar-md__match${i === this.#current ? ' is-current' : ''}` })),
    ].filter(r => r.to > r.from);
    if (!ranges.length) {
      this.#marksLayer.textContent = '';
      return;
    }
    // Split the text at every boundary and wrap each piece in the ranges covering it.
    const text = this.value;
    const points = [...new Set([0, text.length, ...ranges.flatMap(r => [r.from, r.to])])].filter(p => p >= 0 && p <= text.length).sort((a, b) => a - b);
    let html = '';
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]];
      let piece = esc(text.slice(a, b));
      for (const r of ranges) {
        if (r.from <= a && r.to >= b) piece = `<span class="${r.cls}"${r.color ? ` style="--mark: ${r.color}"` : ''}>${piece}</span>`;
      }
      html += piece;
    }
    this.#marksLayer.innerHTML = html;
  }

  #queuePreview(): void {
    if (this.layout === 'write') return;
    clearTimeout(this.#previewTimer);
    this.#previewTimer = setTimeout(() => {
      this.#preview.innerHTML = renderMarkdown(this.value);
      this.#syncPreviewScroll();
    }, 120);
  }

  #emitOutline(): void {
    const outline = this.outline;
    const key = JSON.stringify(outline.map(o => [o.level, o.text, o.line]));
    if (key === this.#outlineKey) return;
    this.#outlineKey = key;
    this.emit('markdown:outline', outline);
  }

  #applyLayout(): void {
    const layout = this.layout;
    this.#body.dataset.layout = layout;
    for (const b of this.#toolbar.querySelectorAll<HTMLElement>('[data-layout]')) b.setAttribute('aria-pressed', String(b.dataset.layout === layout));
    // The source is still there in preview mode (collaboration keeps working), just not shown.
    this.#source.hidden = layout === 'preview';
    this.#preview.hidden = layout === 'write';
    if (layout !== 'write') this.#queuePreview();
    this.#schedule();
    this.emit('markdown:layout', { layout });
  }

  /** Keep the preview at the heading or paragraph that is at the top of the source. */
  #syncPreviewScroll(): void {
    if (this.layout !== 'split') return;
    const top = this.#source.scrollTop;
    let line = 0;
    for (let i = 0; i < this.#lineEls.length; i++) {
      if (this.#lineEls[i].offsetTop > top) break;
      line = i;
    }
    let target: HTMLElement | null = null;
    for (const el of this.#preview.querySelectorAll<HTMLElement>('[data-line]')) {
      if (Number(el.dataset.line) > line) break;
      target = el;
    }
    this.#preview.scrollTop = target ? target.offsetTop - this.#preview.offsetTop - 8 : 0;
  }

  // ── Editing ────────────────────────────────────────────────────────────

  #onInput(): void {
    const value = this.value;
    if (!this.#applyingHistory && value !== this.#previous) this.#history.record(TextOperation.fromDiff(this.#previous, value), this.#previous);
    this.#previous = value;
    this.#afterChange();
  }

  #onApply(detail: CollabApplyDetail): void {
    if (detail.op && detail.remote) this.#history.transform(detail.op);
    else if (!detail.op) this.#history.clear();
    this.#previous = this.value;
    this.#afterChange();
  }

  #afterChange(): void {
    this.#renderLines();
    if (this.#find.hidden === false) this.#search(false);
    this.#schedule();
    this.#queuePreview();
    this.#emitOutline();
  }

  #onSelection(): void {
    const ta = this.#textarea!;
    this.#schedule();
    this.emit('markdown:selection', { from: Math.min(ta.selectionStart, ta.selectionEnd), to: Math.max(ta.selectionStart, ta.selectionEnd) });
  }

  /** Replace `from`–`to` with `text` as a user edit (it fires `input`), then select `select`. */
  replaceRange(from: number, to: number, text: string, select?: [number, number]): void {
    const ta = this.#textarea;
    if (!ta || ta.readOnly) return;
    ta.focus();
    ta.setRangeText(text, from, to, 'end');
    if (select) ta.setSelectionRange(select[0], select[1]);
    ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
    this.#history.break();
  }

  /** Undo your last edit. */
  undo(): boolean {
    return this.#applyHistory(this.#history.undo(this.value));
  }

  /** Redo your last undone edit. */
  redo(): boolean {
    return this.#applyHistory(this.#history.redo(this.value));
  }

  #applyHistory(op: TextOperation | null): boolean {
    const ta = this.#textarea;
    if (!op || !ta || ta.readOnly) return false;
    const before = this.value;
    const after = op.apply(before);
    // Replace just the changed region, so the textarea's own diff is small.
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let endB = before.length;
    let endA = after.length;
    while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
      endB--;
      endA--;
    }
    this.#applyingHistory = true;
    try {
      ta.setRangeText(after.slice(start, endA), start, endB, 'end');
      const caret = caretAfter(op);
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'historyUndo' }));
    } finally {
      this.#applyingHistory = false;
    }
    this.#revealCaret();
    return true;
  }

  #onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (key === 'z' && !e.shiftKey) this.undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') this.redo();
      else if (key === 'f') this.openFind();
      else if (key === 'b' && !e.shiftKey) this.format('bold');
      else if (key === 'i' && !e.shiftKey) this.format('italic');
      else if (key === 'k' && !e.shiftKey) this.format('link');
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (this.#continueList()) e.preventDefault();
    } else if (e.key === 'Tab' && this.#indentList(e.shiftKey)) {
      e.preventDefault();
    } else if (e.key === 'Escape' && !this.#find.hidden) {
      this.closeFind();
    }
    requestAnimationFrame(() => this.#revealCaret());
  }

  /** Enter in a list item continues the list; on an empty item it ends the list. */
  #continueList(): boolean {
    const ta = this.#textarea!;
    if (ta.selectionStart !== ta.selectionEnd) return false;
    const pos = ta.selectionStart;
    const lineStart = this.value.lastIndexOf('\n', pos - 1) + 1;
    const line = this.value.slice(lineStart, pos);
    const m = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line);
    const quote = /^(\s*>\s?)+/.exec(line);
    if (!m && !quote) return false;
    const prefix = m ? m[0] : quote![0];
    if (line.length === prefix.length) {
      // An empty item: remove the marker and stop the list.
      this.replaceRange(lineStart, pos, '');
      return true;
    }
    let next = prefix;
    if (m?.[3]) next = `${m[1]}${Number(m[3]) + 1}${m[4]}${m[5]}${m[6] ? '[ ] ' : ''}`;
    else if (m?.[6]) next = `${m[1]}${m[2]}${m[5]}[ ] `;
    this.replaceRange(pos, pos, `\n${next}`);
    return true;
  }

  /** Tab / Shift+Tab indents or outdents list items. */
  #indentList(outdent: boolean): boolean {
    const ta = this.#textarea!;
    const { start, end, text } = this.#selectedLines();
    if (!text.split('\n').every(l => /^\s*([-*+]|\d+[.)])\s/.test(l) || !l.trim())) return false;
    const changed = text.split('\n').map(l => (outdent ? l.replace(/^ {1,2}/, '') : l.trim() ? `  ${l}` : l)).join('\n');
    const caret = ta.selectionStart + (changed.length - text.length) * (ta.selectionStart === ta.selectionEnd ? 1 : 0);
    this.replaceRange(start, end, changed, ta.selectionStart === ta.selectionEnd ? [Math.max(start, caret), Math.max(start, caret)] : [start, start + changed.length]);
    return true;
  }

  #selectedLines(): { start: number; end: number; text: string } {
    const ta = this.#textarea!;
    const value = this.value;
    const start = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let end = value.indexOf('\n', Math.max(ta.selectionEnd - (ta.selectionEnd > ta.selectionStart && value[ta.selectionEnd - 1] === '\n' ? 1 : 0), start));
    if (end === -1) end = value.length;
    return { start, end, text: value.slice(start, end) };
  }

  /** Apply a toolbar command to the selection. */
  format(command: Command): void {
    const ta = this.#textarea;
    if (!ta || ta.readOnly) return;
    const value = this.value;
    const from = ta.selectionStart;
    const to = ta.selectionEnd;
    const selected = value.slice(from, to);
    const wrap = (left: string, right = left, placeholder = 'text') => {
      // Toggle off if the selection is already wrapped.
      if (value.slice(from - left.length, from) === left && value.slice(to, to + right.length) === right) {
        this.replaceRange(from - left.length, to + right.length, selected, [from - left.length, to - left.length]);
        return;
      }
      const inner = selected || placeholder;
      this.replaceRange(from, to, `${left}${inner}${right}`, [from + left.length, from + left.length + inner.length]);
    };
    const prefixLines = (make: (line: string, index: number) => string) => {
      const { start, end, text } = this.#selectedLines();
      const changed = text.split('\n').map(make).join('\n');
      this.replaceRange(start, end, changed, [start, start + changed.length]);
    };
    const toggle = (pattern: RegExp, prefix: (i: number) => string) => {
      const { text } = this.#selectedLines();
      const all = text.split('\n').every(l => pattern.test(l) || !l.trim());
      prefixLines((l, i) => (all ? l.replace(pattern, '') : l.trim() ? prefix(i) + l.replace(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '$1') : l));
    };
    switch (command) {
      case 'bold': return wrap('**');
      case 'italic': return wrap('_');
      case 'strike': return wrap('~~');
      case 'code': return wrap('`', '`', 'code');
      case 'link': {
        const label = selected || 'link text';
        const url = 'https://';
        const text = `[${label}](${url})`;
        const at = from + label.length + 3;
        this.replaceRange(from, to, text, selected ? [at, at + url.length] : [from + 1, from + 1 + label.length]);
        return;
      }
      case 'codeblock': {
        const { start, end, text } = this.#selectedLines();
        const body = text || '';
        this.replaceRange(start, end, `\`\`\`\n${body}\n\`\`\``, [start + 4, start + 4 + body.length]);
        return;
      }
      case 'heading':
        return prefixLines(l => {
          const m = /^(#{1,6})\s+/.exec(l);
          if (!m) return `# ${l}`;
          return m[1].length >= 3 ? l.slice(m[0].length) : `${m[1]}# ${l.slice(m[0].length)}`;
        });
      case 'quote': return toggle(/^>\s?/, () => '> ');
      case 'bullet': return toggle(/^\s*[-*+]\s+(?!\[[ xX]\])/, () => '- ');
      case 'numbered': return toggle(/^\s*\d+[.)]\s+/, i => `${i + 1}. `);
      case 'task': return toggle(/^\s*[-*+]\s+\[[ xX]\]\s+/, () => '- [ ] ');
    }
  }

  #wireToolbar(): void {
    this.listen(this.#toolbar, 'click', (e: Event) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.dataset.command) this.format(button.dataset.command as Command);
      else if (button.dataset.layout) this.layout = button.dataset.layout as MarkdownLayout;
      else if (button.hasAttribute('data-find')) this.openFind();
    });
    // Roving tabindex: one tab stop, arrow keys move.
    this.listen(this.#toolbar, 'keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      const buttons = Array.from(this.#toolbar.querySelectorAll<HTMLButtonElement>('button'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index === -1) return;
      let next = -1;
      if (ke.key === 'ArrowRight') next = (index + 1) % buttons.length;
      else if (ke.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
      else if (ke.key === 'Home') next = 0;
      else if (ke.key === 'End') next = buttons.length - 1;
      if (next === -1) return;
      ke.preventDefault();
      buttons[index].tabIndex = -1;
      buttons[next].tabIndex = 0;
      buttons[next].focus();
    });
    // Keep the textarea's selection when a toolbar button is clicked with the mouse.
    this.listen(this.#toolbar, 'mousedown', (e: Event) => {
      if ((e.target as HTMLElement).closest('[data-command]')) e.preventDefault();
    });
  }

  // ── Find and replace ───────────────────────────────────────────────────

  #wireFind(): void {
    const input = this.#find.querySelector<HTMLInputElement>('[data-find-input]')!;
    const replace = this.#find.querySelector<HTMLInputElement>('[data-replace-input]')!;
    this.listen(input, 'input', () => this.#search(true));
    this.listen(this.#find.querySelector('[data-case]')!, 'change', () => this.#search(true));
    this.listen(this.#find, 'keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Escape') {
        ke.preventDefault();
        this.closeFind();
      } else if (ke.key === 'Enter' && ke.target === input) {
        ke.preventDefault();
        this.findNext(ke.shiftKey ? -1 : 1);
      } else if (ke.key === 'Enter' && ke.target === replace) {
        ke.preventDefault();
        this.replaceCurrent();
      }
    });
    this.listen(this.#find, 'click', (e: Event) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.hasAttribute('data-find-next')) this.findNext(1);
      else if (b.hasAttribute('data-find-prev')) this.findNext(-1);
      else if (b.hasAttribute('data-replace')) this.replaceCurrent();
      else if (b.hasAttribute('data-replace-all')) this.replaceAll();
      else if (b.hasAttribute('data-find-close')) this.closeFind();
    });
  }

  openFind(): void {
    const ta = this.#textarea;
    this.#find.hidden = false;
    const input = this.#find.querySelector<HTMLInputElement>('[data-find-input]')!;
    const selected = ta ? this.value.slice(ta.selectionStart, ta.selectionEnd) : '';
    if (selected && !selected.includes('\n')) input.value = selected;
    input.focus();
    input.select();
    this.#search(true);
  }

  closeFind(): void {
    this.#find.hidden = true;
    this.#matches = [];
    this.#current = -1;
    this.#schedule();
    this.#textarea?.focus();
  }

  #search(jump: boolean): void {
    const needle = this.#find.querySelector<HTMLInputElement>('[data-find-input]')!.value;
    const matchCase = this.#find.querySelector<HTMLInputElement>('[data-case]')!.checked;
    this.#matches = [];
    if (needle) {
      const hay = matchCase ? this.value : this.value.toLowerCase();
      const n = matchCase ? needle : needle.toLowerCase();
      for (let i = hay.indexOf(n); i !== -1 && this.#matches.length < 10000; i = hay.indexOf(n, i + n.length)) this.#matches.push({ from: i, to: i + n.length });
    }
    const caret = this.#textarea?.selectionStart ?? 0;
    if (jump || this.#current >= this.#matches.length) {
      const after = this.#matches.findIndex(m => m.from >= caret);
      this.#current = this.#matches.length ? (after === -1 ? 0 : after) : -1;
    }
    this.#updateFindStatus();
    this.#schedule();
    if (jump) this.#revealMatch();
  }

  #updateFindStatus(): void {
    const needle = this.#find.querySelector<HTMLInputElement>('[data-find-input]')!.value;
    this.#findStatus.textContent = !needle ? '' : this.#matches.length ? `${this.#current + 1} of ${this.#matches.length}` : 'No results';
  }

  /** Move to the next (1) or previous (-1) match. */
  findNext(direction: 1 | -1 = 1): void {
    if (!this.#matches.length) return;
    this.#current = (this.#current + direction + this.#matches.length) % this.#matches.length;
    this.#updateFindStatus();
    this.#schedule();
    this.#revealMatch();
  }

  #revealMatch(): void {
    const m = this.#matches[this.#current];
    const ta = this.#textarea;
    if (!m || !ta) return;
    ta.setSelectionRange(m.from, m.to);
    this.revealOffset(m.from, false);
  }

  replaceCurrent(): void {
    const m = this.#matches[this.#current];
    if (!m) return;
    const text = this.#find.querySelector<HTMLInputElement>('[data-replace-input]')!.value;
    this.replaceRange(m.from, m.to, text);
    this.#search(false);
    if (this.#matches.length) {
      this.#current = Math.max(0, this.#matches.findIndex(x => x.from >= m.from + text.length));
      this.#updateFindStatus();
      this.#revealMatch();
    }
    this.#find.querySelector<HTMLInputElement>('[data-replace-input]')!.focus();
  }

  /** Replace every match, as one edit (one undo step). */
  replaceAll(): void {
    if (!this.#matches.length) return;
    const text = this.#find.querySelector<HTMLInputElement>('[data-replace-input]')!.value;
    const count = this.#matches.length;
    const first = this.#matches[0].from;
    const last = this.#matches[count - 1].to;
    let out = '';
    let at = first;
    for (const m of this.#matches) {
      out += this.value.slice(at, m.from) + text;
      at = m.to;
    }
    this.replaceRange(first, last, out);
    this.#search(false);
    this.#findStatus.textContent = `Replaced ${count}`;
    this.#find.querySelector<HTMLInputElement>('[data-find-input]')!.focus();
  }

  // ── Scrolling ──────────────────────────────────────────────────────────

  /** Scroll the source so that a position is visible (optionally moving the caret there). */
  revealOffset(offset: number, moveCaret = true): void {
    const ta = this.#textarea;
    if (!ta) return;
    if (moveCaret) {
      ta.focus();
      ta.setSelectionRange(offset, offset);
    }
    const line = this.value.slice(0, offset).split('\n').length - 1;
    const el = this.#lineEls[line];
    if (!el) return;
    const top = el.offsetTop;
    const view = this.#source;
    if (top < view.scrollTop || top + el.offsetHeight > view.scrollTop + view.clientHeight) view.scrollTop = Math.max(0, top - view.clientHeight / 3);
  }

  /** Keep the caret's line in view while typing. */
  #revealCaret(): void {
    const ta = this.#textarea;
    if (!ta || document.activeElement !== ta) return;
    const line = this.value.slice(0, ta.selectionEnd).split('\n').length - 1;
    const el = this.#lineEls[line];
    if (!el) return;
    const view = this.#source;
    const margin = 24;
    if (el.offsetTop - margin < view.scrollTop) view.scrollTop = el.offsetTop - margin;
    else if (el.offsetTop + el.offsetHeight + margin > view.scrollTop + view.clientHeight) view.scrollTop = el.offsetTop + el.offsetHeight + margin - view.clientHeight;
  }
}

defineComponent({ tag: 'a-markdown-editor' })(MarkdownEditor);
