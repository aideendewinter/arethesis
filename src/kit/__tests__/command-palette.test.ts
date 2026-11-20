import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getArethesis } from '../../core/arethesis';
import '../index';
import { storeSource, type CommandPalette } from '../command-palette';
import { fuzzyFilter, fuzzyMatch } from '../../utils/fuzzy';
import { flush } from '../../../test/helpers';

describe('fuzzyMatch', () => {
  it('matches in order, ignoring case and accents, preferring word starts and runs', () => {
    expect(fuzzyMatch('kan', 'Kanban board')!.indices).toEqual([0, 1, 2]);
    expect(fuzzyMatch('cz', 'Collaborative editor')).toBeNull();
    expect(fuzzyMatch('ce', 'Collaborative editor')!.indices).toEqual([0, 14]);
    expect(fuzzyMatch('arete', 'Ἀρετή and aretē')!.indices).toEqual([10, 11, 12, 13, 14]);
    const ranked = fuzzyFilter('dash', ['Dark theme', 'Live dashboard', 'Show data table, sorted by hash'], s => s).map(r => r.item);
    expect(ranked[0]).toBe('Live dashboard');
    expect(ranked).not.toContain('Dark theme');
  });
});

describe('<a-command-palette>', () => {
  beforeEach(() => void getArethesis());

  async function mount(): Promise<CommandPalette> {
    const p = document.createElement('a-command-palette') as CommandPalette;
    document.body.appendChild(p);
    await p.ready;
    return p;
  }
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

  it('opens with Ctrl+K, filters, highlights, runs with Enter and remembers recents', async () => {
    const p = await mount();
    const ran = vi.fn();
    p.addSource({ id: 'pages', label: 'Pages', commands: () => ['Directory', 'Kanban board', 'Live dashboard'].map(t => ({ id: t, title: t, run: () => ran(t) })) });
    p.addSource({ id: 'actions', label: 'Actions', order: 1, commands: () => [{ id: 'dark', title: 'Use dark theme', keywords: ['night', 'selene'], run: () => ran('dark') }] });
    key(document.body, 'k', { ctrlKey: true });
    expect(p.isOpen).toBe(true);
    const input = p.querySelector<HTMLInputElement>('input[role=combobox]')!;
    await flush(2);
    expect(p.querySelectorAll('[role=option]')).toHaveLength(4);
    input.value = 'dash';
    input.dispatchEvent(new Event('input'));
    await flush(2);
    const options = p.querySelectorAll('[role=option]');
    expect(options).toHaveLength(1);
    expect(options[0].querySelector('mark')!.textContent).toBe('dash');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    key(input, 'Enter');
    await flush(2);
    expect(ran).toHaveBeenCalledWith('Live dashboard');
    expect(p.isOpen).toBe(false);

    // Keywords find commands; the last one run is listed first as Recent.
    p.open('selene');
    await flush(2);
    expect(p.querySelector('[role=option]')!.textContent).toContain('Use dark theme');
    key(input, 'Escape'); // clears the query
    expect(input.value).toBe('');
    await flush(2);
    expect(p.querySelector('.ar-palette__heading')!.textContent).toBe('Recent');
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(p.querySelectorAll('[role=option]')[1].id);
    key(input, 'Escape'); // closes
    expect(p.isOpen).toBe(false);
  });

  it('searches the store', async () => {
    const app = getArethesis();
    app.store.upsert('Person', 1, { id: 1, name: 'Hypatia of Alexandria' });
    app.store.upsert('Person', 2, { id: 2, name: 'Diotima of Mantinea' });
    const p = await mount();
    const opened = vi.fn();
    p.addSource(storeSource<{ name: string }>({ type: 'Person', label: 'People', title: d => d.name, run: (_, id) => opened(id) }));
    p.open('hyp');
    await flush(3);
    const options = p.querySelectorAll('[role=option]');
    expect(options).toHaveLength(1);
    expect(p.querySelector('.ar-palette__heading')!.textContent).toBe('People');
    (options[0] as HTMLElement).click();
    await flush(2);
    expect(opened).toHaveBeenCalledWith('1');
  });
});

describe('<a-command-palette> details', () => {
  beforeEach(() => void getArethesis());
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

  it('toggles with the hotkey (or not), wraps, pages, and handles async sources and empty results', async () => {
    const p = document.createElement('a-command-palette') as CommandPalette;
    document.body.appendChild(p);
    await p.ready;
    p.setAttribute('placeholder', 'Ask…');
    const input = p.querySelector<HTMLInputElement>('input')!;
    expect(input.placeholder).toBe('Ask…');
    const ran = vi.fn();
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, title: `Command ${i}`, subtitle: 'sub', shortcut: 'Ctrl+1', icon: '*', run: () => ran(i) }));
    const remove = p.addSource({ id: 'all', label: 'All', limit: 20, commands: () => items });
    p.addSource({ id: 'slow', label: 'Remote', search: async q => (q === 'zzz' ? [{ id: 'remote', title: 'zzz remote', run: () => ran('remote') }] : []) });
    key(document.body, 'k', { metaKey: true });
    expect(p.isOpen).toBe(true);
    await flush(2);
    expect(p.querySelectorAll('[role=option]')).toHaveLength(12);
    expect(p.querySelector('.ar-palette__shortcut')!.textContent).toBe('Ctrl+1');
    key(input, 'ArrowUp'); // wraps to the last
    expect(input.getAttribute('aria-activedescendant')).toBe(p.querySelectorAll('[role=option]')[11].id);
    key(input, 'ArrowDown'); // and back to the first
    key(input, 'PageDown');
    key(input, 'PageUp');
    expect(input.getAttribute('aria-activedescendant')).toBe(p.querySelectorAll('[role=option]')[0].id);
    p.querySelectorAll('[role=option]')[2].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(input.getAttribute('aria-activedescendant')).toBe(p.querySelectorAll('[role=option]')[2].id);
    key(input, 'Tab'); // not handled
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await flush(3);
    expect(p.querySelector('[role=option]')!.textContent).toContain('zzz remote');
    input.value = 'qqqq';
    input.dispatchEvent(new Event('input'));
    await flush(3);
    expect(p.querySelector('[role=listbox]')!.hasAttribute('data-empty')).toBe(true);
    expect(p.querySelector('.ar-palette__status')!.textContent).toBe('No results');
    key(input, 'Enter'); // nothing to run
    expect(ran).not.toHaveBeenCalled();
    key(document.body, 'k', { ctrlKey: true }); // toggles closed
    expect(p.isOpen).toBe(false);
    // The backdrop (the dialog itself) closes it.
    p.open();
    p.querySelector('dialog')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(p.isOpen).toBe(false);
    p.open();
    p.open(); // already open
    p.close();
    p.close(); // already closed
    remove();
    p.removeSource('slow');
    // With the hotkey turned off, Ctrl+K does nothing.
    p.setAttribute('hotkey', '');
    key(document.body, 'k', { ctrlKey: true });
    expect(p.isOpen).toBe(false);
    key(document.body, 'k', { ctrlKey: true, shiftKey: true });
    p.remove();
  });
});
