/**
 * Built-in mixins. Call `registerBuiltInMixins()` to use them by name; `import 'arethesis'` does.
 *
 * @module mixins
 */

import { mixinRegistry } from './registry';
import { draggableMixin } from './draggable';
import { editableMixin } from './editable';
import { gridNavigationMixin } from './grid-navigation';
import { infiniteScrollMixin } from './infinite-scroll';
import { sortableMixin } from './sortable';
import { resizableMixin } from './resizable';
import { dropdownMixin } from './dropdown';
import { tooltipMixin } from './tooltip';
import { contextMenuMixin } from './context-menu';
import { listboxMixin } from './listbox';

/** Register the built-in mixins, for `data-mixin` (idempotent; `import 'arethesis'` does this). */
export function registerBuiltInMixins(): void {
  const all = {
    draggable: draggableMixin,
    editable: editableMixin,
    'grid-navigation': gridNavigationMixin,
    'infinite-scroll': infiniteScrollMixin,
    sortable: sortableMixin,
    resizable: resizableMixin,
    dropdown: dropdownMixin,
    tooltip: tooltipMixin,
    'context-menu': contextMenuMixin,
    listbox: listboxMixin,
  };
  for (const [name, fn] of Object.entries(all)) {
    if (!mixinRegistry.has(name)) mixinRegistry.register(name, fn as never);
  }
}

export * from './registry';
export { draggableMixin } from './draggable';
export { editableMixin } from './editable';
export { gridNavigationMixin } from './grid-navigation';
export { infiniteScrollMixin } from './infinite-scroll';
export { sortableMixin } from './sortable';
export { resizableMixin } from './resizable';
export { dropdownMixin } from './dropdown';
export { tooltipMixin } from './tooltip';
export { contextMenuMixin } from './context-menu';
export { listboxMixin } from './listbox';
export type { ListboxOption, ListboxOptions } from './listbox';
export type * from './types';
