import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getArethesis } from '../../core/arethesis';
import '../index';
import type { Sheet } from '../sheet/sheet';
import { FormulaError } from '../sheet/formula';
import { flush } from '../../../test/helpers';

async function mount(cells: Record<string, string> = {}): Promise<Sheet> {
  const sheet = document.createElement('a-sheet') as Sheet;
  document.body.appendChild(sheet);
  await sheet.ready;
  sheet.configure({ rows: 50, cols: 6, cells, label: 'Ledger', readOnly: a => a === 'A1' });
  sheet.redraw();
  return sheet;
}

const grid = (s: Sheet) => s.querySelector<HTMLElement>('[role=grid]')!;
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const cell = (s: Sheet, addr: string) => s.querySelector<HTMLElement>(`td[data-addr="${addr}"]`)!;
const editor = (s: Sheet) => s.querySelector<HTMLInputElement>('.ar-cell-editor input');

describe('<a-sheet>', () => {
  beforeEach(() => void getArethesis());

  it('renders values, formulas and errors, with a grid that tracks the active cell', async () => {
    const s = await mount({ A1: 'Polis', B2: '6', B3: '9', B4: '=SUM(B2:B3)', C2: '=1/0' });
    expect(cell(s, 'B4').textContent).toBe('15');
    expect(cell(s, 'B4').classList.contains('is-formula')).toBe(true);
    expect(cell(s, 'C2').textContent).toBe('#DIV/0!');
    expect(cell(s, 'C2').title).toContain('zero');
    const g = grid(s);
    expect(g.getAttribute('aria-label')).toBe('Ledger');
    expect(g.getAttribute('aria-activedescendant')).toBe(cell(s, 'A1').id);
    key(g, 'ArrowDown');
    key(g, 'ArrowRight');
    expect(s.active).toBe('B2');
    expect(g.getAttribute('aria-activedescendant')).toBe(cell(s, 'B2').id);
    expect(s.querySelector<HTMLInputElement>('.ar-sheet__formula')!.value).toBe('6');
    key(g, 'ArrowDown', { shiftKey: true });
    key(g, 'ArrowDown', { shiftKey: true });
    expect(s.selection).toBe('B2:B4');
    expect(s.querySelectorAll('td[aria-selected=true]')).toHaveLength(3);
  });

  it('edits by typing; Enter saves and moves down; dependents recalculate', async () => {
    const s = await mount({ B2: '6', B3: '9', B4: '=SUM(B2:B3)' });
    const changes = vi.fn();
    s.addEventListener('sheet:change', e => changes((e as CustomEvent).detail.changes));
    s.select('B2');
    s.redraw();
    const g = grid(s);
    expect(key(g, '1')).toBe(false); // the editor took the key
    const input = editor(s)!;
    expect(input.value).toBe('1');
    input.value = '10';
    key(input, 'Enter');
    await flush(3);
    expect(changes).toHaveBeenCalledWith({ B2: '10' });
    expect(s.active).toBe('B3');
    s.redraw();
    expect(cell(s, 'B4').textContent).toBe('19');
    // Read-only cells can't be edited.
    s.select('A1');
    key(g, 'Enter');
    expect(editor(s)).toBeNull();
  });

  it('clears, fills down with shifted formulas, and undoes', async () => {
    const s = await mount({ A2: '1', A3: '2', A4: '3', B2: '=A2*10' });
    const g = grid(s);
    s.select('B2');
    s.select('B4', true);
    key(g, 'd', { ctrlKey: true });
    expect(s.model.getRaw('B3')).toBe('=A3*10');
    expect(s.getValue('B4')).toBe(30);
    key(g, 'Delete');
    expect(s.getValue('B3')).toBe('');
    key(g, 'z', { ctrlKey: true });
    expect(s.getValue('B3')).toBe(20);
    key(g, 'z', { ctrlKey: true });
    expect(s.model.getRaw('B3')).toBe('');
    key(g, 'y', { ctrlKey: true });
    expect(s.model.getRaw('B3')).toBe('=A3*10');
  });

  it('copies and pastes ranges as tab-separated text, shifting formulas', async () => {
    const s = await mount({ A2: '4', B2: '=A2+1' });
    const g = grid(s);
    s.select('A2');
    s.select('B2', true);
    const store = new Map<string, string>();
    const clip = { setData: (t: string, v: string) => store.set(t, v), getData: (t: string) => store.get(t) ?? '' };
    const copy = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(copy, 'clipboardData', { value: clip });
    g.dispatchEvent(copy);
    expect(store.get('text/plain')).toBe('4\t5');
    s.select('A5');
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: clip });
    g.dispatchEvent(paste);
    expect(s.model.getRaw('B5')).toBe('=A5+1');
    expect(s.getValue('B5')).toBe(5);
    expect(s.selection).toBe('A5:B5');

    // Plain text from another app.
    store.clear();
    store.set('text/plain', 'Naxos\t6\r\nThasos\t30\r\n');
    s.select('D1');
    const paste2 = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste2, 'clipboardData', { value: clip });
    g.dispatchEvent(paste2);
    expect([s.getValue('D1'), s.getValue('E1'), s.getValue('D2'), s.getValue('E2')]).toEqual(['Naxos', 6, 'Thasos', 30]);
  });

  it('shows cycles as errors, and applies remote edits without undoing them', async () => {
    const s = await mount({ A2: '=B2', B2: '1' });
    s.setCells({ B2: '=A2' });
    expect((s.getValue('A2') as FormulaError).code).toBe('#CYCLE!');
    s.setCells({ C3: '7' });
    s.setCells({ C3: '8' }, { remote: true, by: 'Pericles' });
    s.redraw();
    expect(cell(s, 'C3').classList.contains('is-remote')).toBe(true);
    expect(cell(s, 'C3').dataset.by).toBe('Pericles');
    // Undoing our own change to C3 must not clobber Pericles' edit.
    s.undo();
    expect(s.getValue('C3')).toBe(8);
  });
});

describe('<a-sheet> keys, pointer and formula bar', () => {
  beforeEach(() => void getArethesis());

  it('moves with every navigation key and selects with Ctrl+A', async () => {
    const s = await mount({ B2: '1' });
    const g = grid(s);
    s.select('C10');
    key(g, 'Home');
    expect(s.active).toBe('A10');
    key(g, 'End');
    expect(s.active).toBe('F10');
    key(g, 'Home', { ctrlKey: true });
    expect(s.active).toBe('A1');
    key(g, 'End', { ctrlKey: true });
    expect(s.active).toBe('F50');
    key(g, 'ArrowUp', { metaKey: true });
    expect(s.active).toBe('F1');
    key(g, 'ArrowLeft', { ctrlKey: true });
    expect(s.active).toBe('A1');
    key(g, 'ArrowRight', { ctrlKey: true });
    expect(s.active).toBe('F1');
    key(g, 'ArrowDown', { ctrlKey: true });
    expect(s.active).toBe('F50');
    key(g, 'PageUp');
    expect(s.active).not.toBe('F50');
    key(g, 'PageDown');
    key(g, 'Tab', { shiftKey: true });
    expect(s.active).toBe('E50');
    key(g, 'Tab');
    expect(s.active).toBe('F50');
    key(g, 'Enter', { shiftKey: true });
    expect(s.active).toBe('F49');
    key(g, 'a', { ctrlKey: true });
    expect(s.selection).toBe('A1:F50');
    key(g, 'Escape');
    expect(s.selection).toBe('F50');
    expect(key(g, 'F12')).toBe(true); // unhandled keys pass through
    // Keys aimed at something else inside the sheet are ignored.
    const formula = s.querySelector<HTMLInputElement>('.ar-sheet__formula')!;
    expect(formula.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))).toBe(true);
    s.select('Z99'); // out of bounds: ignored
    expect(s.active).toBe('F50');
    s.setCells({ Z99: '1' }); // ignored
  });

  it('edits with F2 and Enter, cancels with Escape, and fills right', async () => {
    const s = await mount({ A2: '=1+1', B2: '' });
    const g = grid(s);
    s.select('A2');
    key(g, 'F2');
    const input = editor(s)!;
    expect(input.value).toBe('=1+1');
    key(input, 'Escape');
    expect(editor(s)).toBeNull();
    s.select('A2');
    s.select('C2', true);
    key(g, 'r', { ctrlKey: true });
    expect(s.model.getRaw('B2')).toBe('=1+1');
    key(g, 'Backspace');
    expect(s.getValue('A2')).toBe('');
    // Clearing and filling skip read-only cells.
    s.setCells({ A1: 'Head' });
    s.select('A1');
    key(g, 'Delete');
    expect(s.getValue('A1')).toBe('Head');
  });

  it('selects ranges by dragging and edits on a plain click', async () => {
    const s = await mount({ B2: '5' });
    const g = grid(s);
    const pointer = (type: string, addr: string, init: PointerEventInit = {}) =>
      cell(s, addr).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...init }));
    pointer('pointerdown', 'B2');
    pointer('pointermove', 'C4');
    pointer('pointerup', 'C4');
    expect(s.selection).toBe('B2:C4');
    expect(editor(s)).toBeNull();
    // Shift+click extends; a plain click edits.
    pointer('pointerdown', 'D5', { shiftKey: true });
    pointer('pointerup', 'D5');
    expect(s.selection).toBe('B2:D5');
    pointer('pointerdown', 'B2');
    pointer('pointerup', 'B2');
    expect(editor(s)!.value).toBe('5');
    editor(s)!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    pointer('pointerdown', 'B2', { button: 2 }); // right button: ignored
    g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
  });

  it('edits through the formula bar', async () => {
    const s = await mount({ C3: '2' });
    s.select('C3');
    s.redraw();
    const bar = s.querySelector<HTMLInputElement>('.ar-sheet__formula')!;
    expect(bar.value).toBe('2');
    bar.value = '=C3*2';
    bar.dispatchEvent(new Event('change'));
    expect((s.getValue('C3') as FormulaError).code).toBe('#CYCLE!');
    bar.value = '9';
    key(bar, 'Enter');
    expect(s.getValue('C3')).toBe(9);
    expect(s.active).toBe('C4');
    bar.value = 'nope';
    key(bar, 'Escape');
    expect(bar.value).toBe('');
    key(bar, 'x');
  });

  it('cuts ranges and formats numbers, booleans and errors', async () => {
    const s = document.createElement('a-sheet') as Sheet;
    document.body.appendChild(s);
    await s.ready;
    s.configure({ rows: 10, cols: 4, cells: { A1: '1234.5', B1: 'TRUE', C1: '=NOPE()' }, formatNumber: v => `#${v}`, widths: { A: 50 } });
    s.redraw();
    expect(cell(s, 'A1').textContent).toBe('#1234.5');
    expect(cell(s, 'B1').textContent).toBe('TRUE');
    expect(cell(s, 'C1').title).toContain('Unknown function');
    s.select('A1');
    s.select('B1', true);
    const store = new Map<string, string>();
    const cut = new Event('cut', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(cut, 'clipboardData', { value: { setData: (t: string, v: string) => store.set(t, v), getData: () => '' } });
    grid(s).dispatchEvent(cut);
    expect(store.get('text/plain')).toBe('#1234.5\tTRUE');
    expect(s.getValue('A1')).toBe('');
    // Clipboard events without data are ignored.
    grid(s).dispatchEvent(new Event('copy', { bubbles: true }));
    grid(s).dispatchEvent(new Event('paste', { bubbles: true }));
    expect(s.undo()).toBe(true);
    expect(s.getValue('A1')).toBe(1234.5);
    expect(s.redo()).toBe(true);
    s.undo();
    s.undo();
    expect(s.undo()).toBe(false);
  });
});
