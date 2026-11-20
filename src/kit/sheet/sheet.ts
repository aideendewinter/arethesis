/**
 * `<a-sheet>`: a spreadsheet with formulas, range selection, clipboard,
 * fill, undo, and room for collaborators.
 *
 * ```ts
 * sheet.configure({ rows: 200, cols: 12, cells: { A1: 'Polis', B1: 'Tribute', B9: '=SUM(B2:B8)' } });
 * sheet.on('sheet:change', ({ changes }) => save(changes));       // local edits
 * sheet.setCells({ B2: '6' }, { remote: true, by: 'Pericles' });   // edits from elsewhere
 * ```
 *
 * Only the visible rows are in the DOM. The grid is one focusable element
 * (`role="grid"` with `aria-activedescendant`), so screen readers follow
 * the active cell as it moves.
 *
 * Keys follow the grid editing decisions: a click edits; arrows, Tab and
 * Home/End only move (Shift extends the selection); typing replaces the
 * cell and then arrows save and move; Enter saves and moves down; Escape
 * reverts. Delete clears, Ctrl/Cmd+C/X/V copy, cut and paste (as tab-separated
 * text, formulas shifted), Ctrl/Cmd+D and R fill down and right, Ctrl/Cmd+Z
 * and Y undo and redo your own edits.
 *
 * Events: `sheet:change` `{ changes }` (local edits, raw content by
 * address), `sheet:select` `{ active, range }`.
 *
 * @module kit/sheet/sheet
 */

import { Component } from '../../components/component';
import { defineComponent } from '../../components/decorators';
import { announce } from '../../mixins/utils';
import { uniqueId } from '../../utils/dom';
import { openCellEditor, type CellEditor, type CellMove } from '../cell-editor';
import { address, colName, FormulaError, parseAddress, shiftFormula, type CellValue } from './formula';
import { SheetModel } from './model';

export interface SheetConfig {
  rows?: number;
  cols?: number;
  /** Initial contents: raw text or `=formulas` by address. */
  cells?: Record<string, string>;
  /** Accessible name. @default 'Spreadsheet' */
  label?: string;
  /** Format a computed number for display. */
  formatNumber?: (value: number, addr: string) => string;
  /** Column widths in px by column letter. */
  widths?: Record<string, number>;
  /** Read-only cells (e.g. headings) by address. */
  readOnly?: (addr: string) => boolean;
}

interface Pos {
  row: number;
  col: number;
}

const ROW_HEIGHT = 32;
const OVERSCAN = 8;
const CLIP_TYPE = 'application/x-arethesis-sheet';
const ERROR_HELP: Record<string, string> = {
  '#REF!': 'Refers to a cell outside the sheet',
  '#DIV/0!': 'Divides by zero',
  '#VALUE!': 'Uses text where a number is needed',
  '#NAME?': 'Unknown function',
  '#CYCLE!': 'Refers to itself, directly or through other cells',
  '#ERROR!': "Can't read this formula",
};

export class Sheet extends Component {
  #config: Required<Pick<SheetConfig, 'rows' | 'cols' | 'label'>> & SheetConfig = { rows: 100, cols: 10, label: 'Spreadsheet' };
  #model = new SheetModel(100, 10);
  #active: Pos = { row: 0, col: 0 };
  #anchor: Pos = { row: 0, col: 0 };
  #editor: CellEditor | null = null;
  #undo: Array<Record<string, [string, string]>> = [];
  #redo: Array<Record<string, [string, string]>> = [];
  #remote = new Map<string, { by?: string; until: number }>();
  #id = uniqueId('ar-sheet');
  #built = false;
  #frame = 0;
  #scroller!: HTMLElement;
  #grid!: HTMLElement;
  #body!: HTMLElement;
  #headRow!: HTMLElement;
  #nameBox!: HTMLElement;
  #formula!: HTMLInputElement;
  #drag: { start: Pos; moved: boolean; pointerId: number } | null = null;

  configure(config: SheetConfig): void {
    this.#config = { rows: 100, cols: 10, label: 'Spreadsheet', ...config };
    this.#model = new SheetModel(this.#config.rows, this.#config.cols);
    if (config.cells) this.#model.set(config.cells);
    this.#undo = [];
    this.#redo = [];
    if (this.isConnected) this.#build();
    this.#schedule();
  }

  /** The model behind the sheet (raw content and computed values). */
  get model(): SheetModel {
    return this.#model;
  }

  get active(): string {
    return address(this.#active.row, this.#active.col);
  }

  /** The selected range, e.g. "B2:C5" (or one address). */
  get selection(): string {
    const { r0, r1, c0, c1 } = this.#range();
    const a = address(r0, c0);
    const b = address(r1, c1);
    return a === b ? a : `${a}:${b}`;
  }

  getValue(addr: string): CellValue {
    return this.#model.getValue(addr);
  }

  /**
   * Set cells from code. Local changes (the default) are undoable and fire
   * `sheet:change`; `{ remote: true }` applies someone else's edit, briefly
   * highlighting it.
   */
  setCells(changes: Record<string, string>, options: { remote?: boolean; by?: string } = {}): void {
    const filtered = Object.fromEntries(Object.entries(changes).filter(([a]) => this.#inBounds(a)));
    if (!Object.keys(filtered).length) return;
    if (options.remote) {
      const until = Date.now() + 1500;
      for (const addr of Object.keys(filtered)) {
        if (this.#model.getRaw(addr) === filtered[addr]) continue;
        this.#remote.set(addr, { by: options.by, until });
        // Our undo history can't safely restore a cell someone else has changed since.
        for (const stack of [this.#undo, this.#redo]) for (const entry of stack) delete entry[addr];
      }
      this.#model.set(filtered);
      setTimeout(() => this.#schedule(), 1600);
    } else {
      this.#commit(filtered);
    }
    this.#schedule();
  }

  /** Move the active cell (and selection) to an address. */
  select(addr: string, extend = false): void {
    const pos = parseAddress(addr);
    if (pos && this.#inBounds(addr)) this.#moveTo(pos, extend);
  }

  #inBounds(addr: string): boolean {
    const p = parseAddress(addr);
    return !!p && p.row < this.#config.rows && p.col < this.#config.cols;
  }

  /** A local edit: record it for undo, apply it, and tell listeners. */
  #commit(changes: Record<string, string>, record = true): void {
    const entry: Record<string, [string, string]> = {};
    for (const [addr, raw] of Object.entries(changes)) {
      const before = this.#model.getRaw(addr);
      if (before !== raw) entry[addr] = [before, raw];
    }
    const effective = Object.fromEntries(Object.entries(entry).map(([a, [, raw]]) => [a, raw]));
    if (!Object.keys(effective).length) return;
    if (record) {
      this.#undo.push(entry);
      if (this.#undo.length > 200) this.#undo.shift();
      this.#redo = [];
    }
    this.#model.set(effective);
    this.emit('sheet:change', { changes: effective });
    this.#schedule();
  }

  undo(): boolean {
    const entry = this.#undo.pop();
    if (!entry || !Object.keys(entry).length) return !!entry && this.undo();
    this.#redo.push(entry);
    this.#commit(Object.fromEntries(Object.entries(entry).map(([a, [before]]) => [a, before])), false);
    announce('Undone');
    return true;
  }

  redo(): boolean {
    const entry = this.#redo.pop();
    if (!entry || !Object.keys(entry).length) return !!entry && this.redo();
    this.#undo.push(entry);
    this.#commit(Object.fromEntries(Object.entries(entry).map(([a, [, after]]) => [a, after])), false);
    announce('Redone');
    return true;
  }

  // ── DOM ──────────────────────────────────────────────────────────────────

  protected override onConnected(): void {
    this.#build();
    this.listen(window, 'resize', () => this.#schedule());
    this.#schedule();
  }

  protected override onDisconnected(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #build(): void {
    const cfg = this.#config;
    if (!this.#built) {
      this.#built = true;
      this.classList.add('ar-sheet');
      this.innerHTML = `
        <div class="ar-sheet__bar">
          <span class="ar-sheet__name" aria-live="polite"></span>
          <span class="ar-sheet__fx" aria-hidden="true">ƒx</span>
          <input class="ar-sheet__formula" type="text" spellcheck="false" autocomplete="off">
        </div>
        <div class="ar-sheet__scroll">
          <table class="ar-sheet__table" role="grid" tabindex="0">
            <thead><tr class="ar-sheet__head" role="row"></tr></thead>
            <tbody></tbody>
          </table>
        </div>`;
      this.#nameBox = this.querySelector('.ar-sheet__name')!;
      this.#formula = this.querySelector('.ar-sheet__formula')!;
      this.#scroller = this.querySelector('.ar-sheet__scroll')!;
      this.#grid = this.querySelector('.ar-sheet__table')!;
      this.#body = this.#grid.querySelector('tbody')!;
      this.#headRow = this.#grid.querySelector('.ar-sheet__head')!;
      this.#wire();
    }
    this.#grid.setAttribute('aria-label', cfg.label);
    this.#grid.setAttribute('aria-rowcount', String(cfg.rows + 1));
    this.#grid.setAttribute('aria-colcount', String(cfg.cols + 1));
    this.#formula.setAttribute('aria-label', 'Cell contents (formula bar)');
    const cols = Array.from({ length: cfg.cols }, (_, c) => {
      const name = colName(c);
      const w = cfg.widths?.[name] ?? 120;
      return `<th role="columnheader" scope="col" aria-colindex="${c + 2}" style="width:${w}px;min-width:${w}px" data-col="${c}">${name}</th>`;
    }).join('');
    this.#headRow.innerHTML = `<th class="ar-sheet__corner" role="columnheader" aria-colindex="1"><span class="ar-visually-hidden">Row</span></th>${cols}`;
  }

  #schedule(): void {
    if (this.#frame || !this.#built) return;
    const run = () => {
      this.#frame = 0;
      this.#render();
    };
    this.#frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (setTimeout(run, 0) as unknown as number);
  }

  /** Render now (normally batched to the next frame). */
  redraw(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#render();
  }

  #cellId(row: number, col: number): string {
    return `${this.#id}-${address(row, col)}`;
  }

  #range(): { r0: number; r1: number; c0: number; c1: number } {
    return {
      r0: Math.min(this.#active.row, this.#anchor.row),
      r1: Math.max(this.#active.row, this.#anchor.row),
      c0: Math.min(this.#active.col, this.#anchor.col),
      c1: Math.max(this.#active.col, this.#anchor.col),
    };
  }

  #display(addr: string): { text: string; kind: string; title?: string } {
    const v = this.#model.getValue(addr);
    if (v instanceof FormulaError) return { text: v.code, kind: 'error', title: ERROR_HELP[v.code] };
    if (typeof v === 'number') {
      const text = this.#config.formatNumber?.(v, addr) ?? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);
      return { text, kind: 'number' };
    }
    if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', kind: 'bool' };
    return { text: v, kind: 'text' };
  }

  #render(): void {
    const cfg = this.#config;
    const top = this.#scroller.scrollTop;
    const height = this.#scroller.clientHeight || 400;
    const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(cfg.rows - 1, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
    // The active row must stay in the DOM for aria-activedescendant.
    const rows: number[] = [];
    for (let r = first; r <= last; r++) rows.push(r);
    if (this.#active.row < first || this.#active.row > last) rows.push(this.#active.row);
    rows.sort((a, b) => a - b);
    const { r0, r1, c0, c1 } = this.#range();
    const now = Date.now();
    const frag = document.createDocumentFragment();
    let cursor = 0;
    const spacer = (rowsTall: number) => {
      if (rowsTall <= 0) return;
      const tr = document.createElement('tr');
      tr.className = 'ar-sheet__spacer';
      tr.setAttribute('aria-hidden', 'true');
      tr.style.height = `${rowsTall * ROW_HEIGHT}px`;
      frag.appendChild(tr);
    };
    for (const r of rows) {
      spacer(r - cursor);
      cursor = r + 1;
      const tr = document.createElement('tr');
      tr.setAttribute('role', 'row');
      tr.setAttribute('aria-rowindex', String(r + 2));
      const th = document.createElement('th');
      th.setAttribute('role', 'rowheader');
      th.setAttribute('aria-colindex', '1');
      th.className = 'ar-sheet__rowhead';
      th.textContent = String(r + 1);
      if (r >= r0 && r <= r1) th.classList.add('is-selected');
      tr.appendChild(th);
      for (let c = 0; c < cfg.cols; c++) {
        const addr = address(r, c);
        const td = document.createElement('td');
        td.id = this.#cellId(r, c);
        td.setAttribute('role', 'gridcell');
        td.setAttribute('aria-colindex', String(c + 2));
        td.dataset.addr = addr;
        const shown = this.#display(addr);
        td.textContent = shown.text;
        td.dataset.kind = shown.kind;
        if (shown.title) td.title = `${shown.text}: ${shown.title}`;
        const selected = r >= r0 && r <= r1 && c >= c0 && c <= c1;
        if (selected) td.setAttribute('aria-selected', 'true');
        if (r === this.#active.row && c === this.#active.col) td.classList.add('is-active');
        if (cfg.readOnly?.(addr)) td.setAttribute('aria-readonly', 'true');
        if (this.#model.getRaw(addr).startsWith('=')) td.classList.add('is-formula');
        const remote = this.#remote.get(addr);
        if (remote && remote.until > now) {
          td.classList.add('is-remote');
          if (remote.by) td.dataset.by = remote.by;
        } else if (remote) this.#remote.delete(addr);
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    spacer(cfg.rows - cursor);
    this.#body.replaceChildren(frag);
    for (const th of this.#headRow.querySelectorAll<HTMLElement>('[data-col]')) {
      const c = Number(th.dataset.col);
      th.classList.toggle('is-selected', c >= c0 && c <= c1);
    }
    this.#grid.setAttribute('aria-activedescendant', this.#cellId(this.#active.row, this.#active.col));
    this.#nameBox.textContent = this.selection;
    if (document.activeElement !== this.#formula) this.#formula.value = this.#model.getRaw(this.active);
    this.#editor?.reposition();
  }

  // ── Interaction ──────────────────────────────────────────────────────────

  #moveTo(pos: Pos, extend = false): void {
    const cfg = this.#config;
    const p = { row: Math.max(0, Math.min(cfg.rows - 1, pos.row)), col: Math.max(0, Math.min(cfg.cols - 1, pos.col)) };
    this.#active = p;
    if (!extend) this.#anchor = { ...p };
    this.#scrollIntoView(p);
    this.redraw();
    this.emit('sheet:select', { active: this.active, range: this.selection });
  }

  #scrollIntoView(p: Pos): void {
    const s = this.#scroller;
    const head = this.#headRow.offsetHeight || ROW_HEIGHT;
    const y = p.row * ROW_HEIGHT;
    if (y < s.scrollTop) s.scrollTop = y;
    else if (y + ROW_HEIGHT > s.scrollTop + s.clientHeight - head) s.scrollTop = y + ROW_HEIGHT - s.clientHeight + head;
    const th = this.#headRow.querySelector<HTMLElement>(`[data-col="${p.col}"]`);
    const corner = this.#headRow.querySelector<HTMLElement>('.ar-sheet__corner');
    if (th) {
      const left = th.offsetLeft - (corner?.offsetWidth ?? 0);
      if (left < s.scrollLeft) s.scrollLeft = left;
      else if (th.offsetLeft + th.offsetWidth > s.scrollLeft + s.clientWidth) s.scrollLeft = th.offsetLeft + th.offsetWidth - s.clientWidth;
    }
  }

  #edit(how: 'type' | 'key' | 'click', key?: string, caret?: number): void {
    if (this.#editor && !this.#editor.closed) return;
    const addr = this.active;
    if (this.#config.readOnly?.(addr)) {
      announce(`${addr} is read only`);
      return;
    }
    this.redraw();
    const cell = this.querySelector<HTMLElement>(`#${CSS.escape(this.#cellId(this.#active.row, this.#active.col))}`);
    if (!cell) return;
    this.#editor = openCellEditor({
      cell,
      host: this.#scroller,
      value: this.#model.getRaw(addr),
      label: addr,
      mode: how === 'type' ? 'enter' : 'edit',
      initialText: how === 'type' ? key : undefined,
      caret: caret ?? 'end',
      enterMoves: 'down',
      commit: value => this.#commit({ [addr]: value }),
      onClose: ({ move, reason }) => {
        this.#editor = null;
        if (reason === 'blur') {
          this.redraw();
          return;
        }
        this.#grid.focus();
        this.#step(move);
      },
    });
  }

  #step(move: CellMove, extend = false): void {
    const d = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1], none: [0, 0] }[move];
    this.#moveTo({ row: this.#active.row + d[0], col: this.#active.col + d[1] }, extend);
  }

  #clearSelection(): void {
    const { r0, r1, c0, c1 } = this.#range();
    const changes: Record<string, string> = {};
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const addr = address(r, c);
      if (!this.#config.readOnly?.(addr)) changes[addr] = '';
    }
    this.#commit(changes);
    announce(`Cleared ${this.selection}`);
  }

  /** Ctrl+D (down) / Ctrl+R (right): copy the first row or column of the selection across it, shifting formulas. */
  #fill(direction: 'down' | 'right'): void {
    const { r0, r1, c0, c1 } = this.#range();
    const changes: Record<string, string> = {};
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (direction === 'down' ? r === r0 : c === c0) continue;
        const source = direction === 'down' ? address(r0, c) : address(r, c0);
        const addr = address(r, c);
        if (this.#config.readOnly?.(addr)) continue;
        changes[addr] = shiftFormula(this.#model.getRaw(source), direction === 'down' ? r - r0 : 0, direction === 'right' ? c - c0 : 0);
      }
    }
    this.#commit(changes);
    announce(`Filled ${this.selection}`);
  }

  #copyData(): { text: string; json: string } {
    const { r0, r1, c0, c1 } = this.#range();
    const lines: string[] = [];
    const raws: string[][] = [];
    for (let r = r0; r <= r1; r++) {
      const shown: string[] = [];
      const raw: string[] = [];
      for (let c = c0; c <= c1; c++) {
        const addr = address(r, c);
        shown.push(this.#display(addr).text);
        raw.push(this.#model.getRaw(addr));
      }
      lines.push(shown.join('\t'));
      raws.push(raw);
    }
    return { text: lines.join('\n'), json: JSON.stringify({ origin: { row: r0, col: c0 }, raws }) };
  }

  #paste(data: DataTransfer): void {
    const { row, col } = this.#active;
    const changes: Record<string, string> = {};
    let raws: string[][];
    let origin: Pos | null = null;
    try {
      const json = JSON.parse(data.getData(CLIP_TYPE)) as { origin: Pos; raws: string[][] };
      raws = json.raws;
      origin = json.origin;
    } catch {
      raws = data.getData('text/plain').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'));
    }
    raws.forEach((line, i) => line.forEach((raw, j) => {
      const addr = address(row + i, col + j);
      if (!this.#inBounds(addr) || this.#config.readOnly?.(addr)) return;
      changes[addr] = origin ? shiftFormula(String(raw), row - origin.row, col - origin.col) : String(raw).trim();
    }));
    this.#commit(changes);
    this.#anchor = { row: Math.min(this.#config.rows - 1, row + raws.length - 1), col: Math.min(this.#config.cols - 1, col + Math.max(...raws.map(l => l.length)) - 1) };
    this.redraw();
    announce(`Pasted into ${this.selection}`);
  }

  #posOf(target: EventTarget | null): Pos | null {
    const td = (target as Element | null)?.closest?.<HTMLElement>('td[data-addr]');
    return td ? parseAddress(td.dataset.addr!) : null;
  }

  #wire(): void {
    const grid = this.#grid;
    this.listen(this.#scroller, 'scroll', () => this.#schedule(), { passive: true });

    this.listen(grid, 'keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.target !== grid) return;
      const mod = ke.ctrlKey || ke.metaKey;
      const page = Math.max(1, Math.floor((this.#scroller.clientHeight || 400) / ROW_HEIGHT) - 1);
      const { row, col } = this.#active;
      const cfg = this.#config;
      let handled = true;
      switch (ke.key) {
        case 'ArrowUp': this.#moveTo({ row: mod ? 0 : row - 1, col }, ke.shiftKey); break;
        case 'ArrowDown': this.#moveTo({ row: mod ? cfg.rows - 1 : row + 1, col }, ke.shiftKey); break;
        case 'ArrowLeft': this.#moveTo({ row, col: mod ? 0 : col - 1 }, ke.shiftKey); break;
        case 'ArrowRight': this.#moveTo({ row, col: mod ? cfg.cols - 1 : col + 1 }, ke.shiftKey); break;
        case 'PageUp': this.#moveTo({ row: row - page, col }, ke.shiftKey); break;
        case 'PageDown': this.#moveTo({ row: row + page, col }, ke.shiftKey); break;
        case 'Home': this.#moveTo(mod ? { row: 0, col: 0 } : { row, col: 0 }, ke.shiftKey); break;
        case 'End': this.#moveTo(mod ? { row: cfg.rows - 1, col: cfg.cols - 1 } : { row, col: cfg.cols - 1 }, ke.shiftKey); break;
        case 'Tab': this.#step(ke.shiftKey ? 'left' : 'right'); break;
        case 'Enter': if (ke.shiftKey) this.#step('up'); else this.#edit('key'); break;
        case 'F2': this.#edit('key'); break;
        case 'Delete':
        case 'Backspace': this.#clearSelection(); break;
        case 'Escape': this.#anchor = { ...this.#active }; this.redraw(); break;
        default:
          if (mod && !ke.altKey && ke.key.toLowerCase() === 'z') {
            if (ke.shiftKey) this.redo();
            else this.undo();
          } else if (mod && !ke.altKey && ke.key.toLowerCase() === 'y') this.redo();
          else if (mod && !ke.altKey && ke.key.toLowerCase() === 'd') this.#fill('down');
          else if (mod && !ke.altKey && ke.key.toLowerCase() === 'r') this.#fill('right');
          else if (mod && !ke.altKey && ke.key.toLowerCase() === 'a') {
            this.#anchor = { row: 0, col: 0 };
            this.#moveTo({ row: cfg.rows - 1, col: cfg.cols - 1 }, true);
          } else if (ke.key.length === 1 && !mod && !ke.altKey) this.#edit('type', ke.key);
          else handled = false;
      }
      if (handled) ke.preventDefault();
    });

    // Clipboard: tab-separated values out and in; formulas shift when pasted within sheets.
    this.listen(grid, 'copy', (e: Event) => {
      const ce = e as ClipboardEvent;
      if (!ce.clipboardData || ce.target !== grid) return;
      const { text, json } = this.#copyData();
      ce.clipboardData.setData('text/plain', text);
      ce.clipboardData.setData(CLIP_TYPE, json);
      ce.preventDefault();
      announce(`Copied ${this.selection}`);
    });
    this.listen(grid, 'cut', (e: Event) => {
      const ce = e as ClipboardEvent;
      if (!ce.clipboardData || ce.target !== grid) return;
      const { text, json } = this.#copyData();
      ce.clipboardData.setData('text/plain', text);
      ce.clipboardData.setData(CLIP_TYPE, json);
      ce.preventDefault();
      this.#clearSelection();
    });
    this.listen(grid, 'paste', (e: Event) => {
      const ce = e as ClipboardEvent;
      if (!ce.clipboardData || ce.target !== grid) return;
      ce.preventDefault();
      this.#paste(ce.clipboardData);
    });

    // Mouse: press to select, drag to extend, a click without dragging edits.
    this.listen(grid, 'pointerdown', (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.button !== 0) return;
      const pos = this.#posOf(pe.target);
      if (!pos) return;
      pe.preventDefault();
      grid.focus();
      this.#moveTo(pos, pe.shiftKey);
      this.#drag = { start: pos, moved: pe.shiftKey, pointerId: pe.pointerId };
      grid.setPointerCapture?.(pe.pointerId);
    });
    this.listen(grid, 'pointermove', (e: Event) => {
      const pe = e as PointerEvent;
      if (!this.#drag || pe.pointerId !== this.#drag.pointerId) return;
      const hit = document.elementFromPoint?.(pe.clientX, pe.clientY);
      const pos = this.#posOf(hit ?? pe.target);
      if (!pos || (pos.row === this.#active.row && pos.col === this.#active.col)) return;
      this.#drag.moved = true;
      this.#active = pos;
      this.#scrollIntoView(pos);
      this.redraw();
    });
    this.listen(grid, 'pointerup', (e: Event) => {
      const pe = e as PointerEvent;
      const drag = this.#drag;
      this.#drag = null;
      grid.releasePointerCapture?.(pe.pointerId);
      if (!drag) return;
      if (drag.moved) {
        this.emit('sheet:select', { active: this.active, range: this.selection });
        announce(`Selected ${this.selection}`);
      } else this.#edit('click');
    });

    // The formula bar edits the active cell.
    this.listen(this.#formula, 'keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter') {
        ke.preventDefault();
        this.#commit({ [this.active]: this.#formula.value });
        grid.focus();
        this.#step('down');
      } else if (ke.key === 'Escape') {
        ke.preventDefault();
        this.#formula.value = this.#model.getRaw(this.active);
        grid.focus();
      }
    });
    this.listen(this.#formula, 'change', () => {
      if (this.#formula.value !== this.#model.getRaw(this.active)) this.#commit({ [this.active]: this.#formula.value });
    });
  }
}

/** Define `<a-sheet>` (idempotent). `import 'arethesis/components/sheet'` calls this. */
export function defineSheet(): void {
  defineComponent({ tag: 'a-sheet' })(Sheet);
}
