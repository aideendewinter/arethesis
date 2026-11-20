import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getArethesis } from '../../core/arethesis';
import '../index';
import type { MarkdownEditor } from '../markdown-editor';
import { TextOperation } from '../../realtime/ot/text-operation';
import type { OutlineEntry } from '../markdown/render';

const wait = (ms = 0) => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));

async function mount(value = '', layout = 'split'): Promise<{ ed: MarkdownEditor; ta: HTMLTextAreaElement }> {
  const ed = document.createElement('a-markdown-editor') as MarkdownEditor;
  ed.setAttribute('layout', layout);
  const ta = document.createElement('textarea');
  ta.value = value;
  ed.appendChild(ta);
  document.body.appendChild(ed);
  await ed.ready;
  return { ed, ta };
}

const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};
/** Type into the textarea like a user: change the value, then fire `input`. */
const type = (ta: HTMLTextAreaElement, value: string, caret = value.length) => {
  ta.value = value;
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
};
const select = (ta: HTMLTextAreaElement, from: number, to: number) => {
  ta.focus();
  ta.setSelectionRange(from, to);
};
const lines = (ed: MarkdownEditor) => Array.from(ed.querySelectorAll('.ar-md__line')).map(l => l.textContent);

describe('<a-markdown-editor>', () => {
  beforeEach(() => void getArethesis());

  it('wraps its textarea with a toolbar, highlight layer, gutter and preview', async () => {
    const { ed, ta } = await mount('# Title\n\nSome **bold** text');
    expect(ed.textarea).toBe(ta);
    expect(ta.classList.contains('ar-md__input')).toBe(true);
    expect(ed.querySelector('[role=toolbar]')!.getAttribute('aria-controls')).toBe(ta.id);
    expect(lines(ed)).toEqual(['# Title', '', 'Some **bold** text']);
    expect(ed.querySelector('.ar-md__line .md-h1')).not.toBeNull();
    expect(ed.querySelector('.md-strong')).not.toBeNull();
    // Only one toolbar button is in the tab order.
    expect(Array.from(ed.querySelectorAll<HTMLButtonElement>('[role=toolbar] button')).filter(b => b.tabIndex === 0)).toHaveLength(1);
    await wait(150);
    expect(ed.querySelector('.ar-md__preview h1')!.textContent).toBe('Title');
    await frame();
    expect(ed.querySelectorAll('.ar-md__gutter span')).toHaveLength(3);
  });

  it('complains without a textarea', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ed = document.createElement('a-markdown-editor') as MarkdownEditor;
    document.body.appendChild(ed);
    await ed.ready;
    expect(error).toHaveBeenCalledWith(expect.stringContaining('needs a <textarea>'));
    expect(ed.value).toBe('');
  });

  it('re-highlights only changed lines, and follows code fences as they open and close', async () => {
    const { ed, ta } = await mount('a\nb\nc\nd');
    const before = Array.from(ed.querySelectorAll('.ar-md__line'));
    type(ta, 'a\nB!\nc\nd');
    const after = Array.from(ed.querySelectorAll('.ar-md__line'));
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[1]).not.toBe(before[1]);
    // Opening a fence turns the following lines into code…
    type(ta, '```\nB!\nc\nd');
    expect(ed.querySelectorAll('.md-codeblock')).toHaveLength(3);
    // …and closing it turns them back.
    type(ta, '```\nB!\n```\nd');
    expect(ed.querySelectorAll('.md-codeblock')).toHaveLength(1);
    expect(lines(ed)).toEqual(['```', 'B!', '```', 'd']);
    // Removing lines.
    type(ta, 'd');
    expect(lines(ed)).toEqual(['d']);
  });

  it('emits the outline when headings change, and selection changes', async () => {
    const { ed, ta } = await mount('# One');
    const outlines: OutlineEntry[][] = [];
    ed.on<OutlineEntry[]>('markdown:outline', o => outlines.push(o));
    type(ta, '# One\n## Two');
    type(ta, '# One\n## Two\ntext'); // no heading change: no event
    expect(outlines).toHaveLength(1);
    expect(outlines[0].map(o => o.text)).toEqual(['One', 'Two']);
    expect(ed.outline).toHaveLength(2);
    const selections: Array<{ from: number; to: number }> = [];
    ed.on<{ from: number; to: number }>('markdown:selection', s => selections.push(s));
    select(ta, 2, 5);
    ta.dispatchEvent(new Event('select'));
    expect(selections.at(-1)).toEqual({ from: 2, to: 5 });
  });

  it('applies toolbar formatting and toggles it off again', async () => {
    const { ed, ta } = await mount('hello world');
    select(ta, 0, 5);
    ed.format('bold');
    expect(ta.value).toBe('**hello** world');
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([2, 7]);
    ed.format('bold');
    expect(ta.value).toBe('hello world');
    select(ta, 6, 11);
    ed.format('italic');
    expect(ta.value).toBe('hello _world_');
    select(ta, 0, 0);
    ed.format('strike');
    expect(ta.value).toBe('~~text~~hello _world_');
    select(ta, 0, 0);
    ed.format('code');
    expect(ta.value.startsWith('`code`')).toBe(true);
  });

  it('formats lines: headings cycle, quotes and lists toggle, links and code blocks wrap', async () => {
    const { ed, ta } = await mount('alpha\nbeta');
    select(ta, 0, 0);
    ed.format('heading');
    expect(ta.value).toBe('# alpha\nbeta');
    select(ta, 0, 0);
    ed.format('heading');
    expect(ta.value).toBe('## alpha\nbeta');
    select(ta, 0, 0);
    ed.format('heading');
    select(ta, 0, 0);
    ed.format('heading');
    expect(ta.value).toBe('alpha\nbeta');

    select(ta, 0, ta.value.length);
    ed.format('quote');
    expect(ta.value).toBe('> alpha\n> beta');
    select(ta, 0, ta.value.length);
    ed.format('quote');
    expect(ta.value).toBe('alpha\nbeta');

    select(ta, 0, ta.value.length);
    ed.format('numbered');
    expect(ta.value).toBe('1. alpha\n2. beta');
    select(ta, 0, ta.value.length);
    ed.format('bullet'); // switches list kind
    expect(ta.value).toBe('- alpha\n- beta');
    select(ta, 0, ta.value.length);
    ed.format('task');
    expect(ta.value).toBe('- [ ] alpha\n- [ ] beta');
    select(ta, 0, ta.value.length);
    ed.format('task');
    expect(ta.value).toBe('alpha\nbeta');

    select(ta, 0, 5);
    ed.format('link');
    expect(ta.value.startsWith('[alpha](https://)')).toBe(true);
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('https://');
    select(ta, ta.value.length, ta.value.length);
    ed.format('link');
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('link text');

    type(ta, 'x = 1');
    select(ta, 0, 0);
    ed.format('codeblock');
    expect(ta.value).toBe('```\nx = 1\n```');

    // Read-only textareas aren't changed.
    ta.readOnly = true;
    select(ta, 0, 0);
    ed.format('bold');
    expect(ta.value).toBe('```\nx = 1\n```');
  });

  it('runs toolbar buttons, moves through them with arrows, and switches layouts', async () => {
    const { ed, ta } = await mount('word', 'split');
    select(ta, 0, 4);
    ed.querySelector<HTMLButtonElement>('[data-command=bold]')!.click();
    expect(ta.value).toBe('**word**');
    const buttons = Array.from(ed.querySelectorAll<HTMLButtonElement>('[role=toolbar] button'));
    buttons[0].focus();
    key(buttons[0], 'ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    key(buttons[1], 'ArrowLeft');
    expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0], 'End');
    expect(document.activeElement).toBe(buttons.at(-1));
    key(buttons.at(-1)!, 'Home');
    expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0], 'x'); // other keys are ignored
    const layouts: string[] = [];
    ed.on<{ layout: string }>('markdown:layout', ({ layout }) => layouts.push(layout));
    ed.querySelector<HTMLButtonElement>('[data-layout=preview]')!.click();
    expect(ed.layout).toBe('preview');
    expect(ed.querySelector<HTMLElement>('.ar-md__source')!.hidden).toBe(true);
    expect(ed.querySelector('[data-layout=preview]')!.getAttribute('aria-pressed')).toBe('true');
    ed.layout = 'write';
    expect(ed.querySelector<HTMLElement>('.ar-md__preview')!.hidden).toBe(true);
    expect(layouts).toEqual(['preview', 'write']);
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    ed.querySelector('[data-command=italic]')!.dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true); // keeps the textarea's selection
  });

  it('undoes and redoes your own edits, with keys and the Edit menu, around remote ones', async () => {
    const { ed, ta } = await mount('Hello');
    type(ta, 'Hello world');
    expect(key(ta, 'z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(ta.value).toBe('Hello');
    key(ta, 'z', { ctrlKey: true, shiftKey: true });
    expect(ta.value).toBe('Hello world');

    // A remote insert at the start (as CollabSession's adapter reports it).
    const remote = new TextOperation().insert('Oh, ').retain(ta.value.length);
    ta.value = remote.apply(ta.value);
    ta.dispatchEvent(new CustomEvent('collab:apply', { detail: { op: remote, remote: true } }));
    expect(lines(ed)).toEqual(['Oh, Hello world']);
    ta.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', cancelable: true }));
    expect(ta.value).toBe('Oh, Hello');
    ta.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyRedo', cancelable: true }));
    expect(ta.value).toBe('Oh, Hello world');
    key(ta, 'y', { ctrlKey: true }); // nothing left to redo
    expect(ed.redo()).toBe(false);

    // A full reset (initial sync) clears the history.
    ta.value = 'fresh';
    ta.dispatchEvent(new CustomEvent('collab:apply', { detail: { op: null, remote: true } }));
    expect(ed.undo()).toBe(false);
    // Other beforeinput types pass through.
    const ins = new InputEvent('beforeinput', { inputType: 'insertText', cancelable: true });
    ta.dispatchEvent(ins);
    expect(ins.defaultPrevented).toBe(false);
  });

  it('continues lists and quotes on Enter, ends them on an empty item, and indents with Tab', async () => {
    const { ta } = await mount('- one');
    select(ta, 5, 5);
    expect(key(ta, 'Enter').defaultPrevented).toBe(true);
    expect(ta.value).toBe('- one\n- ');
    key(ta, 'Enter'); // empty item: end the list
    expect(ta.value).toBe('- one\n');

    type(ta, '1. first');
    key(ta, 'Enter');
    expect(ta.value).toBe('1. first\n2. ');
    type(ta, '- [x] done');
    key(ta, 'Enter');
    expect(ta.value).toBe('- [x] done\n- [ ] ');
    type(ta, '> quoted');
    key(ta, 'Enter');
    expect(ta.value).toBe('> quoted\n> ');
    type(ta, 'plain');
    expect(key(ta, 'Enter').defaultPrevented).toBe(false);
    select(ta, 0, 2);
    expect(key(ta, 'Enter').defaultPrevented).toBe(false); // a selection: normal Enter

    type(ta, '- item', 3);
    expect(key(ta, 'Tab').defaultPrevented).toBe(true);
    expect(ta.value).toBe('  - item');
    key(ta, 'Tab', { shiftKey: true });
    expect(ta.value).toBe('- item');
    type(ta, 'not a list');
    expect(key(ta, 'Tab').defaultPrevented).toBe(false);
    // Composition and handled keys are left alone.
    expect(key(ta, 'Enter', { isComposing: true } as KeyboardEventInit).defaultPrevented).toBe(false);
  });

  it('runs shortcuts for bold, italic, link and find', async () => {
    const { ed, ta } = await mount('abc');
    select(ta, 0, 3);
    key(ta, 'b', { ctrlKey: true });
    expect(ta.value).toBe('**abc**');
    select(ta, 2, 5);
    key(ta, 'i', { metaKey: true });
    expect(ta.value).toBe('**_abc_**');
    select(ta, 0, 0);
    key(ta, 'k', { ctrlKey: true });
    expect(ta.value).toContain('](https://)');
    key(ta, 'f', { ctrlKey: true });
    expect(ed.querySelector<HTMLElement>('.ar-md__find')!.hidden).toBe(false);
    expect(key(ta, 'q', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('finds, steps through, replaces one and replaces all as one undoable edit', async () => {
    const { ed, ta } = await mount('Virtue is virtue, and VIRTUE.');
    select(ta, 0, 6);
    ed.openFind();
    const find = ed.querySelector<HTMLInputElement>('[data-find-input]')!;
    const replace = ed.querySelector<HTMLInputElement>('[data-replace-input]')!;
    const status = ed.querySelector('.ar-md__find-status')!;
    expect(find.value).toBe('Virtue'); // the selection seeds the search
    expect(status.textContent).toBe('1 of 3');
    ed.querySelector<HTMLInputElement>('[data-case]')!.checked = true;
    ed.querySelector('[data-case]')!.dispatchEvent(new Event('change'));
    expect(status.textContent).toBe('1 of 1');
    ed.querySelector<HTMLInputElement>('[data-case]')!.checked = false;
    ed.querySelector('[data-case]')!.dispatchEvent(new Event('change'));
    key(find, 'Enter');
    expect(status.textContent).toBe('2 of 3');
    key(find, 'Enter', { shiftKey: true });
    expect(status.textContent).toBe('1 of 3');
    ed.querySelector<HTMLButtonElement>('[data-find-next]')!.click();
    ed.querySelector<HTMLButtonElement>('[data-find-prev]')!.click();
    expect(status.textContent).toBe('1 of 3');
    await frame();
    expect(ed.querySelectorAll('.ar-md__match')).toHaveLength(3);
    expect(ed.querySelectorAll('.ar-md__match.is-current')).toHaveLength(1);

    replace.value = 'Aretē';
    key(replace, 'Enter'); // replace the current match
    expect(ta.value).toBe('Aretē is virtue, and VIRTUE.');
    expect(status.textContent).toBe('1 of 2');
    ed.querySelector<HTMLButtonElement>('[data-replace]')!.click();
    expect(ta.value).toBe('Aretē is Aretē, and VIRTUE.');
    ed.querySelector<HTMLButtonElement>('[data-replace-all]')!.click();
    expect(ta.value).toBe('Aretē is Aretē, and Aretē.');
    expect(status.textContent).toBe('Replaced 1');
    ed.undo();
    expect(ta.value).toBe('Aretē is Aretē, and VIRTUE.');

    find.value = 'nothing here';
    find.dispatchEvent(new Event('input'));
    expect(status.textContent).toBe('No results');
    ed.findNext();
    ed.replaceCurrent();
    ed.replaceAll();
    find.value = '';
    find.dispatchEvent(new Event('input'));
    expect(status.textContent).toBe('');
    key(find, 'Escape');
    expect(ed.querySelector<HTMLElement>('.ar-md__find')!.hidden).toBe(true);
    ed.openFind();
    ed.querySelector<HTMLButtonElement>('[data-find-close]')!.click();
    expect(ed.querySelector<HTMLElement>('.ar-md__find')!.hidden).toBe(true);
    // Escape in the textarea also closes find.
    ed.openFind();
    key(ta, 'Escape');
    expect(ed.querySelector<HTMLElement>('.ar-md__find')!.hidden).toBe(true);
  });

  it('draws marks (comments) with safe colors only, and reveals offsets', async () => {
    const { ed, ta } = await mount('first line\nsecond line\nthird line');
    ed.annotations = [
      { id: 'a', from: 0, to: 5, color: '#a32c17', active: true },
      { id: 'b', from: 11, to: 17, color: 'red; background: url(x)' },
      { id: 'bad', from: 9, to: 2 },
    ];
    expect(ed.annotations).toHaveLength(2);
    await frame();
    const marks = ed.querySelectorAll<HTMLElement>('.ar-md__mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].classList.contains('is-active')).toBe(true);
    expect(marks[0].getAttribute('style')).toBe('--mark: #a32c17');
    expect(marks[1].hasAttribute('style')).toBe(false);
    expect(ed.querySelector('.ar-md__marks')!.textContent).toBe(ta.value);
    ed.annotations = [];
    await frame();
    expect(ed.querySelector('.ar-md__marks')!.textContent).toBe('');
    ed.revealOffset(14);
    expect(ta.selectionStart).toBe(14);
    ed.revealOffset(3, false);
    expect(ta.selectionStart).toBe(14);
    ed.revealOffset(999);
    ed.refresh();
    expect(lines(ed)).toHaveLength(3);
  });

  it('keeps the preview in step in split view, and skips it in write view', async () => {
    const { ed, ta } = await mount('# A\n\ntext', 'write');
    type(ta, '# B');
    await wait(150);
    expect(ed.querySelector('.ar-md__preview')!.textContent).toBe('');
    ed.layout = 'split';
    await wait(150);
    expect(ed.querySelector('.ar-md__preview h1')!.textContent).toBe('B');
    ed.querySelector('.ar-md__source')!.dispatchEvent(new Event('scroll'));
    ed.remove();
  });
});
