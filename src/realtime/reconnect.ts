/**
 * Shared reconnect policy with exponential backoff and status tracking.
 *
 * @module realtime/reconnect
 * @internal
 */

import type { ConnectionStatus, ReconnectOptions } from './types';
import { computeBackoff } from '../utils/backoff';
import { Emitter } from '../utils/emitter';

export interface StatusEvents extends Record<string, unknown> {
  status: ConnectionStatus;
}

export class ReconnectPolicy extends Emitter<StatusEvents> {
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _status: ConnectionStatus = 'idle';

  constructor(private options: ReconnectOptions) {
    super();
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  set status(next: ConnectionStatus) {
    if (next === this._status) return;
    this._status = next;
    this.emit('status', next);
  }

  get attempt(): number {
    return this.attempts;
  }

  /** Call on a successful connection. */
  succeeded(): void {
    this.attempts = 0;
    this.status = 'open';
  }

  /** Schedule `connect` after a backoff; returns false if giving up. */
  schedule(connect: () => void): boolean {
    if (this.options.reconnect === false || this.attempts >= (this.options.maxReconnectAttempts ?? Infinity)) {
      this.status = 'closed';
      return false;
    }
    if (this.timer) return true;
    const delay = computeBackoff(this.attempts, {
      baseDelay: this.options.baseDelay ?? 1000,
      maxDelay: this.options.maxDelay ?? 30000,
      jitter: this.options.jitter ?? 0.3,
    });
    this.attempts++;
    this.status = 'reconnecting';
    this.timer = setTimeout(() => {
      this.timer = null;
      connect();
    }, delay);
    return true;
  }

  /** Cancel a pending reconnect and reset. */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.attempts = 0;
  }
}
