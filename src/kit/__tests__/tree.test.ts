import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Arethesis, getArethesis } from '../../core/arethesis';
import '../elements/tree';
import type { Tree, TreeConfig } from '../tree';
import { flush, mockFetch } from '../../../test/helpers';

type Folder = { id: number; name: string; parent: number | null; kids: number };

const folders: Folder[] = [
  { id: 1, name: 'Athens', parent: null, kids: 2 },
  { id: 2, name: 'Sparta', parent: null, kids: 0 },
  { id: 3, name: 'Agora', parent: 1, kids: 0 },
  { id: 4, name: 'Acropolis', parent: 1, kids: 1 },
  { id: 5, name: 'Parthenon', parent: 4, kids: 0 },
  ...Array.from({ length: 3 }, (_, i) => ({ id: 10 + i, name: `Colony ${i}`, parent: null, kids: 0 })),
];

const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

async function mount(extra: Partial<TreeConfig<Folder>> = {}, attrs = '') {
  const app = getArethesis();
  const fetch = mockFetch(url => {
    const parent = url.searchParams.get('parent');
    const all = folders.filter(f => String(f.parent) === (parent ?? 'null'));
    const cursor = Number(url.searchParams.get('cursor') ?? 0);
    const page = all.slice(cursor, cursor + 3);
    return { body: { items: page, next: cursor + 3 < all.length ? String(cursor + 3) : null, total: all.length } };
  });
  app.http.configure({ baseUrl: '/api', fetch, retry: false });
  app.defineEndpoint('listFolders', { url: '/folders', type: 'Folder', list: true, mapping: { dataPath: 'items' }, pagination: { cursorPath: 'next', totalCountPath: 'total' } });
  document.body.innerHTML = `<a-tree aria-label="Places" ${attrs}></a-tree>`;
  await flush();
  const tree = document.querySelector<Tree>('a-tree')!;
  tree.configure<Folder>({
    root: { type: 'Folder', endpoint: 'listFolders', filters: { parent: 'null' }, pageSize: 3 },
    children: f => (f.kids ? { type: 'Folder', endpoint: 'listFolders', filters: { parent: f.id }, pageSize: 3 } : null),
    label: 'name',
    ...extra,
  });
  await flush(8);
  const items = () => Array.from(tree.querySelectorAll<HTMLElement>('[role=treeitem]'));
  const labels = () => items().map(li => li.textContent);
  const item = (text: string) => items().find(li => li.textContent === text)!;
  return { app, tree, fetch, items, labels, item };
}

describe('<a-tree>', () => {
  beforeEach(() => void getArethesis());
  afterEach(() => Arethesis.resetInstance());

  it('renders the top level with tree semantics and a "Show more" item', async () => {
    const { tree, labels, item } = await mount();
    const list = tree.querySelector('[role=tree]')!;
    expect(list.getAttribute('aria-label')).toBe('Places');
    expect(labels()).toEqual(['Athens', 'Sparta', 'Colony 0', 'Show more']);
    const athens = item('Athens');
    expect(athens.getAttribute('aria-level')).toBe('1');
    expect(athens.getAttribute('aria-setsize')).toBe('5');
    expect(athens.getAttribute('aria-posinset')).toBe('1');
    expect(athens.getAttribute('aria-expanded')).toBe('false');
    expect(item('Sparta').hasAttribute('aria-expanded')).toBe(false);
    expect(athens.tabIndex).toBe(0);
    expect(item('Sparta').tabIndex).toBe(-1);
  });

  it('loads children when a node opens, and pages with "Show more"', async () => {
    const { tree, labels, item } = await mount();
    const toggled = vi.fn();
    tree.addEventListener('tree:toggle', toggled);
    tree.toggle('1');
    await flush(8);
    expect(labels()).toEqual(['Athens', 'Agora', 'Acropolis', 'Sparta', 'Colony 0', 'Show more']);
    expect(item('Agora').getAttribute('aria-level')).toBe('2');
    expect(item('Athens').getAttribute('aria-expanded')).toBe('true');
    expect(toggled.mock.calls[0][0].detail).toMatchObject({ key: '1', expanded: true });
    item('Show more').click();
    await flush(8);
    expect(labels().slice(-2)).toEqual(['Colony 1', 'Colony 2']);
    tree.toggle('1');
    expect(labels()).toEqual(['Athens', 'Sparta', 'Colony 0', 'Colony 1', 'Colony 2']);
  });

  it('follows the tree keyboard pattern', async () => {
    const { tree, item, labels } = await mount();
    const athens = item('Athens');
    athens.focus();
    key(athens, 'ArrowRight'); // open
    await flush(8);
    expect(tree.expandedKeys).toEqual(['1']);
    key(athens, 'ArrowRight'); // to the first child
    expect(document.activeElement).toBe(item('Agora'));
    key(item('Agora'), 'ArrowDown');
    expect(document.activeElement).toBe(item('Acropolis'));
    key(item('Acropolis'), 'ArrowRight');
    await flush(8);
    expect(labels()).toContain('Parthenon');
    key(item('Acropolis'), 'ArrowLeft'); // close
    expect(labels()).not.toContain('Parthenon');
    key(item('Acropolis'), 'ArrowLeft'); // to the parent
    expect(document.activeElement).toBe(athens);
    key(athens, 'End');
    expect(document.activeElement).toBe(item('Show more'));
    key(item('Show more'), 'Home');
    expect(document.activeElement).toBe(athens);
    key(athens, 's'); // type-ahead
    expect(document.activeElement).toBe(item('Sparta'));
    key(item('Sparta'), 'Home');
    key(athens, 'ArrowLeft'); // close Athens
    expect(labels()).not.toContain('Agora');
    key(athens, '*'); // open all siblings that have children
    await flush(8);
    expect(tree.expandedKeys).toContain('1');
    expect(item('Sparta').tabIndex).toBe(-1);
  });

  it('selects one or many, and submits the ids', async () => {
    const { tree, item } = await mount({ selection: 'multi' }, 'name="places"');
    const list = tree.querySelector('[role=tree]')!;
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    const selects = vi.fn();
    tree.addEventListener('tree:select', selects);
    const athens = item('Athens');
    athens.focus();
    key(athens, ' ');
    item('Sparta').focus();
    key(item('Sparta'), ' ');
    expect(tree.value).toEqual(['1', '2']);
    expect(athens.getAttribute('aria-selected')).toBe('true');
    key(item('Sparta'), ' ');
    expect(tree.value).toEqual(['1']);
    item('Sparta').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(tree.value).toEqual(['1', '2']);
    item('Sparta').click();
    expect(tree.value).toEqual(['2']);
    expect(selects).toHaveBeenCalled();
    const activated = vi.fn();
    tree.addEventListener('tree:activate', activated);
    key(item('Sparta'), 'Enter');
    expect(activated.mock.calls[0][0].detail).toMatchObject({ id: '2', key: '2' });
    item('Athens').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(tree.value).toEqual(['1']);
    tree.focus(); // the item last focused
    expect(document.activeElement).toBe(item('Sparta'));
  });

  it('opens nodes given in `expanded`, and clicking the arrow toggles', async () => {
    const { labels, item } = await mount({ expanded: ['1'], selection: 'single', render: (el, f) => el.setAttribute('data-kids', String(f.kids)) });
    await flush(8);
    expect(labels()).toContain('Acropolis');
    expect(item('Athens').getAttribute('data-kids')).toBe('2');
    (item('Athens').querySelector('.ar-tree__toggle') as HTMLElement).click();
    expect(labels()).not.toContain('Acropolis');
    item('Sparta').click();
    expect(item('Sparta').getAttribute('aria-selected')).toBe('true');
  });
});
