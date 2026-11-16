import { Component, defineComponent, HttpError } from 'arethesis';
import 'arethesis/components';
import { startApp } from '../shared/boot';
import { mountShell, toast } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'offline',
  title: 'Offline & caching',
  description: 'Sign in, load some data, then go offline and reload. Everything is restored from IndexedDB. Compare cache modes, watch the access token refresh itself, and see sign-out wipe the cache so the next person on this device sees nothing.',
  features: ['AuthManager', 'token refresh', 'IndexedDB', 'TTL', 'cache-first / SWR', 'logout wipes data'],
  source,
});

const { app, backend } = await startApp('offline', {
  auth: { loginUrl: '/auth/login', refreshUrl: '/auth/refresh', logoutUrl: '/auth/logout', refreshThreshold: 8 },
  types: [{ name: 'Person', ttl: 15_000 }, { name: 'Me', endpoint: 'me' }],
  endpoints: {
    me: { url: '/me', type: 'Me', mapping: { fields: { id: { path: 'id', transform: () => 'current' }, name: 'name', email: 'email', lastSeen: 'lastSeen' } } },
    listNotes: { url: '/notes', type: 'Note', list: true },
    getPerson: { url: '/people/:id', type: 'Person' },
  },
}, { live: false });
const auth = app.auth!;

@defineComponent({
  tag: 'me-card',
  html: `<template id="main"><p><strong data-bind="name"></strong><br><span class="hint" data-bind="email"></span></p><p class="hint">Server last saw you <span data-bind="lastSeen"></span>.</p></template>
    <template id="error"><p class="hint" data-error-message></p><button class="btn btn--ghost" data-retry>Retry</button></template>`,
})
export class MeCard extends Component {
  static override bindConfig = { fields: { name: {}, email: {}, lastSeen: { displayType: 'relative' as const } } };
}

// ── Session ────────────────────────────────────────────────
const loginForm = document.querySelector<HTMLFormElement>('#login')!;
const signedIn = document.querySelector<HTMLElement>('#signed-in')!;
let refreshes = 0;

const meCard = document.querySelector<Component>('me-card')!;
const notesHost = document.querySelector('#notes')!;
let shownAs: boolean | null = null;

/** Show the sign-in form or the session, whichever matches the stored tokens. */
function showSession() {
  // A saved refresh token counts: the access token is renewed on the next request.
  const authed = auth.isAuthenticated() || auth.getRefreshToken() !== null;
  if (authed === shownAs) return;
  shownAs = authed;
  loginForm.hidden = authed;
  signedIn.hidden = !authed;
  if (authed) {
    meCard.bind({ type: 'Me', id: 'current' });
    showNotes();
  } else {
    meCard.unbind();
    notesHost.innerHTML = '<p class="hint">Sign in to load notes. They’re cached in IndexedDB, so they still show up offline or after a reload.</p>';
  }
}

// Sign-in, sign-out, an expired session, or another tab: keep the page in step.
auth.on('change', () => showSession());

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(loginForm));
  const ttl = document.querySelector<HTMLSelectElement>('#ttl')!.value;
  const ok = await app.login({ ...data, ttl: Number(ttl) }).catch(() => null);
  document.querySelector('#login-error')!.textContent = ok ? '' : 'Couldn’t sign in. Check the password, or whether the network is offline.';
});

auth.on('refresh', () => {
  document.querySelector('#refreshes')!.textContent = String(++refreshes);
  toast('Access token refreshed automatically', 'success');
});
auth.on('expired', () => {
  toast('Your session expired. Please sign in again.', 'error');
  document.querySelector<HTMLInputElement>('#password')?.focus();
});

document.querySelector('#expire')!.addEventListener('click', () => {
  // Swap in an already-expired token: the next request refreshes it first.
  const [h, , s] = (auth.getAccessToken() ?? 'a.b.c').split('.');
  const payload = btoa(JSON.stringify({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 1 })).replace(/=+$/, '');
  auth.setTokens(`${h}.${payload}.${s}`);
  void document.querySelector<Component>('me-card')!.refetch();
});

document.querySelector('#logout')!.addEventListener('click', async () => {
  await app.logout();
  toast('Signed out. The store and IndexedDB are empty.');
});

setInterval(() => {
  const token = auth.getAccessToken();
  const seconds = token ? Math.round(auth.secondsUntilExpiry(token)) : null;
  document.querySelector('#expiry')!.textContent = seconds === null ? '–' : seconds > 0 ? `in ${seconds}s` : 'expired (will refresh on next request)';
}, 500);

// ── Notes: a declarative list, cached in IndexedDB ─────────
function showNotes() {
  if (notesHost.querySelector('a-list')) return;
  notesHost.innerHTML = `<a-list data-list="listNotes">
    <template data-item><li class="note"><strong data-bind="title"></strong><span class="hint" data-bind="body"></span></li></template>
    <template data-loading><li class="note"><div class="ar-skeleton"></div></li></template>
    <template data-error><li class="note hint">Offline, and nothing cached yet.</li></template>
  </a-list>`;
}

// ── Cache modes ────────────────────────────────────────────
const log = document.querySelector('#log')!;
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  button.addEventListener('click', async () => {
    const mode = button.dataset.mode as 'network' | 'cache-first' | 'swr';
    const started = performance.now();
    const li = document.createElement('li');
    try {
      const result = await app.http.fetchEndpoint('getPerson', { id: 1 }, { cache: mode });
      li.textContent = `${mode}: ${Math.round(performance.now() - started)} ms, ${result.fromCache ? 'served from the store' : 'from the network'}`;
    } catch (error) {
      li.textContent = `${mode}: failed (${error instanceof HttpError && error.isNetworkError ? 'offline' : (error as Error).message})`;
      li.className = 'is-error';
    }
    log.prepend(li);
  });
}

document.querySelector<HTMLInputElement>('#offline')!.addEventListener('change', e => {
  const offline = (e.target as HTMLInputElement).checked;
  backend.control({ offline });
  toast(offline ? 'Network is offline. Cached data still works.' : 'Back online.');
});
document.querySelector('#reload')!.addEventListener('click', () => location.reload());

// ── Store inspector ────────────────────────────────────────
const inspector = document.querySelector('#inspector')!;
setInterval(() => {
  const rows = app.store.getAll().filter(o => o.type !== 'ArLayout').map(o => {
    const tr = document.createElement('tr');
    const age = Math.round((Date.now() - o.lastUpdated) / 1000);
    for (const text of [`${o.type}:${o.id}`, String(o.version), o.status, [...o.sources].join(', '), `${age}s`]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    tr.dataset.status = o.status;
    return tr;
  });
  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="hint">The store is empty.</td>';
    rows.push(tr);
  }
  inspector.replaceChildren(...rows);
}, 1000);

showSession();
