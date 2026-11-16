import { describe, expect, it, vi } from 'vitest';
import { AuthManager } from '../auth-manager';
import { HttpError } from '../http-error';
import { makeJwt, mockFetch, type RouteHandler } from '../../../test/helpers';

const future = () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, sub: 'u1', name: 'Zoë' });
const soon = () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 10 });
const past = () => makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 });

function auth(handler: RouteHandler = () => ({ body: {} }), config: Partial<ConstructorParameters<typeof AuthManager>[0]> = {}) {
  const fetch = mockFetch(handler);
  const expired = vi.fn();
  const manager = new AuthManager({ loginUrl: '/login', refreshUrl: '/refresh', logoutUrl: '/logout', onSessionExpired: expired, ...config }, { fetch: () => fetch });
  return { manager, fetch, expired };
}

describe('AuthManager', () => {
  it('stores and parses tokens (UTF-8 claims, memoized)', () => {
    const { manager } = auth();
    expect(manager.isAuthenticated()).toBe(false);
    const token = future();
    manager.setTokens(token, 'r');
    expect(manager.getAccessToken()).toBe(token);
    expect(manager.getRefreshToken()).toBe('r');
    expect(manager.getUser()).toMatchObject({ sub: 'u1', name: 'Zoë' });
    expect(manager.parseToken(token)).toBe(manager.parseToken(token));
    expect(manager.isAuthenticated()).toBe(true);
    expect(manager.parseToken('opaque')).toBeNull();
    expect(manager.parseToken('a.!!!.c')).toBeNull();
    expect(manager.secondsUntilExpiry('opaque')).toBe(Infinity);
    manager.clearTokens();
    expect(manager.getAccessToken()).toBeNull();
    expect(manager.getUser()).toBeNull();
  });

  it('supports session, memory and custom storage', () => {
    const s = auth(undefined, { storage: 'session' }).manager;
    s.setTokens('a');
    expect(sessionStorage.getItem('access_token')).toBe('a');
    const custom = { getItem: vi.fn(() => 'x'), setItem: vi.fn(), removeItem: vi.fn() } as unknown as Storage;
    const c = auth(undefined, { storage: custom, accessTokenKey: 'k' }).manager;
    expect(c.getAccessToken()).toBe('x');
    c.setTokens('y');
    expect(custom.setItem).toHaveBeenCalledWith('k', 'y');
    const m = auth(undefined, { storage: 'memory' }).manager;
    m.setTokens('mem');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(m.getAccessToken()).toBe('mem');
  });

  it('treats opaque tokens as valid and uses a custom parser', async () => {
    const { manager, fetch } = auth(undefined, { storage: 'memory' });
    manager.setTokens('opaque-token');
    expect(await manager.ensureValidToken()).toBe('opaque-token');
    expect(fetch.calls).toHaveLength(0);
    const custom = auth(undefined, { storage: 'memory', parseToken: () => ({ exp: 1 }) }).manager;
    custom.setTokens('t');
    expect(custom.isAuthenticated()).toBe(false);
  });

  it('refreshes tokens that expire soon, sharing one request', async () => {
    const fresh = future();
    const { manager, fetch } = auth(() => ({ body: { access_token: fresh, refresh_token: 'r2' } }), { storage: 'memory' });
    manager.setTokens(soon(), 'r1');
    const refreshed = vi.fn();
    manager.on('refresh', refreshed);
    const [a, b] = await Promise.all([manager.ensureValidToken(), manager.ensureValidToken()]);
    expect(a).toBe(fresh);
    expect(b).toBe(fresh);
    expect(fetch.calls).toHaveLength(1);
    expect(JSON.parse(String(fetch.calls[0].init.body))).toEqual({ refresh_token: 'r1' });
    expect(manager.getRefreshToken()).toBe('r2');
    expect(refreshed).toHaveBeenCalled();
  });

  it('keeps the session on network errors (regression)', async () => {
    const { manager, expired } = auth(() => ({ networkError: true }), { storage: 'memory' });
    const token = soon();
    manager.setTokens(token, 'r');
    expect(await manager.ensureValidToken()).toBe(token);
    expect(manager.getAccessToken()).toBe(token);
    expect(expired).not.toHaveBeenCalled();
  });

  it('keeps the session on 5xx and bad refresh responses', async () => {
    let status = 503;
    const { manager, expired } = auth(() => (status === 503 ? { status } : { body: { nothing: true } }), { storage: 'memory' });
    manager.setTokens(soon(), 'r');
    expect(await manager.refreshAccessToken()).toBe(false);
    status = 200;
    expect(await manager.refreshAccessToken()).toBe(false);
    expect(expired).not.toHaveBeenCalled();
    manager.setTokens(past(), 'r');
    expect(await manager.ensureValidToken()).toBeNull();
  });

  it('ends the session when the refresh token is rejected', async () => {
    const { manager, expired } = auth(() => ({ status: 401 }), { storage: 'memory' });
    const onExpired = vi.fn();
    manager.on('expired', onExpired);
    manager.setTokens(soon(), 'r');
    expect(await manager.ensureValidToken()).toBeNull();
    expect(manager.getAccessToken()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalled();
  });

  it('expires sessions with no refresh token', async () => {
    const { manager, expired } = auth(undefined, { storage: 'memory' });
    manager.setTokens(soon());
    expect(await manager.refreshAccessToken()).toBe(false);
    expect(expired).toHaveBeenCalled();
    expect(await manager.ensureValidToken()).toBeNull();
  });

  it('reads tokens from custom paths and body fields', async () => {
    const fresh = future();
    const { manager, fetch } = auth(() => ({ body: { data: { token: fresh } } }), {
      storage: 'memory', tokenPaths: { accessToken: 'data.token' }, refreshBodyField: 'rt',
    });
    manager.setTokens(soon(), 'r');
    await manager.refreshAccessToken();
    expect(manager.getAccessToken()).toBe(fresh);
    expect(JSON.parse(String(fetch.calls[0].init.body))).toEqual({ rt: 'r' });
  });

  it('logs in and out', async () => {
    const token = future();
    const { manager, fetch } = auth(url => (url.pathname === '/login' ? { body: { access_token: token, refresh_token: 'r', user: { id: 1 } } } : { status: 204 }), { storage: 'memory' });
    const events: string[] = [];
    manager.on('login', () => events.push('login'));
    manager.on('logout', () => events.push('logout'));
    expect(await manager.login({ user: 'a', password: 'b' })).toMatchObject({ user: { id: 1 } });
    expect(manager.getAccessToken()).toBe(token);
    await manager.logout();
    expect((fetch.calls[1].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
    // The refresh token goes along so the server can revoke it.
    expect(JSON.parse(String(fetch.calls[1].init.body))).toEqual({ refresh_token: 'r' });
    expect(manager.getAccessToken()).toBeNull();
    // Logging out without a token sends no "Bearer null" (regression).
    await manager.logout();
    expect((fetch.calls[2].init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(fetch.calls[2].init.body).toBeUndefined();
    expect(events).toEqual(['login', 'logout', 'logout']);
  });

  it('returns null for failed logins', async () => {
    expect(await auth(() => ({ status: 401 }), { storage: 'memory' }).manager.login({})).toBeNull();
    expect(await auth(() => ({ body: {} }), { storage: 'memory' }).manager.login({})).toBeNull();
    expect(await auth(() => ({ networkError: true }), { storage: 'memory' }).manager.login({})).toBeNull();
  });

  it('reacts to token changes from other tabs', () => {
    const { manager } = auth();
    const change = vi.fn();
    manager.on('change', change);
    window.dispatchEvent(new StorageEvent('storage', { key: 'access_token' }));
    expect(change).toHaveBeenCalledWith({ authenticated: false });
    manager.destroy();
    window.dispatchEvent(new StorageEvent('storage', { key: 'access_token' }));
    expect(change).toHaveBeenCalledTimes(1);
  });
});

describe('HttpError', () => {
  it('classifies errors', () => {
    const net = new HttpError('x', 0);
    expect(net.isNetworkError).toBe(true);
    expect(new HttpError('x', 503).isServerError).toBe(true);
    expect(new HttpError('x', 401).isUnauthorized).toBe(true);
    expect(new HttpError('Fallback', 400, { body: { error: 'Bad' } }).displayMessage).toBe('Bad');
    expect(new HttpError('Fallback', 400, { body: 'str' }).displayMessage).toBe('Fallback');
    expect(new HttpError('t', 408, { kind: 'timeout' }).isTimeout).toBe(true);
  });
});
