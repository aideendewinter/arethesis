import { Component, defineComponent, sanitizeHtml, type ListView, type StoredObject } from 'arethesis';
import 'arethesis/components';
import { storeSource } from 'arethesis/components';
import { connectMockBackend } from '../mock/client';
import { PHILOSOPHERS } from '../mock/data';
import { startApp } from '../shared/boot';
import { bindNetworkControl } from '../shared/network';
import { addCommands, avatar, bindStatus, mountShell, toast } from '../shared/shell';
import source from './main.ts?raw';

mountShell({
  page: 'agora',
  title: 'The Agora',
  description: 'A threaded discussion, live. Posts are normalized objects in the store; threads load a page at a time with infinite scroll; votes are optimistic and roll back if the server refuses; new replies arrive over Server-Sent Events while you read.',
  features: ['ListView + cursor pagination', 'infinite scroll', 'optimistic votes', 'SSE', 'rich-text', 'feed pattern'],
  source,
  footnote: 'The posts paraphrase positions their authors are known for; none are quotations.',
});

interface Post {
  id: string;
  parent: string | null;
  root: string;
  author: string;
  body: string;
  score: number;
  createdAt: string;
  /** This browser's vote (not sent by the server). */
  myVote?: number;
}

const backend = connectMockBackend();
const { app } = await startApp('agora', {
  plugins: ['rich-text'],
  types: [{ name: 'Post', persist: false }],
  endpoints: {
    listPosts: { url: '/posts', type: 'Post', list: true, mapping: { dataPath: 'items' }, pagination: { cursorPath: 'next', totalCountPath: 'total' } },
  },
  persistence: false,
});

const nameInput = document.querySelector<HTMLInputElement>('#name')!;
nameInput.value = sessionStorage.getItem('agora-name') ?? 'A citizen of Athens';
nameInput.addEventListener('change', () => sessionStorage.setItem('agora-name', nameInput.value));
const me = () => nameInput.value.trim() || 'A citizen';

const time = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const ago = (iso: string) => {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  return Math.abs(minutes) < 60 ? time.format(minutes, 'minute') : time.format(Math.round(minutes / 60), 'hour');
};

/** Collapsed threads, and replies loaded so far, by root id. */
const collapsed = new Set<string>();
const repliesLoaded = new Set<string>();
const fresh = new Set<string>();

/** One post (any depth) as an <article>, with its replies under it. */
function renderPost(post: Post, depth: number): HTMLElement {
  const article = document.createElement('article');
  article.className = 'post';
  article.dataset.id = post.id;
  article.tabIndex = -1;
  article.setAttribute('aria-labelledby', `post-${post.id}-author`);
  if (fresh.delete(post.id)) article.classList.add('is-new');
  const { initials, color } = avatar(post.author);
  const head = document.createElement('header');
  head.className = 'post__head';
  const av = document.createElement('span');
  av.className = 'avatar';
  av.setAttribute('aria-hidden', 'true');
  av.style.background = color;
  av.textContent = initials;
  const who = document.createElement('strong');
  who.className = 'post__author';
  who.id = `post-${post.id}-author`;
  who.textContent = post.author;
  const when = document.createElement('time');
  when.dateTime = post.createdAt;
  when.textContent = ago(post.createdAt);
  head.append(av, who, when);
  const body = document.createElement('div');
  body.className = 'post__body ar-prose';
  body.innerHTML = sanitizeHtml(post.body);
  article.append(head, body, actions(post));
  const children = replies(post.id);
  if (children.length) {
    const list = document.createElement('ol');
    list.className = 'thread';
    list.id = `thread-${post.id}`;
    list.hidden = collapsed.has(post.id);
    list.setAttribute('aria-label', `Replies to ${post.author}`);
    for (const child of children) {
      const li = document.createElement('li');
      li.appendChild(renderPost(child, depth + 1));
      list.appendChild(li);
    }
    article.appendChild(list);
  }
  return article;
}

function actions(post: Post): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'post__actions';
  footer.innerHTML = `
    <span class="vote" role="group" aria-label="Votes">
      <button type="button" class="vote__button" data-vote="1" aria-label="Agree with ${escapeAttr(post.author)}" aria-pressed="${post.myVote === 1}">▲</button>
      <span class="vote__score" aria-live="off"></span>
      <button type="button" class="vote__button" data-vote="-1" aria-label="Disagree with ${escapeAttr(post.author)}" aria-pressed="${post.myVote === -1}">▼</button>
    </span>
    <button type="button" class="btn btn--ghost btn--small" data-reply>Reply</button>`;
  footer.querySelector('.vote__score')!.textContent = String(post.score);
  const count = countReplies(post.id);
  if (count) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn--ghost btn--small';
    toggle.dataset.toggle = '';
    toggle.setAttribute('aria-controls', `thread-${post.id}`);
    toggle.setAttribute('aria-expanded', String(!collapsed.has(post.id)));
    toggle.textContent = collapsed.has(post.id) ? `Show ${count} ${count === 1 ? 'reply' : 'replies'}` : 'Hide replies';
    footer.appendChild(toggle);
  }
  return footer;
}

const escapeAttr = (s: string) => s.replace(/[&"<>]/g, c => `&#${c.charCodeAt(0)};`);
const posts = () => app.store.getByType<Post>('Post').map(o => o.data);
const byScore = (a: Post, b: Post) => b.score - a.score || a.createdAt.localeCompare(b.createdAt);
const replies = (id: string) => posts().filter(p => p.parent === id).sort(byScore);
const countReplies = (id: string): number => replies(id).reduce((n, r) => n + 1 + countReplies(r.id), 0);

/**
 * The feed: top-level posts are a ListView (cursor pagination, infinite
 * scroll, server-side sort); each thread under them is drawn from the store.
 */
@defineComponent({
  tag: 'agora-feed',
  html: `<template id="main"><div class="agora-feed" role="feed" aria-label="Discussion" aria-busy="true" data-items></div><p class="hint agora-more" hidden></p></template>
    <template id="item"><div class="agora-item"></div></template>
    <template id="loading"><div class="agora-item"><div class="ar-skeleton"></div><div class="ar-skeleton"></div></div></template>`,
})
export class AgoraFeed extends Component {
  static override bindConfig = { fields: {}, loadingTemplate: 'loading', infiniteScroll: { threshold: 300, root: 'viewport' as const } };

  protected override onItemRender(element: Element, obj: StoredObject): void {
    element.replaceChildren(renderPost(obj.data as Post, 0));
    this.#positions();
  }

  protected override onListChange(view: ListView): void {
    const feed = this.querySelector('[role=feed]');
    feed?.setAttribute('aria-busy', String(view.status === 'loading' || view.status === 'loading-more'));
    const more = this.querySelector<HTMLElement>('.agora-more');
    if (more) {
      more.hidden = view.status !== 'loaded' || !view.hasMore;
      more.textContent = 'Scroll for older threads…';
    }
    this.#positions();
    // Fetch the replies for any threads we haven't loaded yet.
    const missing = view.ids.filter(id => !repliesLoaded.has(id));
    if (missing.length) {
      missing.forEach(id => repliesLoaded.add(id));
      void app.http.request<Post[]>({ url: '/posts/replies', params: { roots: missing.join(',') } })
        .then(list => app.store.upsertMany('Post', list, { source: 'server' }))
        .then(() => missing.forEach(id => this.redrawThread(id)))
        .catch((error: unknown) => {
          missing.forEach(id => repliesLoaded.delete(id));
          console.error('Could not load replies', error);
        });
    }
  }

  /** Feed pattern: each article knows its position. */
  #positions(): void {
    const items = Array.from(this.querySelectorAll<HTMLElement>('[role=feed] > .agora-item > article'));
    items.forEach((a, i) => {
      a.setAttribute('aria-posinset', String(i + 1));
      a.setAttribute('aria-setsize', String(app.listViews.get(view.id)?.totalCount ?? -1));
    });
  }

  /** Redraw one top-level thread from the store (after replies or votes change). */
  redrawThread(rootId: string): void {
    const item = this.querySelector<HTMLElement>(`[role=feed] > .agora-item[data-id="${CSS.escape(rootId)}"]`);
    const root = app.store.getData<Post>('Post', rootId);
    if (!item || !root) return;
    const hadFocus = item.contains(document.activeElement) ? (document.activeElement as HTMLElement).closest<HTMLElement>('article')?.dataset.id : undefined;
    item.replaceChildren(renderPost(root, 0));
    this.#positions();
    if (hadFocus) item.querySelector<HTMLElement>(`article[data-id="${CSS.escape(hadFocus)}"]`)?.focus();
  }
}

const feed = document.querySelector<AgoraFeed>('agora-feed')!;
const view = app.list({ id: 'agora', type: 'Post', endpoint: 'listPosts', pageSize: 4, sort: [{ field: 'score', direction: 'desc' }] });
/** ListViews are replaced as they change: always read the current one. */
const currentIds = () => app.listViews.get(view.id)?.ids ?? [];
const openedAt = Date.now();
await feed.ready;
feed.bindList(view);

// Votes are optimistic: the score changes at once and rolls back if the server says no.
async function vote(id: string, dir: 1 | -1): Promise<void> {
  const post = app.store.getData<Post>('Post', id);
  if (!post) return;
  const change = post.myVote === dir ? -dir : post.myVote ? dir * 2 : dir;
  const myVote = post.myVote === dir ? 0 : dir;
  try {
    await app.optimistic.update('Post', id, { score: post.score + change, myVote }, () =>
      app.http.request({ url: `/posts/${id}/vote`, method: 'POST', body: { dir: change } }));
  } catch {
    toast('Your vote didn’t count: the server refused it. It was rolled back.', 'error');
  }
}

/** An inline reply form under a post. */
function openReply(article: HTMLElement): void {
  const existing = article.querySelector<HTMLFormElement>(':scope > .reply-form');
  if (existing) {
    existing.querySelector('textarea')!.focus();
    return;
  }
  const id = article.dataset.id!;
  const author = article.querySelector(':scope > header .post__author')!.textContent;
  const form = document.createElement('form');
  form.className = 'reply-form';
  form.innerHTML = `<label class="ar-visually-hidden" for="reply-${id}"></label><textarea id="reply-${id}" rows="2" required></textarea>
    <div class="form-actions"><button class="btn btn--small" type="submit">Reply</button><button class="btn btn--ghost btn--small" type="button" data-cancel>Cancel</button></div>`;
  form.querySelector('label')!.textContent = `Reply to ${author}`;
  form.querySelector('textarea')!.placeholder = `Reply to ${author}…`;
  article.querySelector(':scope > footer')!.after(form);
  form.querySelector('textarea')!.focus();
  form.querySelector('[data-cancel]')!.addEventListener('click', () => {
    form.remove();
    article.focus();
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = form.querySelector('textarea')!.value.trim();
    if (!text) return;
    const html = text.split(/\n{2,}/).map(p => `<p>${p.replace(/[&<>]/g, c => `&#${c.charCodeAt(0)};`).replace(/\n/g, '<br>')}</p>`).join('');
    await post(html, id);
    form.remove();
  });
}

async function post(html: string, parent: string | null): Promise<void> {
  try {
    const created = await app.http.request<Post>({ url: '/posts', method: 'POST', body: { body: html, author: me(), parent } });
    fresh.add(created.id);
    app.store.upsert('Post', created.id, created, { source: 'server' });
    if (!parent) {
      repliesLoaded.add(created.id);
      app.listViews.optimisticAdd(view.id, created.id, 'start');
    } else {
      collapsed.delete(parent);
      feed.redrawThread(created.root);
    }
    toast('Posted to the agora.', 'success');
  } catch (err) {
    toast(`Couldn’t post: ${(err as Error).message}`, 'error');
  }
}

// One delegated handler for every post, at any depth.
feed.addEventListener('click', e => {
  const button = (e.target as Element).closest<HTMLButtonElement>('button');
  const article = button?.closest<HTMLElement>('article[data-id]');
  if (!button || !article) return;
  const id = article.dataset.id!;
  if (button.dataset.vote) void vote(id, Number(button.dataset.vote) as 1 | -1);
  else if (button.hasAttribute('data-reply')) openReply(article);
  else if (button.hasAttribute('data-toggle')) {
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    const root = app.store.getData<Post>('Post', id)?.root ?? id;
    feed.redrawThread(root);
    feed.querySelector<HTMLElement>(`article[data-id="${CSS.escape(id)}"] > footer [data-toggle]`)?.focus();
  }
});

// Feed pattern keys: Page Down / Page Up move between top-level posts.
feed.addEventListener('keydown', e => {
  if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
  if ((e.target as Element).closest('textarea, input')) return;
  const articles = Array.from(feed.querySelectorAll<HTMLElement>('[role=feed] > .agora-item > article'));
  const current = (e.target as Element).closest('[role=feed] > .agora-item > article') ?? (e.target as Element).closest('.agora-item')?.querySelector('article');
  const i = current ? articles.indexOf(current as HTMLElement) : -1;
  const next = articles[e.key === 'PageDown' ? i + 1 : Math.max(0, i - 1)];
  if (next) {
    e.preventDefault();
    next.focus();
    next.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
});

// Changes to replies (from anyone) redraw their thread; new top-level posts join the feed.
app.store.subscribeToType<Post>('Post', obj => {
  const p = obj?.data;
  if (!p) return;
  if (p.parent) {
    if (!feed.querySelector(`article[data-id="${CSS.escape(p.id)}"]`)) fresh.add(p.id);
    feed.redrawThread(p.root);
  } else if (!currentIds().includes(p.id)) {
    // A post someone else just wrote (pages being loaded also land in the store, but they're older).
    if (Date.parse(p.createdAt) < openedAt) return;
    repliesLoaded.add(p.id);
    fresh.add(p.id);
    app.listViews.optimisticAdd(view.id, p.id, 'start');
  } else {
    feed.redrawThread(p.id);
  }
  renderSpeakers();
});

// The composer (a rich-text editor over a textarea).
document.querySelector<HTMLFormElement>('#compose')!.addEventListener('submit', async e => {
  e.preventDefault();
  const textarea = document.querySelector<HTMLTextAreaElement>('#compose-body')!;
  const html = textarea.value;
  if (!html.replace(/<[^>]*>/g, '').trim()) {
    toast('Say something first.', 'error');
    return;
  }
  await post(html, null);
  textarea.value = '';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  const editor = document.querySelector<HTMLElement>('#compose .rich-text__content');
  if (editor) editor.innerHTML = '';
});

// Sort: Best or Newest, sent to the server as a ListView sort.
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
  button.addEventListener('click', () => {
    for (const b of document.querySelectorAll('[data-sort]')) b.setAttribute('aria-pressed', String(b === button));
    void app.listViews.update(view.id, { sort: [{ field: button.dataset.sort!, direction: 'desc' }] });
  });
}

// Who's talking.
const speakers = document.querySelector('#speakers')!;
function renderSpeakers(): void {
  const counts = new Map<string, number>();
  for (const p of posts()) counts.set(p.author, (counts.get(p.author) ?? 0) + 1);
  const names = [...new Set([...PHILOSOPHERS, ...counts.keys()])].filter(n => counts.has(n)).sort((a, b) => counts.get(b)! - counts.get(a)!);
  speakers.replaceChildren(...names.map(name => {
    const li = document.createElement('li');
    const av = document.createElement('span');
    av.className = 'avatar';
    av.setAttribute('aria-hidden', 'true');
    av.style.background = avatar(name).color;
    av.textContent = avatar(name).initials;
    const who = document.createElement('span');
    who.className = 'people__who';
    const strong = document.createElement('span');
    strong.textContent = name;
    const small = document.createElement('small');
    small.textContent = `${counts.get(name)} ${counts.get(name) === 1 ? 'post' : 'posts'}`;
    who.append(strong, small);
    li.append(av, who);
    return li;
  }));
}
renderSpeakers();

// The command palette (Ctrl/Cmd+K) finds posts by what they say or who said them.
addCommands(storeSource<Post>({
  type: 'Post',
  label: 'Posts',
  icon: '❝',
  title: p => p.body.replace(/<[^>]*>/g, '').slice(0, 80),
  subtitle: p => p.author,
  run: p => {
    collapsed.delete(p.parent ?? '');
    feed.redrawThread(p.root);
    const el = feed.querySelector<HTMLElement>(`article[data-id="${CSS.escape(p.id)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'center' });
  },
}));

// Demo controls.
const talk = document.querySelector<HTMLInputElement>('#talk')!;
talk.checked = sessionStorage.getItem('agora-quiet') !== 'true';
backend.control({ agora: talk.checked });
talk.addEventListener('change', () => {
  sessionStorage.setItem('agora-quiet', String(!talk.checked));
  backend.control({ agora: talk.checked });
});
document.querySelector<HTMLInputElement>('#failures')!.addEventListener('change', e => backend.control({ failureRate: (e.target as HTMLInputElement).checked ? 1 : 0 }));
bindNetworkControl(document.querySelector<HTMLSelectElement>('#network')!, backend);
bindStatus(document.querySelector('#sse-status')!, 'Live', fn => app.sse!.onStatusChange(fn), app.sse!.status);
addEventListener('pagehide', () => backend.control({ agora: false }));
