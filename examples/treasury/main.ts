import type { Chart, Sheet } from 'arethesis/components';
import 'arethesis/components';
import { connectMockBackend } from '../mock/client';
import { startApp } from '../shared/boot';
import { bindNetworkControl } from '../shared/network';
import { bindStatus, mountShell, toast } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'treasury',
  title: 'The Treasury of Athens',
  description: 'A shared ledger of the Delian League’s tribute, in a spreadsheet built from the framework: formulas with a dependency graph, range selection, fill, copy and paste, and per-user undo. Every cell is an object in the store; edits are applied instantly and arrive in other windows over SSE.',
  features: ['<a-sheet>', 'formulas', 'dependency graph', 'clipboard', 'SSE', '<a-chart>'],
  source,
});

const backend = connectMockBackend();
const { app } = await startApp('treasury', {
  types: [{ name: 'Cell', persist: false }],
  persistence: false,
});

const names = ['Pheidias', 'Aspasia', 'Thucydides', 'Kallias', 'Elpinike', 'Ictinus'];
const nameInput = document.querySelector<HTMLInputElement>('#name')!;
nameInput.value = sessionStorage.getItem('treasury-name') ?? names[Math.floor(Math.random() * names.length)];
nameInput.addEventListener('change', () => sessionStorage.setItem('treasury-name', nameInput.value));
/** Tags our own edits, so their echo over SSE is ignored. */
const client = Math.random().toString(36).slice(2);

const sheet = document.querySelector<Sheet>('#sheet')!;
const chart = document.querySelector<Chart>('#tribute')!;
await sheet.ready;
const { cells } = await app.http.request<{ cells: Record<string, string> }>({ url: '/sheets/treasury' });
sheet.configure({
  rows: 60,
  cols: 10,
  cells,
  label: 'Treasury ledger',
  widths: { A: 130, B: 120, C: 140, D: 130, E: 80, F: 130 },
  // Headings and the formula labels are read-only.
  readOnly: addr => /^[A-F]1$/.test(addr),
  formatNumber: (v, addr) => {
    const col = addr[0];
    if (col === 'D') return `${new Intl.NumberFormat().format(Math.round(v))} dr.`;
    if (col === 'F') return `${v}%`;
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);
  },
});

// Every cell is a `Cell` object in the store (id "treasury!C4").
for (const [addr, raw] of Object.entries(cells)) app.store.upsert('Cell', `treasury!${addr}`, { id: `treasury!${addr}`, raw }, { source: 'server' });

// Local edits: into the store at once, then to the server in one request; rolled back if it fails.
sheet.on<{ changes: Record<string, string> }>('sheet:change', async ({ changes }) => {
  const before: Record<string, string> = {};
  for (const [addr, raw] of Object.entries(changes)) {
    before[addr] = app.store.getData<{ raw: string }>('Cell', `treasury!${addr}`)?.raw ?? '';
    app.store.upsert('Cell', `treasury!${addr}`, { id: `treasury!${addr}`, raw }, { source: 'local' });
  }
  try {
    await app.http.request({ url: '/sheets/treasury', method: 'PATCH', body: { changes, by: nameInput.value || 'Someone', client } });
  } catch {
    sheet.setCells(before, { remote: true, by: 'rolled back' });
    toast('The server refused that edit; it was rolled back.', 'error');
  }
});

// Edits from elsewhere arrive as SSE upserts of Cell objects.
app.store.subscribeToType<{ raw: string; by?: string; client?: string }>('Cell', obj => {
  const data = obj?.data;
  if (!obj || !data || data.client === client || !String(obj.id).startsWith('treasury!')) return;
  sheet.setCells({ [String(obj.id).slice('treasury!'.length)]: data.raw }, { remote: true, by: data.by });
});

// The chart reads the sheet's computed values, so it follows every edit, formula or not.
const drawChart = () => {
  const rows: Array<{ x: string; tribute: number }> = [];
  for (let r = 2; r <= 13; r++) {
    const polis = sheet.getValue(`A${r}`);
    const tribute = sheet.getValue(`C${r}`);
    if (typeof polis === 'string' && polis && typeof tribute === 'number') rows.push({ x: polis, tribute });
  }
  rows.sort((a, b) => b.tribute - a.tribute);
  if (!chart.config) {
    chart.configure({ type: 'bar', label: 'Tribute by polis, in talents', series: [{ key: 'tribute', label: 'Talents' }], x: { type: 'category' }, data: rows, height: 260 });
  } else chart.setData(rows);
};
drawChart();
let pending = 0;
const redrawSoon = () => {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(drawChart);
};
sheet.on('sheet:change', redrawSoon);
app.store.subscribeToType('Cell', redrawSoon);

bindNetworkControl(document.querySelector<HTMLSelectElement>('#network')!, backend);
bindStatus(document.querySelector('#sse-status')!, 'Live', fn => app.sse!.onStatusChange(fn), app.sse!.status);
document.querySelector<HTMLInputElement>('#auditor')!.addEventListener('change', e => {
  const on = (e.target as HTMLInputElement).checked;
  backend.control({ auditor: on });
  toast(on ? 'Pericles is checking the accounts.' : 'Pericles has gone to the assembly.');
});
document.querySelector('#new-window')!.addEventListener('click', () => window.open(location.href, '_blank', 'width=1200,height=800'));
