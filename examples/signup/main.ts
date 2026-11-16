import 'arethesis/components';
import type { Form } from 'arethesis/components';
import { startApp } from '../shared/boot';
import { mountShell, toast } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'signup',
  title: 'Signup form',
  description: 'Progressive enhancement of an ordinary form: native constraint attributes plus declarative rules, async availability checks, date rules, a sanitized rich-text bio and server-side errors mapped onto fields, all accessible from the keyboard and screen readers.',
  features: ['<a-form>', 'async validators', 'date-utils', 'rich-text', 'dropdown', 'error summary'],
  source,
});

await startApp('signup', {
  plugins: ['date-utils', 'rich-text', { plugin: 'async-validators', options: { debounce: 350 } }],
  endpoints: { createAccount: { url: '/accounts', method: 'POST', type: 'Account' } },
  persistence: false,
}, { live: false });

const form = document.querySelector<Form>('a-form')!;
const result = document.querySelector<HTMLElement>('#result')!;

form.on<{ data: Record<string, unknown> }>('submit-success', ({ data }) => {
  toast(`Welcome aboard, ${data.name}!`, 'success');
  result.hidden = false;
  result.innerHTML = '<h3>Account created</h3><p class="hint">The server received:</p><pre></pre>';
  result.querySelector('pre')!.textContent = JSON.stringify({ ...data, password: '••••••••', confirm: undefined }, null, 2);
});
form.on('submit-error', () => toast('The server rejected some fields. Check the highlighted inputs.', 'error'));
