/**
 * Framework configuration.
 *
 * @module core/types
 */

import type { AuthConfig, EndpointConfig, HttpConfig } from '../http/types';
import type { PersistenceOptions } from '../data/persistence-manager';
import type { TypeConfig } from '../data/types';
import type { AzurePubSubConfig, SSEConfig, WebSocketConfig } from '../realtime/types';
import type { PluginRef } from '../plugins/types';

export interface ArethesisConfig {
  /** HTTP client: `baseUrl`, headers, retries, timeouts, interceptors, batching. */
  http?: HttpConfig;
  /** JWT authentication with automatic refresh. */
  auth?: AuthConfig;
  /** IndexedDB persistence. `false` disables it. @default true */
  persistence?: boolean | PersistenceOptions;
  /** Server-Sent Events for cache invalidation. */
  sse?: SSEConfig;
  /** WebSocket for channels, presence and collaboration. */
  websocket?: WebSocketConfig;
  /** Azure Web PubSub. */
  azurePubSub?: AzurePubSubConfig;
  /** Override built-in validation messages, e.g. for translation. */
  validation?: { messages?: Record<string, string> };
  /** Plugins to install (objects, built-in names, or `{ plugin, options }`). */
  plugins?: PluginRef[];
  /** Types to register (same as calling `defineType`). */
  types?: TypeConfig[];
  /** Endpoints to register (same as calling `defineEndpoint`). */
  endpoints?: Record<string, EndpointConfig>;
  /** Connect SSE/WebSocket/PubSub at the end of `init()`. @default true */
  autoConnect?: boolean;
  /**
   * Apply `data-mixin` declarations in the document, and keep applying them to
   * elements added later. @default true
   */
  mixins?: boolean | { root?: Element | Document; observe?: boolean };
}
