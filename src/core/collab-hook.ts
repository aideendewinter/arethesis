/**
 * Lets `arethesis/collab` plug collaborative editing into `app.collab`
 * without the core importing it.
 *
 * @module core/collab-hook
 * @internal
 */

import type { CollabManager } from '../realtime/collab/collab-session';
import type { WebSocketManager } from '../realtime/websocket-manager';

export type CollabFactory = (ws: () => WebSocketManager | null) => CollabManager;

let factory: CollabFactory | null = null;

/** @internal */
export function setCollabFactory(next: CollabFactory): void {
  factory = next;
}

/** @internal */
export function getCollabFactory(): CollabFactory | null {
  return factory;
}
