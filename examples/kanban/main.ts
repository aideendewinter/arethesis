import { Component, defineComponent, type StoredObject } from 'arethesis';
import { startApp } from '../shared/boot';
import { bindNetworkControl } from '../shared/network';
import { storeSource } from 'arethesis/components';
import { addCommands, avatar, bindStatus, mountShell, toast } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'kanban',
  title: 'Kanban board',
  description: 'Drag cards with a mouse, finger or keyboard. Moves show up instantly, are saved in the background, and roll back if the server says no. Open a second tab: every change syncs live over SSE.',
  features: ['sortable (pointer + keyboard)', 'context-menu', 'tooltip', 'optimistic updates', 'SSE', 'cross-tab sync'],
  source,
});

type Status = 'backlog' | 'doing' | 'review' | 'done';
type Task = { id: string; title: string; status: Status; order: number; label: string; assignee: string };

const COLUMNS: Array<[Status, string]> = [['backlog', 'Backlog'], ['doing', 'In progress'], ['review', 'In review'], ['done', 'Done']];

const { app, backend } = await startApp('kanban', {
  types: [{ name: 'Task', versionField: 'updatedAt' }],
  endpoints: {
    listTasks: { url: '/tasks', type: 'Task', list: true },
    createTask: { url: '/tasks', method: 'POST', type: 'Task' },
    updateTask: { url: '/tasks/:id', method: 'PATCH', type: 'Task' },
    deleteTask: { url: '/tasks/:id', method: 'DELETE' },
  },
});

const cardConfig = {
  fields: {
    title: {},
    label: { displayType: 'tag' as const },
    assignee: { selector: '.card__assignee', format: (v: unknown) => avatar(String(v)).initials },
  },
};

@defineComponent({
  tag: 'kanban-board',
  html: `<template id="main"><div class="board">${COLUMNS.map(([status, label]) => `
    <section class="column" aria-labelledby="col-${status}">
      <header class="column__header"><h2 id="col-${status}">${label}</h2><span class="column__count" data-count="${status}">0</span></header>
      <ul class="column__cards" data-status="${status}" aria-label="${label}"></ul>
      <input class="column__new input" data-new="${status}" placeholder="What needs doing?" aria-label="New card in ${label}" hidden>
      <button class="column__add" type="button" data-add="${status}">+ Add a card</button>
    </section>`).join('')}</div></template>`,
})
export class KanbanBoard extends Component {
  private cards = new Map<string, HTMLLIElement>();
  private scheduled = false;

  protected override onConnected() {
    for (const list of this.querySelectorAll<HTMLElement>('.column__cards')) {
      this.useMixin('sortable', { group: 'board' }, list);
      this.useMixin('context-menu', {
        target: 'li[data-id]',
        items: [
          ...COLUMNS.map(([status, label]) => ({ label: `Move to ${label}`, action: `move:${status}` })),
          { separator: true },
          { label: 'Delete', action: 'delete', danger: true, shortcut: 'Del' },
        ],
      }, list);
    }
    this.listen(this, 'sortable:end', e => this.onDrop((e as CustomEvent).detail));
    this.listen(this, 'context-menu:select', e => {
      const { action, target } = (e as CustomEvent<{ action: string; target: HTMLElement }>).detail;
      const id = target.dataset.id!;
      if (action === 'delete') void this.deleteTask(id);
      else void this.move(id, action.split(':')[1] as Status, Infinity);
    });
    this.delegate('keydown', 'li[data-id]', (e, el) => {
      if ((e as KeyboardEvent).key === 'Delete') void this.deleteTask((el as HTMLElement).dataset.id!);
    });
    this.delegate('click', '[data-add]', (_e, el) => this.add((el as HTMLElement).dataset.add as Status));
    this.delegate('keydown', 'input[data-new]', (e, el) => {
      const key = (e as KeyboardEvent).key;
      if (key === 'Enter') this.createFrom(el as HTMLInputElement);
      if (key === 'Escape') {
        (el as HTMLInputElement).value = '';
        (el as HTMLInputElement).hidden = true;
      }
    });
    this.delegate('focusout', 'input[data-new]', (_e, el) => {
      if (!(el as HTMLInputElement).hidden) this.createFrom(el as HTMLInputElement);
    });
    this.subscriptions.push(app.store.subscribeToType('Task', () => this.schedule()));
    // When a new card is confirmed, keep its element and just give it the server's id.
    this.subscriptions.push(app.optimistic.on('commit', e => {
      if (e.kind !== 'create' || !e.resultId || e.resultId === e.objectId) return;
      const li = this.cards.get(e.objectId);
      if (!li) return;
      this.cards.delete(e.objectId);
      if (this.cards.has(e.resultId)) {
        li.remove(); // the server's copy already arrived over SSE
      } else {
        this.cards.set(e.resultId, li);
        li.dataset.id = e.resultId;
      }
    }));
    this.schedule();
  }

  private subscriptions: Array<() => void> = [];
  protected override onDisconnected() {
    this.subscriptions.forEach(off => off());
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      // Don't move cards under the user's pointer mid-drag.
      if (this.querySelector('.is-sorting, [aria-grabbed=true]')) return setTimeout(() => this.schedule(), 200);
      this.renderCards();
    });
  }

  private renderCards() {
    const tasks = app.store.getByType<Task>('Task').map(o => o.data);
    const seen = new Set<string>();
    for (const [status] of COLUMNS) {
      const list = this.querySelector<HTMLElement>(`ul[data-status=${status}]`)!;
      const column = tasks.filter(t => t.status === status).sort((a, b) => a.order - b.order);
      this.querySelector(`[data-count=${status}]`)!.textContent = String(column.length);
      column.forEach((task, index) => {
        seen.add(task.id);
        const li = this.card(app.store.get<Task>('Task', task.id)!);
        if (list.children[index] !== li) list.insertBefore(li, list.children[index] ?? null);
      });
    }
    for (const [id, li] of this.cards) {
      if (!seen.has(id)) {
        li.remove();
        this.cards.delete(id);
      }
    }
  }

  private card(obj: StoredObject<Task>): HTMLLIElement {
    let li = this.cards.get(obj.id);
    if (!li) {
      li = document.createElement('li');
      li.className = 'kcard';
      li.dataset.id = obj.id;
      li.innerHTML = '<p class="kcard__title" data-bind="title"></p><div class="kcard__meta"><span data-bind="label"></span><span class="card__assignee avatar"></span></div>';
      this.cards.set(obj.id, li);
      app.binder.bind(li, obj.data, cardConfig);
      const who = li.querySelector<HTMLElement>('.card__assignee')!;
      this.useMixin('tooltip', { content: `Assigned to ${obj.data.assignee}` }, who);
    } else {
      app.binder.update(li, obj.data);
    }
    const who = li.querySelector<HTMLElement>('.card__assignee')!;
    who.style.background = avatar(obj.data.assignee).color;
    li.setAttribute('aria-label', `${obj.data.title}, ${obj.data.label}, assigned to ${obj.data.assignee}`);
    li.toggleAttribute('data-pending', app.optimistic.isPending('Task', obj.id));
    return li;
  }

  /** Order value that places a card between its new neighbours. */
  private orderAt(status: Status, index: number, movingId: string): number {
    const column = app.store.getByType<Task>('Task').map(o => o.data)
      .filter(t => t.status === status && t.id !== movingId).sort((a, b) => a.order - b.order);
    const i = Math.min(index, column.length);
    const before = column[i - 1]?.order ?? 0;
    const after = column[i]?.order ?? before + 2000;
    return (before + after) / 2;
  }

  private onDrop(detail: { id: string | null; to: HTMLElement; newIndex: number }) {
    if (detail.id) void this.move(detail.id, detail.to.dataset.status as Status, detail.newIndex);
  }

  private busy(id: string): boolean {
    if (!app.optimistic.isPending('Task', id)) return false;
    toast('Still saving that card, try again in a moment.');
    return true;
  }

  private async move(id: string, status: Status, index: number) {
    if (this.busy(id)) return this.schedule();
    const order = this.orderAt(status, index, id);
    try {
      await app.optimistic.update<Task>('Task', id, { status, order }, () =>
        app.request<Task>({ url: '/tasks/:id', method: 'PATCH', params: { id }, body: { status, order } }));
    } catch {
      toast('Couldn’t move the card. It’s back where it was.', 'error');
    }
  }

  private async deleteTask(id: string) {
    if (this.busy(id)) return;
    const title = app.store.getData<Task>('Task', id)?.title;
    try {
      await app.optimistic.delete('Task', id, () => app.request({ url: '/tasks/:id', method: 'DELETE', params: { id } }));
      toast(`Deleted “${title}”`);
    } catch {
      toast('Couldn’t delete the card.', 'error');
    }
  }

  /** Show the column's inline input; Enter creates the card, Escape cancels. */
  private add(status: Status) {
    const input = this.querySelector<HTMLInputElement>(`input[data-new=${status}]`)!;
    input.hidden = false;
    input.value = '';
    input.focus();
  }

  private createFrom(input: HTMLInputElement) {
    const status = input.dataset.new as Status;
    const title = input.value.trim();
    input.value = '';
    input.hidden = true;
    if (!title) return;
    const order = this.orderAt(status, Infinity, '');
    app.optimistic.create<Task>('Task', { title, status, order, label: 'feature', assignee: 'Alice' } as Task,
      () => app.request<Task>({ url: '/tasks', method: 'POST', body: { title, status, order } }))
      .catch(() => toast('Couldn’t add the card.', 'error'));
  }
}

await app.fetch('listTasks');

bindNetworkControl(document.querySelector<HTMLSelectElement>('#network')!, backend);
document.querySelector('#failures')!.addEventListener('change', e => backend.control({ failureRate: (e.target as HTMLInputElement).checked ? 0.6 : 0 }));
document.querySelector('#new-tab')!.addEventListener('click', () => window.open(location.href, '_blank'));
bindStatus(document.querySelector('#sse-status')!, 'Live', fn => app.sse!.onStatusChange(fn), app.sse!.status);
if (!backend.shared) toast('This browser has no SharedWorker, so cross-tab sync is off.', 'info');

// The command palette (Ctrl/Cmd+K) finds cards.
addCommands(storeSource<{ title: string; status: string; assignee: string }>({
  type: 'Task',
  label: 'Cards',
  icon: '▤',
  title: t => t.title,
  subtitle: t => `${t.status} · ${t.assignee}`,
  run: (_, id) => document.querySelector<HTMLElement>(`li[data-id="${CSS.escape(id)}"]`)?.focus(),
}));
