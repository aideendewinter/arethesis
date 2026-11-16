/**
 * AuthManager: JWT lifecycle with automatic refresh.
 *
 * - Tokens are kept in `localStorage` (default), `sessionStorage`, memory, or a custom Storage.
 * - `ensureValidToken()` refreshes shortly before expiry; concurrent callers share one refresh.
 * - The session only ends when the refresh endpoint rejects the refresh token
 *   (400/401/403). A network blip never logs the user out.
 * - Token changes in other tabs are picked up through the `storage` event.
 *
 * @module http/auth-manager
 */

import type { AuthConfig, TokenPayload } from './types';
import { Emitter } from '../utils/emitter';
import { getPath } from '../utils/path';

export interface AuthEvents extends Record<string, unknown> {
  /** Tokens were set (login or refresh). */
  change: { authenticated: boolean };
  login: void;
  logout: void;
  refresh: void;
  /** The session could not be refreshed. */
  expired: void;
}

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(kind: AuthConfig['storage']): StorageLike {
  try {
    if (kind === 'memory') return new MemoryStorage();
    if (kind === 'session') return sessionStorage;
    if (kind && typeof kind === 'object') return kind;
    return localStorage;
  } catch {
    return new MemoryStorage();
  }
}

/** Decode a base64url segment as UTF-8. */
function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class AuthManager extends Emitter<AuthEvents> {
  readonly config: Required<Pick<AuthConfig, 'accessTokenKey' | 'refreshTokenKey' | 'refreshThreshold' | 'refreshBodyField'>> & AuthConfig;
  private storage: StorageLike;
  private refreshPromise: Promise<boolean> | null = null;
  private parsed: { token: string; payload: TokenPayload | null } | null = null;
  private fetchImpl: () => typeof fetch;
  private resolveUrl: (url: string) => string;
  private storageListener: ((e: StorageEvent) => void) | null = null;

  constructor(
    config: AuthConfig,
    options: { fetch?: () => typeof fetch; resolveUrl?: (url: string) => string } = {}
  ) {
    super();
    this.config = {
      accessTokenKey: 'access_token',
      refreshTokenKey: 'refresh_token',
      refreshThreshold: 60,
      refreshBodyField: 'refresh_token',
      ...config,
    };
    this.storage = resolveStorage(config.storage);
    this.fetchImpl = options.fetch ?? (() => globalThis.fetch.bind(globalThis));
    this.resolveUrl = options.resolveUrl ?? (url => url);

    if (typeof window !== 'undefined' && (config.storage === undefined || config.storage === 'local')) {
      this.storageListener = (e: StorageEvent) => {
        if (e.key === this.config.accessTokenKey || e.key === null) {
          this.parsed = null;
          this.emit('change', { authenticated: this.isAuthenticated() });
        }
      };
      window.addEventListener('storage', this.storageListener);
    }
  }

  // ── Tokens ───────────────────────────────────────────────────────────────

  getAccessToken(): string | null {
    try {
      return this.storage.getItem(this.config.accessTokenKey);
    } catch {
      return null;
    }
  }

  getRefreshToken(): string | null {
    try {
      return this.storage.getItem(this.config.refreshTokenKey);
    } catch {
      return null;
    }
  }

  setTokens(accessToken: string, refreshToken?: string | null): void {
    try {
      this.storage.setItem(this.config.accessTokenKey, accessToken);
      if (refreshToken) this.storage.setItem(this.config.refreshTokenKey, refreshToken);
    } catch (err) {
      console.warn('Arethesis: could not store tokens.', err);
    }
    this.parsed = null;
    this.emit('change', { authenticated: true });
  }

  clearTokens(): void {
    try {
      this.storage.removeItem(this.config.accessTokenKey);
      this.storage.removeItem(this.config.refreshTokenKey);
    } catch {
      /* ignore */
    }
    this.parsed = null;
    this.emit('change', { authenticated: false });
  }

  /** Decode a JWT payload (memoized per token). Returns null for non-JWT tokens. */
  parseToken(token: string): TokenPayload | null {
    if (this.parsed?.token === token) return this.parsed.payload;
    let payload: TokenPayload | null = null;
    if (this.config.parseToken) {
      payload = this.config.parseToken(token);
    } else {
      const parts = token.split('.');
      if (parts.length === 3) {
        try {
          const decoded = JSON.parse(decodeBase64Url(parts[1]));
          payload = decoded && typeof decoded === 'object' ? decoded as TokenPayload : null;
        } catch {
          payload = null;
        }
      }
    }
    this.parsed = { token, payload };
    return payload;
  }

  /** Claims of the current token, if it is a JWT. */
  getUser<T extends TokenPayload = TokenPayload>(): T | null {
    const token = this.getAccessToken();
    return token ? (this.parseToken(token) as T | null) : null;
  }

  /** Seconds until the token expires (`Infinity` if it has no `exp`). */
  secondsUntilExpiry(token: string): number {
    const exp = this.parseToken(token)?.exp;
    if (typeof exp !== 'number') return Infinity;
    return exp - Date.now() / 1000;
  }

  isTokenExpired(token: string): boolean {
    return this.secondsUntilExpiry(token) <= 0;
  }

  isTokenExpiringSoon(token: string): boolean {
    return this.secondsUntilExpiry(token) <= this.config.refreshThreshold;
  }

  /** A token exists and has not expired. Opaque tokens count as valid. */
  isAuthenticated(): boolean {
    const token = this.getAccessToken();
    return token !== null && !this.isTokenExpired(token);
  }

  /** Return a usable token, refreshing first if it is about to expire. */
  async ensureValidToken(): Promise<string | null> {
    const token = this.getAccessToken();
    if (!token) return null;
    if (!this.isTokenExpiringSoon(token)) return token;
    const refreshed = await this.refreshAccessToken();
    if (refreshed) return this.getAccessToken();
    // The session ended (tokens were cleared): no token.
    if (this.getAccessToken() !== token) return this.getAccessToken();
    // Refresh failed for a transient reason: keep using the old token while it is still valid.
    return this.isTokenExpired(token) ? null : token;
  }

  // ── Refresh ──────────────────────────────────────────────────────────────

  /** Refresh the access token. Concurrent calls share one request. */
  refreshAccessToken(): Promise<boolean> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      if (this.getAccessToken()) this.expire();
      return false;
    }
    let response: Response;
    try {
      response = await this.fetchImpl()(this.resolveUrl(this.config.refreshUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: this.config.credentials,
        body: JSON.stringify({ [this.config.refreshBodyField]: refreshToken }),
      });
    } catch {
      return false; // offline: try again later
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      this.expire();
      return false;
    }
    if (!response.ok) return false;
    const tokens = await this.readTokens(response);
    if (!tokens) return false;
    this.setTokens(tokens.access, tokens.refresh);
    this.emit('refresh', undefined);
    return true;
  }

  private async readTokens(response: Response): Promise<{ access: string; refresh?: string } | null> {
    try {
      const body = await response.json();
      const access = getPath(body, this.config.tokenPaths?.accessToken ?? 'access_token');
      const refresh = getPath(body, this.config.tokenPaths?.refreshToken ?? 'refresh_token');
      if (typeof access !== 'string' || !access) return null;
      return { access, refresh: typeof refresh === 'string' ? refresh : undefined };
    } catch {
      return null;
    }
  }

  private expire(): void {
    this.clearTokens();
    this.emit('expired', undefined);
    this.config.onSessionExpired?.();
  }

  // ── Login / logout ───────────────────────────────────────────────────────

  /**
   * Post credentials to `loginUrl` and store the returned tokens.
   * Resolves to the response body on success, or `null` on failure.
   */
  async login<T = unknown>(credentials: Record<string, unknown>): Promise<T | null> {
    try {
      const response = await this.fetchImpl()(this.resolveUrl(this.config.loginUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: this.config.credentials,
        body: JSON.stringify(credentials),
      });
      if (!response.ok) return null;
      const clone = response.clone();
      const tokens = await this.readTokens(response);
      if (!tokens) return null;
      this.setTokens(tokens.access, tokens.refresh);
      this.emit('login', undefined);
      try {
        return (await clone.json()) as T;
      } catch {
        return {} as T;
      }
    } catch {
      return null;
    }
  }

  /**
   * Tell the server (if `logoutUrl` is set) and clear tokens. The refresh token
   * is sent in the body (under `refreshBodyField`) so the server can revoke it.
   */
  async logout(): Promise<void> {
    const token = this.getAccessToken();
    const refreshToken = this.getRefreshToken();
    if (this.config.logoutUrl) {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (refreshToken) headers['Content-Type'] = 'application/json';
      try {
        await this.fetchImpl()(this.resolveUrl(this.config.logoutUrl), {
          method: 'POST',
          credentials: this.config.credentials,
          headers,
          body: refreshToken ? JSON.stringify({ [this.config.refreshBodyField]: refreshToken }) : undefined,
        });
      } catch {
        /* the local logout still happens */
      }
    }
    this.clearTokens();
    this.emit('logout', undefined);
  }

  /** Remove listeners. */
  destroy(): void {
    if (this.storageListener) window.removeEventListener('storage', this.storageListener);
    this.storageListener = null;
    this.clear();
  }
}
