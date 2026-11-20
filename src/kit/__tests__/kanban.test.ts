import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Arethesis, getArethesis } from '../../core/arethesis';
import '../elements/kanban';
import type { Kanban, KanbanConfig } from '../kanban';
import { flush, mockFetch } from '../../../test/helpers';

type Task = { id: string; title: string; status: string; order: number };

const tasks: Task[] = [
  { id: 'a', title: 'Write', status: 'todo', order: 2 },
  { id: 'b', title: 'Plan', status: 'todo', order: 1 },
  { id: 'c', title: 'Ship', status: 'done', order: 1 },
];

async function mount(extra: Partial<KanbanConfig<Task>> = {}) {
  const app = getArethesis();
  for (const t of tasks) app.store.upsert('Task', t.id, { ...t });
  const board = document.createElement('a-kanban') as Kanban;
  document.body.appendChild(board);
  board.configure<Task>({
    type: 'Task',
    groupBy: 'status',
    columns: [{ value: 'todo', label: 'To do' }, { value: 'done', label: 'Done', limit: 1 }],
    ...extra,
  });
  await flush();
  const titles = (column: string) => Array.from(board.querySelectorAll(`ul[data-column="${column}"] li`)).map(li => li.textContent);
  return { app, board, titles };
}

describe('<a-kanban>', () => {
  beforeEach(() => Arethesis.resetInstance());
  afterEach(() => Arethesis.resetInstance());

  it('draws columns from the store, sorted, with counts and limits', async () => {
    const { board, titles } = await mount();
    expect(Array.from(board.querySelectorAll('h2')).map(h => h.textContent)).toEqual(['To do', 'Done']);
    expect(titles('todo')).toEqual(['Plan', 'Write']);
    expect(titles('done')).toEqual(['Ship']);
    expect(board.querySelector('[data-count="done"]')!.textContent).toBe('1 / 1');
    expect(board.querySelector('section[data-column="done"]')!.hasAttribute('data-over-limit')).toBe(false);
    expect(board.querySelector('ul[data-column="todo"]')!.getAttribute('aria-label')).toBe('To do');
    expect(board.cardElement('a')!.getAttribute('aria-label')).toBe('Write');
  });

  it('moves a card optimistically and saves it', async () => {
    const save = vi.fn(async () => undefined);
    const { app, board, titles } = await mount({ save });
    const moved = vi.fn();
    board.addEventListener('kanban:moved', moved);
    const done = board.move('a', 'done', 0);
    await flush();
    expect(titles('done')).toEqual(['Write', 'Ship']);
    expect(await done).toBe(true);
    expect(save).toHaveBeenCalledWith('a', { status: 'done', order: -999 });
    expect(app.store.getData<Task>('Task', 'a')!.status).toBe('done');
    expect(board.querySelector('section[data-column="done"]')!.hasAttribute('data-over-limit')).toBe(true);
    expect(moved).toHaveBeenCalled();
  });

  it('puts the card back when the server refuses', async () => {
    const { app, board, titles } = await mount({ save: async () => { throw new Error('nope'); } });
    const failed = vi.fn();
    board.addEventListener('kanban:move-error', failed);
    expect(await board.move('b', 'done', Infinity)).toBe(false);
    await flush();
    expect(app.store.getData<Task>('Task', 'b')).toMatchObject({ status: 'todo', order: 1 });
    expect(titles('todo')).toEqual(['Plan', 'Write']);
    expect(failed).toHaveBeenCalled();
  });

  it('lets kanban:move cancel a move, and ignores unknown cards and columns', async () => {
    const { board, titles } = await mount();
    board.addEventListener('kanban:move', e => e.preventDefault());
    expect(await board.move('a', 'done', 0)).toBe(false);
    expect(await board.move('zzz', 'done', 0)).toBe(false);
    expect(await board.move('a', 'nowhere', 0)).toBe(false);
    await flush();
    expect(titles('todo')).toEqual(['Plan', 'Write']);
  });

  it('places cards between their neighbours', async () => {
    const { board } = await mount();
    expect(board.orderAt('todo', 0)).toBe(-999); // before 1
    expect(board.orderAt('todo', 1)).toBe(1.5);
    expect(board.orderAt('todo', 9)).toBe(1002);
    expect(board.orderAt('empty', 0)).toBe(1000);
  });

  it('moves on drop and from the menu', async () => {
    const save = vi.fn(async () => undefined);
    const { board, titles } = await mount({ save });
    const card = board.cardElement('c')!;
    const todo = board.querySelector<HTMLElement>('ul[data-column="todo"]')!;
    card.dispatchEvent(new CustomEvent('sortable:end', { bubbles: true, detail: { id: 'c', to: todo, newIndex: 0 } }));
    await flush();
    expect(titles('todo')[0]).toBe('Ship');
    board.cardElement('a')!.dispatchEvent(new CustomEvent('context-menu:select', { bubbles: true, detail: { action: 'kanban:move:done', target: board.cardElement('a') } }));
    await flush();
    expect(titles('done')).toEqual(['Write']);
    const action = vi.fn();
    board.addEventListener('kanban:action', action);
    board.dispatchEvent(new CustomEvent('context-menu:select', { detail: { action: 'archive', target: board.cardElement('a') } }));
    expect(action.mock.calls[0][0].detail).toEqual({ id: 'a', action: 'archive' });
  });

  it('adds cards inline and deletes them', async () => {
    let next = 1;
    const create = vi.fn(async (data: Partial<Task>) => ({ ...data, id: `new${next++}` }) as Task);
    const remove = vi.fn(async () => undefined);
    const { app, board, titles } = await mount({ create, remove, defaults: { title: '' } });
    (board.querySelector('[data-add="done"]') as HTMLButtonElement).click();
    const input = board.querySelector<HTMLInputElement>('input[data-new="done"]')!;
    expect(input.hidden).toBe(false);
    input.value = 'Celebrate';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(4);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Celebrate', status: 'done', order: 1001 }));
    expect(titles('done')).toEqual(['Ship', 'Celebrate']);
    expect(app.store.getData('Task', 'new1')).toBeDefined();

    board.cardElement('new1')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await flush(4);
    expect(remove).toHaveBeenCalledWith('new1');
    expect(titles('done')).toEqual(['Ship']);
  });

  it('saves through a registered endpoint', async () => {
    const app = getArethesis();
    const fetch = mockFetch(() => ({ body: {} }));
    app.http.configure({ baseUrl: '/api', fetch, retry: false });
    app.defineEndpoint('updateTask', { url: '/tasks/:id', method: 'PATCH' });
    const { board } = await mount({ save: { endpoint: 'updateTask' } });
    await board.move('a', 'done', 0);
    const { url, init } = fetch.calls[0];
    expect(url).toContain('/api/tasks/a');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'done', order: -999 });
  });

  it('follows changes made elsewhere', async () => {
    const { app, titles } = await mount();
    app.store.upsert('Task', 'b', { ...tasks[1], status: 'done', order: 5 });
    await flush();
    expect(titles('done')).toEqual(['Ship', 'Plan']);
    app.store.delete('Task', 'c');
    await flush();
    expect(titles('done')).toEqual(['Plan']);
  });
});
