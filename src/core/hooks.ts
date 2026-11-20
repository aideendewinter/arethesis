/**
 * Lets optional modules plug into the core without the core importing them:
 * `arethesis/realtime` provides the SSE, WebSocket and Azure Web PubSub
 * managers, and `arethesis/collab` provides `app.collab`. (`import 'arethesis'`
 * installs both.)
 *
 * They're installed by import rather than loaded with `import()` from
 * `init()`: an app that awaits `init()` at the top level of its entry module
 * would otherwise deadlock when the bundler puts shared code in that entry.
 *
 * @module core/hooks
 * @internal
 */

import type { CollabManager } from '../realtime/collab/collab-session';
import type { SSEManager } from '../realtime/sse-manager';
import type { WebSocketManager } from '../realtime/websocket-manager';
import type { AzurePubSubManager } from '../realtime/azure-pubsub-manager';

export type CollabFactory = (ws: () => WebSocketManager | null) => CollabManager;

export interface RealtimeClasses {
  SSEManager: typeof SSEManager;
  WebSocketManager: typeof WebSocketManager;
  AzurePubSubManager: typeof AzurePubSubManager;
}

let collabFactory: CollabFactory | null = null;
let realtime: RealtimeClasses | null = null;

/** @internal */
export function setCollabFactory(next: CollabFactory): void {
  collabFactory = next;
}

/** @internal */
export function getCollabFactory(): CollabFactory | null {
  return collabFactory;
}

/** @internal */
export function setRealtime(next: RealtimeClasses): void {
  realtime = next;
}

/** @internal */
export function getRealtime(feature: string): RealtimeClasses {
  if (!realtime) throw new Error(`\`${feature}\` needs the real-time managers. Add \`import 'arethesis/realtime'\` (\`import 'arethesis'\` includes them).`);
  return realtime;
}
