/**
 * The mock backend: a tiny REST + SSE + WebSocket server that runs in the
 * browser (inside a SharedWorker when available, so every tab talks to the
 * same "server").
 */

import { CollabServer } from '../../src/realtime/ot/server';
import type { CollabMessage } from '../../src/realtime/types';
import { generatePeople, generateTasks, INITIAL_DOC, rng, DEPARTMENTS, ROLES, type Person, type Task } from './data';

export interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ServerOutput {
  /** Push an SSE event to every stream (or one). */
  sse(event: string, data: unknown, streamId?: string): void;
  /** Send a WebSocket message to a socket. */
  ws(socketId: string, message: unknown): void;
}

const TAKEN_USERNAMES = new Set(['admin', 'root', 'alice', 'bob', 'test', 'arethesis']);
const DEMO_USER = { id: 'u1', name: 'Alice Hopper', email: 'alice@example.com' };

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** An unsigned, demo-only JWT. */
function makeToken(ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: DEMO_USER.id, name: DEMO_USER.name, iat: now, exp: now + ttlSeconds })}.demo`;
}

function tokenValid(header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  try {
    const payload = JSON.parse(atob(header.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export class MockServer {
  /** Simulated round-trip time in ms: an HTTP request takes about this long, a WebSocket or SSE message half of it. */
  latency = 250;
  failureRate = 0;
  offline = false;
  private people: Person[] = generatePeople(10_000);
  private peopleById = new Map(this.people.map(p => [String(p.id), p]));
  private tasks = new Map(generateTasks().map(t => [t.id, t]));
  private metrics = {
    revenue: { id: 'revenue', label: 'Revenue', value: 128_400, unit: 'currency', trend: 4.2, history: [] as number[] },
    users: { id: 'users', label: 'Active users', value: 8_412, unit: 'number', trend: 1.8, history: [] as number[] },
    orders: { id: 'orders', label: 'Orders', value: 1_294, unit: 'number', trend: -0.6, history: [] as number[] },
    conversion: { id: 'conversion', label: 'Conversion', value: 0.034, unit: 'percent', trend: 0.3, history: [] as number[] },
  };
  private activity: Array<{ id: number; message: string; user: string; at: string }> = [];
  /** Chart data for the dashboard: requests per second by channel, and orders by region. */
  private charts = {
    traffic: { id: 'traffic', points: [] as Array<{ x: number; web: number; mobile: number; api: number }> },
    regions: {
      id: 'regions',
      rows: ['Attica', 'Boeotia', 'Corinth', 'Ionia', 'Sicily'].map(x => ({ x, thisWeek: 0, lastWeek: 0 })),
    },
  };
  /**
   * Refresh tokens revoked by signing out. Tokens are otherwise self-contained,
   * so sessions survive the mock restarting (the browser stops its shared worker
   * when the last tab closes). Revocations last only while the mock runs.
   */
  private revoked = new Set<string>();
  private random = rng(99);
  private collab: CollabServer;
  private teammates: ReturnType<typeof setInterval> | null = null;
  private taskCounter = 100;

  constructor(private out: ServerOutput) {
    this.collab = new CollabServer((clientId, message) => out.ws(clientId, message), () => INITIAL_DOC);
    for (const m of Object.values(this.metrics)) {
      let v = m.value;
      for (let i = 0; i < 24; i++) {
        v = v * (1 + (this.random() - 0.48) * 0.04);
        m.history.push(m.unit === 'percent' ? Math.round(v * 10000) / 10000 : Math.round(v));
      }
    }
    for (let i = 0; i < 200; i++) this.activity.push(this.makeActivity(i, Date.now() - i * 7 * 60_000));
    const now = Date.now();
    for (let i = 40; i > 0; i--) this.charts.traffic.points.push(this.trafficPoint(now - i * 2000, this.charts.traffic.points.at(-1)));
    for (const r of this.charts.regions.rows) {
      r.lastWeek = Math.round(80 + this.random() * 220);
      r.thisWeek = Math.round(r.lastWeek * (0.8 + this.random() * 0.45));
    }
    // Live metrics for the dashboard.
    setInterval(() => this.tickMetrics(), 2000);
  }

  private makeActivity(id: number, at: number) {
    const people = ['Alice', 'Bob', 'Carol', 'Dave', 'Earnest', 'Forrest', 'Garth'];
    const verbs = ['closed an order', 'invited a teammate', 'updated a dashboard', 'shipped a release', 'resolved a ticket', 'started a trial', 'left a comment'];
    return { id, user: people[id % people.length], message: verbs[(id * 3 + Math.floor(id / 7)) % verbs.length], at: new Date(at).toISOString() };
  }

  private trafficPoint(x: number, prev?: { web: number; mobile: number; api: number }) {
    const walk = (v: number, base: number) => Math.max(5, Math.round(v + (this.random() - 0.5) * base * 0.18 + (base - v) * 0.08));
    return { x, web: walk(prev?.web ?? 420, 420), mobile: walk(prev?.mobile ?? 260, 260), api: walk(prev?.api ?? 150, 150) };
  }

  private tickMetrics(): void {
    const traffic = this.charts.traffic;
    traffic.points = [...traffic.points.slice(-39), this.trafficPoint(Date.now(), traffic.points.at(-1))];
    this.out.sse('upsert', { type: 'Chart', data: { ...traffic } });
    if (this.random() < 0.5) {
      const r = this.charts.regions.rows[Math.floor(this.random() * this.charts.regions.rows.length)];
      r.thisWeek += Math.round(1 + this.random() * 6);
      this.out.sse('upsert', { type: 'Chart', data: { id: 'regions', rows: this.charts.regions.rows.map(row => ({ ...row })) } });
    }
    for (const m of Object.values(this.metrics)) {
      const change = (this.random() - 0.47) * (m.unit === 'percent' ? 0.002 : m.value * 0.01);
      m.value = m.unit === 'percent' ? Math.max(0.01, Math.round((m.value + change) * 10000) / 10000) : Math.max(0, Math.round(m.value + change));
      m.trend = Math.round((m.trend + (this.random() - 0.5) * 0.4) * 10) / 10;
      m.history = [...m.history.slice(-23), m.value];
      this.out.sse('upsert', { type: 'Metric', data: { ...m } });
    }
    if (this.random() < 0.35) {
      const item = this.makeActivity(this.activity.length + 1000, Date.now());
      this.activity.unshift(item);
      this.out.sse('activity', item);
    }
  }

  /** Toggle simulated edits by "teammates" in the directory. */
  setTeammates(on: boolean): void {
    if (this.teammates) clearInterval(this.teammates);
    this.teammates = null;
    if (!on) return;
    this.teammates = setInterval(() => {
      const person = this.people[Math.floor(this.random() * 40)];
      person.role = ROLES[Math.floor(this.random() * ROLES.length)];
      person.department = DEPARTMENTS[Math.floor(this.random() * DEPARTMENTS.length)];
      person.salary += Math.round((this.random() - 0.3) * 10) * 500;
      person.updatedAt = new Date().toISOString();
      this.out.sse('upsert', { type: 'Person', data: { ...person }, by: 'teammate' });
    }, 1500);
  }

  async handle(req: MockRequest): Promise<MockResponse> {
    await new Promise(r => setTimeout(r, this.latency * (0.6 + Math.random() * 0.8)));
    if (this.offline) return { status: 0 };
    const url = new URL(req.url, 'https://mock.local');
    const path = url.pathname.replace(/^\/api/, '');
    const isWrite = req.method !== 'GET';
    if (isWrite && this.failureRate > 0 && Math.random() < this.failureRate) {
      return { status: 503, body: { message: 'The server is having a moment (simulated failure).' } };
    }
    const body = req.body ? JSON.parse(req.body) : undefined;
    try {
      return this.route(req.method, path, url.searchParams, body, req.headers);
    } catch (err) {
      return { status: 500, body: { message: String(err) } };
    }
  }

  private route(method: string, path: string, q: URLSearchParams, body: Record<string, unknown> | undefined, headers: Record<string, string>): MockResponse {
    let m: RegExpExecArray | null;

    // ── People ─────────────────────────────────────────────
    if (method === 'GET' && path === '/people') {
      let list = this.people;
      const search = q.get('q')?.toLowerCase().trim();
      if (search) list = list.filter(p => p.name.toLowerCase().includes(search) || p.email.includes(search));
      const dept = q.get('department');
      if (dept) list = list.filter(p => p.department === dept);
      const role = q.get('role');
      if (role) list = list.filter(p => p.role === role);
      const sort = q.get('sort');
      if (sort) {
        const [field, dir] = sort.split(',')[0].split(':') as [keyof Person, string];
        list = [...list].sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      const limit = Math.min(Number(q.get('limit')) || 50, 200);
      const offset = Number(q.get('cursor') ?? 0);
      const page = list.slice(offset, offset + limit);
      return { status: 200, body: { data: page, meta: { total: list.length, next: offset + limit < list.length ? String(offset + limit) : null } } };
    }
    if ((m = /^\/people\/(\d+)$/.exec(path))) {
      const person = this.peopleById.get(m[1]);
      if (!person) return { status: 404, body: { message: 'Not found' } };
      if (method === 'GET') return { status: 200, body: person };
      if (method === 'PATCH') {
        if (typeof body?.name === 'string' && body.name.trim().length < 2) return { status: 422, body: { errors: { name: 'Name is too short' } } };
        Object.assign(person, body, { updatedAt: new Date().toISOString() });
        this.out.sse('upsert', { type: 'Person', data: { ...person } });
        return { status: 200, body: person };
      }
    }

    // ── Tasks ──────────────────────────────────────────────
    if (path === '/tasks' && method === 'GET') return { status: 200, body: [...this.tasks.values()] };
    if (path === '/tasks' && method === 'POST') {
      const task: Task = { id: `t${++this.taskCounter}`, title: String(body?.title ?? 'Untitled'), status: (body?.status as Task['status']) ?? 'backlog', order: Number(body?.order ?? 0), label: (body?.label as Task['label']) ?? 'feature', assignee: String(body?.assignee ?? 'Alice'), updatedAt: new Date().toISOString() };
      this.tasks.set(task.id, task);
      this.out.sse('upsert', { type: 'Task', data: task });
      return { status: 201, body: task };
    }
    if ((m = /^\/tasks\/(\w+)$/.exec(path))) {
      const task = this.tasks.get(m[1]);
      if (!task) return { status: 404, body: { message: 'Not found' } };
      if (method === 'PATCH') {
        Object.assign(task, body, { updatedAt: new Date().toISOString() });
        this.out.sse('upsert', { type: 'Task', data: task });
        return { status: 200, body: task };
      }
      if (method === 'DELETE') {
        this.tasks.delete(task.id);
        this.out.sse('delete', { type: 'Task', id: task.id });
        return { status: 204 };
      }
    }

    // ── Dashboard ──────────────────────────────────────────
    if ((m = /^\/charts\/(\w+)$/.exec(path)) && method === 'GET') {
      const chart = this.charts[m[1] as keyof typeof this.charts];
      return chart ? { status: 200, body: chart } : { status: 404 };
    }
    if ((m = /^\/metrics\/(\w+)$/.exec(path)) && method === 'GET') {
      const metric = this.metrics[m[1] as keyof typeof this.metrics];
      return metric ? { status: 200, body: metric } : { status: 404 };
    }
    if (path === '/activity' && method === 'GET') {
      const limit = Number(q.get('limit')) || 20;
      const offset = Number(q.get('cursor') ?? 0);
      return { status: 200, body: { items: this.activity.slice(offset, offset + limit), next: offset + limit < this.activity.length ? String(offset + limit) : null } };
    }

    // ── Signup ─────────────────────────────────────────────
    if (path === '/check-username' && method === 'GET') {
      return { status: 200, body: { available: !TAKEN_USERNAMES.has((q.get('username') ?? '').toLowerCase()) } };
    }
    if (path === '/accounts' && method === 'POST') {
      const email = String(body?.email ?? '');
      if (email.endsWith('@example.com')) return { status: 422, body: { errors: { email: 'example.com addresses can’t receive mail. Use a real address.' } } };
      if (TAKEN_USERNAMES.has(String(body?.username ?? '').toLowerCase())) return { status: 422, body: { errors: { username: 'Someone just took that username.' } } };
      return { status: 201, body: { id: Math.floor(Math.random() * 1e6), ...body, password: undefined, confirm: undefined } };
    }

    // ── Auth ───────────────────────────────────────────────
    if (path === '/auth/login' && method === 'POST') {
      if (body?.email !== DEMO_USER.email || body?.password !== 'arethesis') return { status: 401, body: { message: 'Wrong email or password' } };
      const ttl = Number(body?.ttl) || 60;
      // Like a signed token, it carries what the server needs: the user and the access-token lifetime.
      const refresh = `refresh.${DEMO_USER.id}.${ttl}.${Math.random().toString(36).slice(2)}`;
      return { status: 200, body: { access_token: makeToken(ttl), refresh_token: refresh, user: DEMO_USER } };
    }
    if (path === '/auth/refresh' && method === 'POST') {
      const refresh = String(body?.refresh_token ?? '');
      const [kind, user, ttl] = refresh.split('.');
      if (kind !== 'refresh' || user !== DEMO_USER.id || this.revoked.has(refresh)) return { status: 401, body: { message: 'Session expired' } };
      return { status: 200, body: { access_token: makeToken(Number(ttl) || 60) } };
    }
    if (path === '/auth/logout' && method === 'POST') {
      const refresh = String(body?.refresh_token ?? '');
      if (refresh) this.revoked.add(refresh);
      return { status: 204 };
    }
    if (path === '/me' && method === 'GET') {
      if (!tokenValid(headers.Authorization ?? headers.authorization)) return { status: 401, body: { message: 'Not signed in' } };
      return { status: 200, body: { ...DEMO_USER, lastSeen: new Date().toISOString() } };
    }
    if (path === '/notes' && method === 'GET') {
      if (!tokenValid(headers.Authorization ?? headers.authorization)) return { status: 401 };
      return { status: 200, body: [1, 2, 3, 4, 5].map(i => ({ id: i, title: `Private note ${i}`, body: 'Only visible when signed in.', updatedAt: new Date().toISOString() })) };
    }

    return { status: 404, body: { message: `No route for ${method} ${path}` } };
  }

  /** A WebSocket message from a client. */
  socketMessage(socketId: string, raw: string): void {
    let message: CollabMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type?.startsWith('collab:')) this.collab.handle(socketId, message);
    else if ((message.type as string) === 'ping') this.out.ws(socketId, { type: 'pong' });
  }

  socketClosed(socketId: string): void {
    this.collab.disconnect(socketId);
  }

  control(command: { latency?: number; failureRate?: number; offline?: boolean; teammates?: boolean }): void {
    if (command.latency !== undefined) this.latency = command.latency;
    if (command.failureRate !== undefined) this.failureRate = command.failureRate;
    if (command.offline !== undefined) this.offline = command.offline;
    if (command.teammates !== undefined) this.setTeammates(command.teammates);
  }
}
