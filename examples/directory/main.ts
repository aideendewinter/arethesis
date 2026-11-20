import { Component, defineComponent, type StoredObject } from 'arethesis';
import 'arethesis/components';
import type { DataTable } from 'arethesis/components';
import { startApp } from '../shared/boot';
import { bindNetworkControl } from '../shared/network';
import { storeSource } from 'arethesis/components';
import { addCommands, avatar, bindStatus, mountShell, toast } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'directory',
  title: 'Team directory',
  description: 'Ten thousand people, loaded a page at a time. Sort, search, edit inline with validation, and watch edits from teammates stream in. Every edit is applied instantly and rolled back if the server refuses it.',
  features: ['<a-data-table>', 'cursor pagination', 'optimistic updates', 'SSE live updates', 'grid navigation', 'dropdown'],
  source,
});

// A detail card: a Light DOM component bound to whichever person is selected.
@defineComponent({
  tag: 'person-card',
  html: `
    <template id="main">
      <div class="person">
        <span class="avatar" aria-hidden="true"></span>
        <div>
          <h2 data-bind="name"></h2>
          <a data-bind="email"></a>
        </div>
      </div>
      <dl class="facts">
        <dt>Role</dt><dd data-bind="role"></dd>
        <dt>Department</dt><dd data-bind="department"></dd>
        <dt>City</dt><dd data-bind="city"></dd>
        <dt>Salary</dt><dd data-bind="salary"></dd>
        <dt>Started</dt><dd data-bind="startDate"></dd>
        <dt>Last change</dt><dd data-bind="updatedAt"></dd>
      </dl>
    </template>
    <template id="empty"><p class="hint">Select someone to see their details.</p></template>`,
})
class PersonCard extends Component {
  static override bindConfig = {
    fields: {
      name: {},
      email: { displayType: 'link' as const, href: (v: unknown) => `mailto:${v}` },
      role: { displayType: 'badge' as const },
      department: {},
      city: {},
      salary: { displayType: 'currency' as const },
      startDate: { displayType: 'date' as const, intl: { dateStyle: 'long' as const } },
      updatedAt: { displayType: 'relative' as const },
    },
  };

  protected override onConnected() {
    if (!this.source) void this.render('empty');
  }

  protected override onBind(obj: StoredObject) {
    const { initials, color } = avatar((obj.data as { name: string }).name);
    const el = this.querySelector<HTMLElement>('.avatar')!;
    el.textContent = initials;
    el.style.background = color;
  }
}

const { app, backend } = await startApp('directory', {
  types: [{ name: 'Person', versionField: 'updatedAt' }],
  endpoints: {
    listPeople: {
      url: '/people',
      type: 'Person',
      list: true,
      mapping: { dataPath: 'data' },
      pagination: { cursorPath: 'meta.next', totalCountPath: 'meta.total' },
    },
    updatePerson: { url: '/people/:id', method: 'PATCH', type: 'Person' },
  },
});

const table = document.querySelector<DataTable>('#people')!;
table.configure({
  caption: 'People',
  list: { type: 'Person', endpoint: 'listPeople', pageSize: 50, sort: [{ field: 'name', direction: 'asc' }] },
  columns: [
    { field: 'name', label: 'Name', sortable: true, width: '13rem', editable: { validation: { label: 'Name', rules: [{ type: 'required' }, { type: 'minLength', params: { min: 2 } }] } } },
    { field: 'department', label: 'Department', sortable: true, editable: { type: 'select', choices: ['Engineering', 'Design', 'Product', 'Research', 'Marketing', 'Sales', 'Support', 'Finance'] } },
    { field: 'role', label: 'Role', displayType: 'badge', sortable: true, width: '8rem' },
    { field: 'salary', label: 'Salary', displayType: 'currency', align: 'end', sortable: true, editable: { type: 'number', validation: { rules: [{ type: 'between', params: { min: 10000, max: 500000 } }] } }, bind: { intl: { maximumFractionDigits: 0 } } },
    { field: 'startDate', label: 'Started', displayType: 'date', sortable: true, width: '9rem' },
  ],
  save: { endpoint: 'updatePerson' },
});

const card = document.querySelector<PersonCard>('#card')!;
table.on<{ id: string }>('row-select', ({ id }) => card.bind({ type: 'Person', id }));

// The command palette (Ctrl/Cmd+K) searches everyone loaded into the store.
addCommands(storeSource<{ name: string; role: string; department: string }>({
  type: 'Person',
  label: 'People',
  icon: '☺',
  title: p => p.name,
  subtitle: p => `${p.role}, ${p.department}`,
  run: (p, id) => {
    card.bind({ type: 'Person', id });
    toast(`Showing ${p.name}`);
  },
}));

// Filters are sent to the server as query parameters.
let searchTimer: ReturnType<typeof setTimeout>;
const search = document.querySelector<HTMLInputElement>('#q')!;
const department = document.querySelector<HTMLSelectElement>('#department')!;
const applyFilters = () => table.setFilters({ q: search.value || undefined, department: department.value || undefined });
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilters, 250);
});
department.addEventListener('change', applyFilters);
app.mixins.apply(department, 'dropdown', { placeholder: 'All departments' });

// Feedback for optimistic saves.
app.optimistic.on('rollback', ({ error }) => toast(`Change rolled back: ${(error as Error).message}`, 'error'));
table.on('save', () => toast('Saved', 'success'));

// Demo controls.
document.querySelector<HTMLInputElement>('#teammates')!.addEventListener('change', e => backend.control({ teammates: (e.target as HTMLInputElement).checked }));
bindNetworkControl(document.querySelector<HTMLSelectElement>('#network')!, backend);
document.querySelector<HTMLInputElement>('#failures')!.addEventListener('change', e => backend.control({ failureRate: (e.target as HTMLInputElement).checked ? 0.5 : 0 }));
app.sse!.on('upsert', data => {
  const d = data as { by?: string; data: { name: string } };
  if (d.by === 'teammate') toast(`${d.data.name} was updated by a teammate`);
});
bindStatus(document.querySelector('#sse-status')!, 'Live', fn => app.sse!.onStatusChange(fn), app.sse!.status);
