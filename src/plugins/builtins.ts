/**
 * Registers the built-in plugins so they can be referenced by name.
 *
 * @module plugins/builtins
 * @internal
 */

import { registerBuiltInPlugin } from './plugin-manager';
import { dateUtilsPlugin } from './date-utils';
import { asyncValidatorsPlugin } from './async-validators';
import { richTextPlugin } from './rich-text';

/** Make the built-in plugins loadable by name (called by Arethesis). */
export function registerBuiltInPlugins(): void {
  registerBuiltInPlugin('date-utils', dateUtilsPlugin);
  registerBuiltInPlugin('async-validators', asyncValidatorsPlugin);
  registerBuiltInPlugin('rich-text', richTextPlugin);
}

registerBuiltInPlugins();
