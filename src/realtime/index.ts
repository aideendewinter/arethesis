/**
 * Real-time transports and operational transformation. Importing this module
 * lets `app.init()` use the `sse`, `websocket` and `azurePubSub` options.
 *
 * @packageDocumentation
 */

import { SSEManager } from './sse-manager';
import { WebSocketManager } from './websocket-manager';
import { AzurePubSubManager } from './azure-pubsub-manager';
import { setRealtime } from '../core/hooks';

// Lets app.init() create these when `sse`, `websocket` or `azurePubSub` is configured.
setRealtime({ SSEManager, WebSocketManager, AzurePubSubManager });

export { SSEManager, WebSocketManager, AzurePubSubManager };
export { TextOperation } from './ot/text-operation';
export type { OpComponent } from './ot/text-operation';
export { OTClient } from './ot/client';
export type { OTClientState, OTClientCallbacks } from './ot/client';
export { OTDocumentServer, CollabServer } from './ot/server';
export type * from './types';
