/**
 * Arethesis: data-driven Light DOM Web Components.
 *
 * @packageDocumentation
 */

// Core
export { Arethesis, getArethesis, defineType, defineEndpoint, VERSION } from './core/arethesis';
export type { ArethesisEvents } from './core/arethesis';
export type { ArethesisConfig } from './core/types';

// Data
export { ObjectStore } from './data/object-store';
export type { PersistenceHooks } from './data/object-store';
export { ListViewRegistry } from './data/list-view-registry';
export { OptimisticUpdateManager } from './data/optimistic-updates';
export type { OptimisticEvent, OptimisticKind, CreateOptions } from './data/optimistic-updates';
export { PersistenceManager } from './data/persistence-manager';
export type { PersistenceOptions } from './data/persistence-manager';
export type * from './data/types';

// HTTP
export { HttpClient } from './http/http-client';
export { HttpError } from './http/http-error';
export type { HttpErrorKind, HttpErrorDetails } from './http/http-error';
export { AuthManager } from './http/auth-manager';
export type { AuthEvents } from './http/auth-manager';
export type * from './http/types';

// Components
export { Component } from './components/component';
export { defineComponent, getComponentMetadata, COMPONENT_METADATA } from './components/decorators';
export { TemplateLoader, templateLoader } from './components/template-loader';
export type * from './components/types';

// Binding & validation
export { DataBinder, formatRelative, RelativeTimeTicker, relativeTimes } from './binding/data-binder';
export type { BindingHandle } from './binding/data-binder';
export { ValidationEngine } from './binding/validation-engine';
export type * from './binding/types';

// Real-time & collaboration
export { SSEManager } from './realtime/sse-manager';
export { WebSocketManager } from './realtime/websocket-manager';
export { AzurePubSubManager } from './realtime/azure-pubsub-manager';
export { TextOperation } from './realtime/ot/text-operation';
export type { OpComponent } from './realtime/ot/text-operation';
export { OTClient } from './realtime/ot/client';
export type { OTClientState, OTClientCallbacks } from './realtime/ot/client';
export { OTDocumentServer, CollabServer } from './realtime/ot/server';
export { CollabSession, CollabManager } from './realtime/collab/collab-session';
export type { CollabEvents, CollabOptions, CollabStatus } from './realtime/collab/collab-session';
export { TextareaAdapter } from './realtime/collab/textarea-adapter';
export type { EditorAdapter, CollabApplyDetail } from './realtime/collab/textarea-adapter';
export { CursorOverlay, caretCoordinates, rangeRects } from './realtime/collab/cursor-overlay';
export { UndoManager, caretAfter } from './realtime/collab/undo-manager';
export type { UndoManagerOptions } from './realtime/collab/undo-manager';
export { transformRange, mapRange } from './realtime/collab/anchors';
export type { TextRange } from './realtime/collab/anchors';
export type * from './realtime/types';

// Mixins
export * from './mixins/index';

// Plugins
export { PluginManager, registerBuiltInPlugin } from './plugins/plugin-manager';
export { dateUtilsPlugin } from './plugins/date-utils';
export type { DatePickerOptions, DateRangeOptions } from './plugins/date-utils';
export { asyncValidatorsPlugin } from './plugins/async-validators';
export type { AsyncValidatorsOptions } from './plugins/async-validators';
export { richTextPlugin, richTextMixin } from './plugins/rich-text';
export type { RichTextOptions, RichTextCommand } from './plugins/rich-text';
export type * from './plugins/types';

// Utilities
export { sanitizeHtml, htmlToText } from './utils/sanitize';
export type { SanitizeOptions } from './utils/sanitize';
export { sanitizeUrl } from './utils/url';
export { parseDate, formatDatePattern, toDateInputValue, toDateTimeInputValue } from './utils/dates';
export { getPath, setPath, deepMerge, deepEqual } from './utils/path';
export { Emitter } from './utils/emitter';
