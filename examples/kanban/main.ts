import { applyMixin } from 'arethesis';
import { startApp } from '../shared/boot';
import { bindNetworkControl } from '../shared/network';
import { confirm, storeSource, type Kanban } from 'arethesis/components';
import { addCommands, avatar, bindStatus, mountShell, toast } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'kanban',
  title: 'Kanban board',
  description: 'Drag cards with a mouse, finger or keyboard. Moves show up instantly, are saved in the background, and roll back if the server says no. Open a second tab: every change syncs live over SSE.',
  features: ['a-kanban', 'sortable (pointer + keyboard)', 'context-menu', 'tooltip', 'optimistic updates', 'SSE', 'cross-tab sync'],
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

const board = document.querySelector<Kanban>('#board')!;
board.configure<Task>({
  type: 'Task',
  groupBy: 'status',
  orderField: 'order',
  columns: COLUMNS.map(([value, label]) => ({ value, label, limit: value === 'doing' ? 5 : undefined })),
  card: {
    html: '<p class="kcard__title" data-bind="title"></p><div class="kcard__meta"><span data-bind="label"></span><span class="card__assignee avatar"></span></div>',
    fields: {
      title: {},
      label: { displayType: 'tag' },
      assignee: { selector: '.card__assignee', format: (v: unknown) => avatar(String(v)).initials },
    },
    label: t => `${t.title}, ${t.label}, assigned to ${t.assignee}`,
    // A colored avatar with a tooltip naming the assignee.
    render: (el, obj) => {
      el.classList.add('kcard');
      const who = el.querySelector<HTMLElement>('.card__assignee')!;
      who.style.background = avatar(obj.data.assignee).color;
      const tip = applyMixin(who, 'tooltip', { content: `Assigned to ${obj.data.assignee}` });
      (tip?.setContent as ((s: string) => void) | undefined)?.(`Assigned to ${obj.data.assignee}`);
    },
  },
  save: (id, changes) => app.request<Task>({ url: '/tasks/:id', method: 'PATCH', params: { id }, body: changes }),
  create: data => app.request<Task>({ url: '/tasks', method: 'POST', body: data }),
  defaults: { label: 'feature', assignee: 'Alice' },
  remove: id => app.request({ url: '/tasks/:id', method: 'DELETE', params: { id } }),
  beforeDelete: task => confirm({ title: 'Delete this card?', body: `“${task.title}” will be gone for everyone.`, confirmLabel: 'Delete', danger: true }),
});
board.addEventListener('kanban:move-error', () => toast('Couldn’t move the card. It’s back where it was.', 'error'));
board.addEventListener('kanban:delete', () => toast('Card deleted'));
board.addEventListener('kanban:error', e => {
  const { action } = (e as CustomEvent<{ action: string }>).detail;
  toast(action === 'create' ? 'Couldn’t add the card.' : action === 'delete' ? 'Couldn’t delete the card.' : 'Something went wrong.', 'error');
});

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
