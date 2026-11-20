import { CollabSession, WebSocketManager, type CollabUser, type RemoteCursor } from 'arethesis';
import { connectMockBackend } from '../mock/client';
import { startApp } from '../shared/boot';
import { bindNetworkControl } from '../shared/network';
import { avatar, mountShell, PIGMENTS, setStatusPill, toast } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'editor',
  title: 'Collaborative editor',
  description: 'Real-time co-editing with operational transformation. Every keystroke becomes an operation that is transformed against concurrent edits, so all copies converge, even across reconnects. Open a second window (or turn on the ghost writer) and type.',
  features: ['TextOperation (OT)', 'CollabSession', 'live cursors', 'presence', 'offline edits', 'WebSocket'],
  source,
});

const backend = connectMockBackend();
const { app } = await startApp('editor', {
  websocket: { url: 'wss://mock.local/collab', socketFactory: backend.webSocket, baseDelay: 500 },
  persistence: false,
});

const names = ['Alice', 'Bob', 'Carol', 'Dave', 'Earnest', 'Forrest', 'Garth', 'Heidi'];
const nameInput = document.querySelector<HTMLInputElement>('#name')!;
nameInput.value = sessionStorage.getItem('editor-name') ?? `${names[Math.floor(Math.random() * names.length)]} ${Math.floor(Math.random() * 90 + 10)}`;
const me = (): CollabUser => ({ name: nameInput.value || 'Guest', color: avatar(nameInput.value).color });

const textarea = document.querySelector<HTMLTextAreaElement>('#doc')!;
const session = app.collab.open('launch-plan', textarea, { user: me() });

// Presence list.
const people = document.querySelector('#people')!;
const renderPeople = (peers: RemoteCursor[]) => {
  people.replaceChildren(...[{ clientId: 'me', user: me() }, ...peers].map(p => {
    const li = document.createElement('li');
    const name = p.user?.name ?? 'Guest';
    const a = document.createElement('span');
    a.className = 'avatar';
    a.style.background = p.user?.color ?? avatar(name).color;
    a.textContent = avatar(name).initials;
    li.append(a, document.createTextNode(p.clientId === 'me' ? `${name} (you)` : name));
    return li;
  }));
};
session.on('presence', renderPeople);
renderPeople([]);

const status = document.querySelector<HTMLElement>('#collab-status')!;
// Try a slow network to watch edits queue up ("Saving…") and merge.
bindNetworkControl(document.querySelector<HTMLSelectElement>('#network')!, backend);

const labels = { connecting: 'Connecting…', synced: 'All changes saved', syncing: 'Saving…', offline: 'Offline: edits kept locally' };
// Typing saves almost every keystroke. Don't flash "Saving…" for saves that finish
// in a moment, and once it shows, keep it up long enough to read.
const SAVING_DELAY = 400;
const SAVING_MIN = 600;
let savingShownAt = 0;
let pendingStatus: ReturnType<typeof setTimeout> | undefined;
const display = (s: string) => {
  setStatusPill(status, s, labels);
  if (s === 'syncing') savingShownAt = Date.now();
};
const show = (s: string) => {
  document.querySelector('#sync')!.textContent = s;
  clearTimeout(pendingStatus);
  const current = status.dataset.status;
  if (s === 'syncing' && current === 'synced') {
    pendingStatus = setTimeout(() => display('syncing'), SAVING_DELAY);
    return;
  }
  const wait = SAVING_MIN - (Date.now() - savingShownAt);
  if (s === 'synced' && current === 'syncing' && wait > 0) {
    pendingStatus = setTimeout(() => display('synced'), wait);
    return;
  }
  display(s);
};
session.on('status', show);
show(session.status);

const words = document.querySelector('#words')!;
const revision = document.querySelector('#revision')!;
session.on('change', ({ content }) => {
  words.textContent = String(content.trim().split(/\s+/).filter(Boolean).length);
  revision.textContent = String(session.revision);
});

nameInput.addEventListener('change', () => {
  sessionStorage.setItem('editor-name', nameInput.value);
  location.reload();
});

// A second, invisible collaborator typing in this tab, to show concurrent editing.
let ghost: { session: CollabSession; timer: ReturnType<typeof setInterval> } | null = null;
const phrases = [' (reviewed)', ' ✓', ' — great point!', ' [needs a link]', ' TODO', ' 🎉'];
document.querySelector<HTMLInputElement>('#ghost')!.addEventListener('change', e => {
  if (!(e.target as HTMLInputElement).checked) {
    ghost?.session.close();
    clearInterval(ghost?.timer);
    ghost = null;
    return;
  }
  const ws = new WebSocketManager({ url: 'wss://mock.local/collab', socketFactory: backend.webSocket });
  const hidden = document.createElement('textarea');
  const ghostSession = new CollabSession(ws, 'launch-plan', hidden, { user: { name: 'Ghost writer', color: PIGMENTS[6] }, cursors: false });
  let queue = '';
  let at = 0;
  const timer = setInterval(() => {
    if (ghostSession.status === 'connecting') return;
    if (!queue) {
      const lines = hidden.value.split('\n');
      const line = Math.floor(Math.random() * lines.length);
      at = lines.slice(0, line + 1).join('\n').length;
      queue = phrases[Math.floor(Math.random() * phrases.length)];
    }
    hidden.value = hidden.value.slice(0, at) + queue[0] + hidden.value.slice(at);
    hidden.setSelectionRange(at + 1, at + 1);
    at++;
    queue = queue.slice(1);
    hidden.dispatchEvent(new Event('input'));
    hidden.dispatchEvent(new Event('keyup'));
  }, 140);
  ghost = { session: ghostSession, timer };
  toast('The ghost writer joined. Keep typing!');
});

document.querySelector<HTMLInputElement>('#offline')!.addEventListener('change', e => {
  const offline = (e.target as HTMLInputElement).checked;
  backend.control({ offline });
  toast(offline ? 'You are offline. Keep editing; changes will sync on reconnect.' : 'Back online, syncing…');
});
document.querySelector('#new-window')!.addEventListener('click', () => window.open(location.href, '_blank', 'width=900,height=700'));
if (!backend.shared) toast('This browser has no SharedWorker; use the ghost writer to see collaboration.', 'info');
