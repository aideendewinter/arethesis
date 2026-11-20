/**
 * The lean core: store, list views, HTTP, components, binding and utilities,
 * with nothing registered globally. Add what you use:
 *
 * ```ts
 * import { getArethesis, Component, defineComponent } from 'arethesis/core';
 * import { registerBuiltInMixins } from 'arethesis/mixins'; // for data-mixin
 * import 'arethesis/collab';                                  // for app.collab
 * ```
 *
 * Auth, persistence and real-time services are loaded on demand by
 * `app.init()` when they're configured.
 *
 * @packageDocumentation
 */

export { Arethesis, getArethesis, defineType, defineEndpoint, VERSION } from './arethesis';
export type { ArethesisEvents } from './arethesis';
export type { ArethesisConfig } from './types';

// Data
export { ObjectStore } from '../data/object-store';
export type { PersistenceHooks } from '../data/object-store';
export { ListViewRegistry } from '../data/list-view-registry';
export { OptimisticUpdateManager } from '../data/optimistic-updates';
export type { OptimisticEvent, OptimisticKind, CreateOptions } from '../data/optimistic-updates';
export { PersistenceManager } from '../data/persistence-manager';
export type { PersistenceOptions } from '../data/persistence-manager';
export type * from '../data/types';

// HTTP
export { HttpClient } from '../http/http-client';
export { HttpError } from '../http/http-error';
export type { HttpErrorKind, HttpErrorDetails } from '../http/http-error';
export { AuthManager } from '../http/auth-manager';
export type { AuthEvents } from '../http/auth-manager';
export type * from '../http/types';

// Components
export { Component } from '../components/component';
export { defineComponent, getComponentMetadata, COMPONENT_METADATA } from '../components/decorators';
export { TemplateLoader, templateLoader } from '../components/template-loader';
export type * from '../components/types';

// Binding & validation
export { DataBinder, formatRelative, RelativeTimeTicker, relativeTimes } from '../binding/data-binder';
export type { BindingHandle } from '../binding/data-binder';
export { ValidationEngine } from '../binding/validation-engine';
export type * from '../binding/types';

// Mixin registry and plugin manager (nothing registered)
export * from '../mixins/registry';
export type * from '../mixins/types';
export { PluginManager, registerBuiltInPlugin } from '../plugins/plugin-manager';
export type * from '../plugins/types';

// Utilities
export { sanitizeHtml, htmlToText } from '../utils/sanitize';
export type { SanitizeOptions } from '../utils/sanitize';
export { sanitizeUrl } from '../utils/url';
export { fuzzyMatch, fuzzyFilter } from '../utils/fuzzy';
export type { FuzzyMatch } from '../utils/fuzzy';
export { parseDate, formatDatePattern, toDateInputValue, toDateTimeInputValue } from '../utils/dates';
export { getPath, setPath, deepMerge, deepEqual } from '../utils/path';
export { Emitter } from '../utils/emitter';
