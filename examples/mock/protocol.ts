/** Messages between pages and the mock server. */
import type { MockRequest } from './server';

export type ToServer =
  | { kind: 'fetch'; id: number; request: MockRequest }
  | { kind: 'sse-open'; streamId: string }
  | { kind: 'sse-close'; streamId: string }
  | { kind: 'ws-open'; socketId: string }
  | { kind: 'ws-send'; socketId: string; data: string }
  | { kind: 'ws-close'; socketId: string }
  | { kind: 'control'; command: Record<string, unknown> }
  | { kind: 'bye' };

export type ToPage =
  | { kind: 'response'; id: number; status: number; body?: unknown; headers?: Record<string, string> }
  | { kind: 'sse-open'; streamId: string }
  | { kind: 'sse'; streamId: string; event: string; data: string; id: string }
  | { kind: 'sse-error'; streamId: string }
  | { kind: 'ws-open'; socketId: string }
  | { kind: 'ws-message'; socketId: string; data: string }
  | { kind: 'ws-close'; socketId: string; code: number };

export interface Port {
  post(message: ToServer | ToPage): void;
  listen(handler: (message: ToServer | ToPage) => void): void;
}
