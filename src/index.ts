/**
 * Arethesis: data-driven Light DOM Web Components.
 *
 * This entry is everything, with the defaults installed: the built-in mixins
 * and plugins are registered by name and `app.collab` is available. For a
 * smaller bundle, import from `arethesis/core` and add what you use.
 *
 * @packageDocumentation
 */

import './defaults';

export * from './core/index';
export * from './realtime/index';
export * from './collab/index';
export * from './mixins/index';

// Plugins
export { dateUtilsPlugin } from './plugins/date-utils';
export type { DatePickerOptions, DateRangeOptions } from './plugins/date-utils';
export { asyncValidatorsPlugin } from './plugins/async-validators';
export type { AsyncValidatorsOptions } from './plugins/async-validators';
export { richTextPlugin, richTextMixin } from './plugins/rich-text';
export type { RichTextOptions, RichTextCommand } from './plugins/rich-text';
