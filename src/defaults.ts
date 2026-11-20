/**
 * Installs the defaults that `import 'arethesis'` has always provided: the
 * built-in mixins (for `data-mixin`), the built-in plugins (by name), the
 * real-time managers and `app.collab`. `arethesis/core` leaves them out.
 *
 * @module defaults
 * @internal
 */

import { registerBuiltInMixins } from './mixins/index';
import { registerBuiltInPlugins } from './plugins/builtins';
import './realtime/index';
import './collab/index';

registerBuiltInMixins();
registerBuiltInPlugins();
