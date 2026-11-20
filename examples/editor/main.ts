import { CollabSession, WebSocketManager, type CollabAnnotation, type CollabUser, type RemoteCursor } from 'arethesis';
import { MarkdownEditor, type OutlineEntry } from 'arethesis/components';
import { connectMockBackend } from '../mock/client';
import { startApp } from '../shared/boot';
import { bindNetworkControl } from '../shared/network';
import { avatar, mountShell, PIGMENTS, setStatusPill, toast } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'editor',
  title: 'Collaborative editor',
  description: 'A Markdown studio for many hands. Every keystroke is an operation, transformed against everyone else’s so all copies converge, even across reconnects. Undo reverts only your own edits, and comments stay pinned to their words. Open a second window, or invite Socrates.',
  features: ['<a-markdown-editor>', 'OT', 'per-user undo', 'anchored comments', 'live cursors', 'presence', 'offline edits'],
  source,
});

const backend = connectMockBackend();
const { app } = await startApp('editor', {
  websocket: { url: 'wss://mock.local/collab', socketFactory: backend.webSocket, baseDelay: 500 },
  persistence: false,
});

const names = ['Hypatia', 'Diotima', 'Hipparchia', 'Phaedrus', 'Agathon', 'Aspasia', 'Xenophon', 'Theano'];
const nameInput = document.querySelector<HTMLInputElement>('#name')!;
nameInput.value = sessionStorage.getItem('editor-name') ?? `${names[Math.floor(Math.random() * names.length)]} ${Math.floor(Math.random() * 90 + 10)}`;
const me = (): CollabUser => ({ name: nameInput.value || 'Guest', color: avatar(nameInput.value).color });

const editor = document.querySelector<MarkdownEditor>('#editor')!;
await editor.ready;
const textarea = document.querySelector<HTMLTextAreaElement>('#doc')!;
// The editor keeps its own per-user undo history, following remote edits through `collab:apply`.
const session = app.collab.open('symposium', textarea, { user: me() });

// ── Outline, and where everyone is ─────────────────────────────────────────

let outline: OutlineEntry[] = editor.outline;
const sectionAt = (offset: number | undefined): string => {
  if (offset === undefined) return '';
  let current = '';
  for (const h of outline) if (h.offset <= offset) current = h.text;
  return current;
};

const outlineList = document.querySelector('#outline')!;
const renderOutline = () => {
  outlineList.replaceChildren(...outline.map(h => {
    const li = document.createElement('li');
    li.style.setProperty('--level', String(h.level - 1));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline__link';
    button.textContent = h.text;
    button.addEventListener('click', () => editor.revealOffset(h.offset));
    li.appendChild(button);
    return li;
  }));
};
editor.on<OutlineEntry[]>('markdown:outline', entries => {
  outline = entries;
  renderOutline();
  renderPeople(session.peers);
});
renderOutline();

const people = document.querySelector('#people')!;
const renderPeople = (peers: RemoteCursor[]) => {
  const self = { clientId: 'me', user: me(), selection: { anchor: textarea.selectionStart, head: textarea.selectionStart } };
  people.replaceChildren(...[self, ...peers].map(p => {
    const li = document.createElement('li');
    const name = p.user?.name ?? 'Guest';
    const a = document.createElement('span');
    a.className = 'avatar';
    a.setAttribute('aria-hidden', 'true');
    a.style.background = p.user?.color ?? avatar(name).color;
    a.textContent = avatar(name).initials;
    const who = document.createElement('span');
    who.className = 'people__who';
    const strong = document.createElement('span');
    strong.textContent = p.clientId === 'me' ? `${name} (you)` : name;
    who.appendChild(strong);
    const section = sectionAt(p.selection?.head);
    if (section) {
      const where = document.createElement('small');
      where.textContent = `in ${section}`;
      who.appendChild(where);
    }
    li.append(a, who);
    return li;
  }));
};
session.on('presence', renderPeople);
renderPeople([]);

// ── Status ─────────────────────────────────────────────────────────────────

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

// ── Comments ───────────────────────────────────────────────────────────────

const commentsList = document.querySelector<HTMLOListElement>('#comments')!;
const empty = document.querySelector<HTMLElement>('#comments-empty')!;
const showResolved = document.querySelector<HTMLInputElement>('#show-resolved')!;
const addButton = document.querySelector<HTMLButtonElement>('#add-comment')!;
const form = document.querySelector<HTMLFormElement>('#comment-form')!;
const quote = document.querySelector<HTMLElement>('#comment-quote')!;
const body = document.querySelector<HTMLTextAreaElement>('#comment-body')!;
let pendingRange: { from: number; to: number } | null = null;
let activeId: string | null = null;

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const excerpt = (a: CollabAnnotation) => {
  const text = session.content.slice(a.from, a.to);
  return text ? (text.length > 80 ? `${text.slice(0, 77)}…` : text) : 'Text deleted';
};

const renderComments = () => {
  const all = session.annotations;
  const visible = all.filter(a => showResolved.checked || !a.resolved);
  editor.annotations = all.filter(a => !a.resolved).map(a => ({ id: a.id, from: a.from, to: a.to, color: a.user?.color, active: a.id === activeId }));
  empty.hidden = visible.length > 0;
  commentsList.replaceChildren(...visible.map(a => {
    const li = document.createElement('li');
    li.className = 'comment';
    li.dataset.id = a.id;
    li.toggleAttribute('data-active', a.id === activeId);
    li.toggleAttribute('data-resolved', !!a.resolved);
    li.style.setProperty('--who', a.user?.color ?? 'var(--ar-accent)');
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'comment__quote';
    jump.textContent = excerpt(a);
    jump.setAttribute('aria-label', `Show the commented text: ${excerpt(a)}`);
    jump.addEventListener('click', () => {
      activeId = a.id;
      editor.revealOffset(a.from, false);
      textarea.focus();
      textarea.setSelectionRange(a.from, a.to);
      renderComments();
    });
    const meta = document.createElement('p');
    meta.className = 'comment__meta';
    meta.textContent = `${a.user?.name ?? 'Someone'}${a.createdAt ? ` · ${time.format(a.createdAt)}` : ''}`;
    const text = document.createElement('p');
    text.className = 'comment__body';
    text.textContent = a.body;
    li.append(jump, meta, text);
    for (const r of a.replies ?? []) {
      const reply = document.createElement('p');
      reply.className = 'comment__reply';
      const who = document.createElement('strong');
      who.textContent = `${r.user?.name ?? 'Someone'}: `;
      reply.append(who, r.body);
      li.appendChild(reply);
    }
    const actions = document.createElement('div');
    actions.className = 'comment__actions';
    const button = (label: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn--ghost btn--small';
      b.textContent = label;
      b.addEventListener('click', onClick);
      actions.appendChild(b);
    };
    button('Reply', () => {
      const text = prompt(`Reply to ${a.user?.name ?? 'this comment'}`);
      if (text?.trim()) session.updateAnnotation(a.id, { replies: [...(a.replies ?? []), { body: text.trim(), user: me(), createdAt: Date.now() }] });
    });
    button(a.resolved ? 'Reopen' : 'Resolve', () => session.updateAnnotation(a.id, { resolved: !a.resolved }));
    if (a.user?.name === me().name) button('Delete', () => session.removeAnnotation(a.id));
    li.appendChild(actions);
    return li;
  }));
};
session.on('annotations', renderComments);
showResolved.addEventListener('change', renderComments);

editor.on<{ from: number; to: number }>('markdown:selection', ({ from, to }) => {
  addButton.disabled = from === to;
  // The comment under the caret becomes the active one.
  const under = session.annotations.find(a => !a.resolved && from >= a.from && from <= a.to && a.to > a.from);
  if ((under?.id ?? null) !== activeId) {
    activeId = under?.id ?? null;
    renderComments();
  }
  renderPeople(session.peers);
});

addButton.addEventListener('click', () => {
  const from = Math.min(textarea.selectionStart, textarea.selectionEnd);
  const to = Math.max(textarea.selectionStart, textarea.selectionEnd);
  if (from === to) return;
  pendingRange = { from, to };
  quote.textContent = session.content.slice(from, to);
  form.hidden = false;
  body.focus();
});
// Keep the pending range on its text while people type.
session.on('change', () => {
  if (pendingRange && !form.hidden) quote.textContent = session.content.slice(pendingRange.from, pendingRange.to) || 'Text deleted';
});
const closeForm = () => {
  form.hidden = true;
  body.value = '';
  pendingRange = null;
};
form.addEventListener('submit', e => {
  e.preventDefault();
  if (!pendingRange || !body.value.trim()) return;
  session.annotate(pendingRange.from, pendingRange.to, body.value.trim());
  closeForm();
  textarea.focus();
});
document.querySelector('#comment-cancel')!.addEventListener('click', closeForm);
form.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeForm();
});

// ── Socrates: a second collaborator in this tab ────────────────────────────

const interjections = [' (but what *is* it?)', ' — says who?', ' Is that so?', ' (define your terms)', ' …or is it?'];
const questions = [
  'What do you mean by this?',
  'Is this a kind of virtue, or virtue itself?',
  'And could this be taught?',
  'If we knew this, would we not already be good?',
  'Let us examine this together.',
];
let ghost: { session: CollabSession; timers: Array<ReturnType<typeof setInterval>> } | null = null;
document.querySelector<HTMLInputElement>('#ghost')!.addEventListener('change', e => {
  if (!(e.target as HTMLInputElement).checked) {
    ghost?.session.close();
    ghost?.timers.forEach(clearInterval);
    ghost = null;
    toast('Socrates has left for the agora.');
    return;
  }
  const ws = new WebSocketManager({ url: 'wss://mock.local/collab', socketFactory: backend.webSocket });
  const hidden = document.createElement('textarea');
  const socrates = new CollabSession(ws, 'symposium', hidden, { user: { name: 'Socrates', color: PIGMENTS[1] }, cursors: false });
  let queue = '';
  let at = 0;
  const pickLine = (filter: (line: string) => boolean) => {
    const lines = hidden.value.split('\n');
    const candidates = lines.map((l, i) => [l, i] as const).filter(([l]) => filter(l));
    if (!candidates.length) return null;
    const [line, index] = candidates[Math.floor(Math.random() * candidates.length)];
    const start = lines.slice(0, index).join('\n').length + (index ? 1 : 0);
    return { line, start };
  };
  const type = setInterval(() => {
    if (socrates.status === 'connecting') return;
    if (!queue) {
      const target = pickLine(l => /^(- |\d+\. )/.test(l) && !l.includes('[') && l.length < 140);
      if (!target) return;
      at = target.start + target.line.length;
      queue = interjections[Math.floor(Math.random() * interjections.length)];
    }
    hidden.value = hidden.value.slice(0, at) + queue[0] + hidden.value.slice(at);
    hidden.setSelectionRange(at + 1, at + 1);
    at++;
    queue = queue.slice(1);
    hidden.dispatchEvent(new Event('input'));
    hidden.dispatchEvent(new Event('keyup'));
  }, 150);
  const ask = setInterval(() => {
    if (socrates.status !== 'synced' || socrates.annotations.filter(a => a.user?.name === 'Socrates' && !a.resolved).length >= 3) return;
    const target = pickLine(l => /\*\*\w/.test(l) || /^> /.test(l));
    if (!target) return;
    const word = /\*\*([^*]+)\*\*|> (.{8,40}?)[,.?]/.exec(target.line);
    if (!word) return;
    const text = word[1] ?? word[2];
    const from = target.start + target.line.indexOf(text);
    socrates.annotate(from, from + text.length, questions[Math.floor(Math.random() * questions.length)]);
  }, 6000);
  ghost = { session: socrates, timers: [type, ask] };
  toast('Socrates joined. He has questions.');
});

document.querySelector<HTMLInputElement>('#offline')!.addEventListener('change', e => {
  const offline = (e.target as HTMLInputElement).checked;
  backend.control({ offline });
  toast(offline ? 'You are offline. Keep editing; changes will sync on reconnect.' : 'Back online, syncing…');
});
document.querySelector('#new-window')!.addEventListener('click', () => window.open(location.href, '_blank', 'width=1200,height=800'));
if (!backend.shared) toast('This browser has no SharedWorker; invite Socrates to see collaboration.', 'info');
