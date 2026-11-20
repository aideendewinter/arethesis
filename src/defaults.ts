/**
 * Installs the defaults that `import 'arethesis'` has always provided: the
 * built-in mixins (for `data-mixin`), the built-in plugins (by name) and
 * `app.collab`. `arethesis/core` leaves them out.
 *
 * @module defaults
 * @internal
 */

import { registerBuiltInMixins } from './mixins/index';
import { registerBuiltInPlugins } from './plugins/builtins';
import './collab/index';

registerBuiltInMixins();
registerBuiltInPlugins();
