import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Arethesis, defineEndpoint, defineType, getArethesis, VERSION } from '../arethesis';
import { Component } from '../../components/component';
import { defineComponent } from '../../components/decorators';
import { FakeEventSource, FakeWebSocket, flush, makeJwt, mockFetch, type RouteHandler } from '../../../test/helpers';

let db = 0;
beforeEach(() => {
  FakeEventSource.instances = [];
  FakeWebSocket.instances = [];
});
afterEach(() => Arethesis.resetInstance());

function setup(handler: RouteHandler) {
  const fetch = mockFetch(handler);
  const app = new Arethesis();
  return { app, fetch };
}

it('VERSION matches package.json (npm version keeps them in sync)', () => {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../package.json'), 'utf8'));
  expect(VERSION).toBe(pkg.version);
});

describe('Arethesis', () => {
  it('is a singleton with chainable registration helpers', () => {
    const a = getArethesis();
    expect(getArethesis()).toBe(a);
    expect(a.version).toBe(VERSION);
    expect(defineType({ name: 'Global' })).toEqual({ name: 'Global' });
    defineEndpoint('globalEp', { url: '/g' });
    expect(a.http.getEndpoint('globalEp')).toBeDefined();
    expect(a.use({ name: 'p' })).toBe(a);
    Arethesis.resetInstance();
    expect(getArethesis()).not.toBe(a);
  });

  it('runs a full flow: init → fetch → render → SSE invalidate → refetch → logout', async () => {
    let name = 'Alice';
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const { app, fetch } = setup(url => {
      if (url.pathname === '/api/people/1') return { body: { data: { id: 1, fullName: name } } };
      if (url.pathname === '/api/auth/login') return { body: { access_token: token, refresh_token: 'r' } };
      return { status: 204 };
    });
    const ready = vi.fn();
    app.on('ready', ready);
    await app.init({
      http: { baseUrl: '/api', fetch, retry: false },
      auth: { loginUrl: '/auth/login', refreshUrl: '/auth/refresh', logoutUrl: '/auth/logout', storage: 'memory' },
      persistence: { dbName: `app-${++db}` },
      sse: { url: '/events', eventSourceFactory: (u, i) => new FakeEventSource(u, i) as unknown as EventSource },
      types: [{ name: 'Person', endpoint: 'getPerson' }],
      endpoints: { getPerson: { url: '/people/:id', type: 'Person', mapping: { dataPath: 'data', fields: { id: 'id', name: 'fullName' } } } },
      validation: { messages: { required: 'Needed' } },
    });
    expect(ready).toHaveBeenCalled();
    expect(app.isInitialized).toBe(true);
    expect(await app.init()).toBeUndefined(); // idempotent
    expect(app.validation.validateFieldSync('x', '', { rules: [{ type: 'required' }] })?.message).toBe('Needed');

    await app.login({ user: 'alice', password: 'pw' });
    await flush();
    expect(FakeEventSource.instances.at(-1)!.url).toBe(`/api/events?token=${token}`);

    class PersonCard extends Component {
      static override bindConfig = { fields: { name: {} } };
    }
    defineComponent({ tag: 'app-person-card', html: '<template id="main"><h2 data-bind="name"></h2></template><template id="loading"><i>…</i></template>' })(PersonCard);
    const card = document.createElement('app-person-card') as PersonCard;
    card.setAttribute('data-source', 'Person:1');
    document.body.appendChild(card);
    await flush(8);
    expect(card.querySelector('h2')!.textContent).toBe('Alice');
    expect((fetch.calls[1].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);

    name = 'Alice Hopper';
    FakeEventSource.instances.at(-1)!.emit('invalidate', { type: 'Person', id: 1 });
    await flush(8);
    expect(card.querySelector('h2')!.textContent).toBe('Alice Hopper');

    expect(await app.fetch('getPerson', { id: 1 })).toEqual({ id: 1, name: 'Alice Hopper' });
    expect(await app.request({ url: '/anything' })).toBeUndefined();
    expect(app.list({ type: 'Person', endpoint: 'x' }).type).toBe('Person');

    await app.persistence!.flush();
    expect(await app.persistence!.count()).toBe(1);
    const loggedOut = vi.fn();
    app.on('logout', loggedOut);
    await app.logout();
    expect(app.store.size).toBe(0);
    expect(await app.persistence!.count()).toBe(0);
    expect(app.auth!.getAccessToken()).toBeNull();
    expect(app.sse!.status).toBe('closed');
    expect(loggedOut).toHaveBeenCalled();
    app.destroy();
  });

  it('hydrates the store from IndexedDB on the next page load', async () => {
    const name = `hydrate-${++db}`;
    const first = setup(() => ({ body: { id: 5, title: 'cached' } }));
    first.app.defineEndpoint('get', { url: '/t/:id', type: 'Task' });
    await first.app.init({ http: { fetch: first.fetch }, persistence: { dbName: name }, mixins: false });
    await first.app.fetch('get', { id: 5 });
    await first.app.persistence!.flush();
    first.app.destroy();
    await flush();

    const second = setup(() => ({ status: 500 }));
    await second.app.init({ http: { fetch: second.fetch }, persistence: { dbName: name }, mixins: false });
    expect(second.app.store.getData('Task', '5')).toEqual({ id: 5, title: 'cached' });
    expect([...second.app.store.get('Task', '5')!.sources]).toContain('indexeddb');
    second.app.destroy();
  });

  it('keeps working when IndexedDB is unavailable (regression)', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate private mode
    delete globalThis.indexedDB;
    try {
      const { app, fetch } = setup(() => ({ body: {} }));
      await app.init({ http: { fetch }, mixins: false });
      expect(app.persistence).toBeNull();
      app.store.upsert('T', '1', {});
      await app.logout();
      app.destroy();
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('only sends tokens to trusted realtime endpoints', async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const { app, fetch } = setup(() => ({ body: { url: 'wss://azure/client' } }));
    await app.init({
      http: { baseUrl: 'https://api.example.com', fetch },
      auth: { loginUrl: '/l', refreshUrl: '/r', storage: 'memory' },
      persistence: false,
      mixins: false,
      autoConnect: false,
      sse: { url: 'https://evil.example.org/events', eventSourceFactory: (u, i) => new FakeEventSource(u, i) as unknown as EventSource },
      websocket: { url: 'wss://api.example.com/ws', socketFactory: u => new FakeWebSocket(u) as unknown as WebSocket, pingInterval: 0 },
      azurePubSub: { negotiateUrl: '/negotiate', socketFactory: u => new FakeWebSocket(u) as unknown as WebSocket },
    });
    app.auth!.setTokens(token);
    app.connect();
    await flush(5);
    expect(FakeEventSource.instances[0].url).toBe('https://evil.example.org/events');
    expect(FakeWebSocket.instances.find(s => s.url.includes('/ws'))!.url).toBe(`wss://api.example.com/ws?token=${token}`);
    expect((fetch.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
    expect(app.collab).toBeDefined();
    app.disconnect();
    app.destroy();
  });

  it('applies declarative mixins on init and observes the DOM', async () => {
    document.body.innerHTML = '<button data-mixin="tooltip" title="Hi">x</button>';
    const { app, fetch } = setup(() => ({ body: {} }));
    await app.init({ http: { fetch }, persistence: false });
    expect(document.querySelector('button')!.hasAttribute('aria-describedby')).toBe(true);
    const added = document.createElement('span');
    added.setAttribute('data-mixin', 'tooltip');
    added.setAttribute('data-tooltip', 'Later');
    document.body.appendChild(added);
    await flush();
    expect(added.hasAttribute('aria-describedby')).toBe(true);
    app.destroy();
    const other = setup(() => ({ body: {} }));
    await other.app.init({ http: { fetch: other.fetch }, persistence: false, mixins: { observe: false } });
    other.app.destroy();
  });

  it('requires auth for login', async () => {
    const { app } = setup(() => ({}));
    await expect(app.login({})).rejects.toThrow(/No auth/);
  });
});

describe('optional modules', () => {
  it('names the import when the real-time managers are missing', async () => {
    const hooks = await import('../hooks');
    const saved = hooks.getRealtime('sse');
    hooks.setRealtime(null as never);
    try {
      expect(() => hooks.getRealtime('sse')).toThrow(/arethesis\/realtime/);
    } finally {
      hooks.setRealtime(saved);
    }
  });
});
