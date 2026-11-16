/**
 * Mixin types.
 *
 * @module mixins/types
 */

/** A mixin applied to one element. */
export interface MixinInstance {
  name: string;
  element: HTMLElement;
  options: Record<string, unknown>;
  /** Remove listeners and generated DOM. */
  destroy(): void;
  /** Extra methods exposed by the mixin (e.g. `open()`, `reset()`). */
  [method: string]: unknown;
}

export type MixinFunction<O = Record<string, unknown>> = (element: HTMLElement, options: O) => MixinInstance;

export interface MixinDefinition<O = Record<string, unknown>> {
  fn: MixinFunction<O>;
  /** Mixins applied first (with default options) if missing. */
  dependencies?: string[];
  /** Mixins that cannot be combined with this one on the same element. */
  conflicts?: string[];
}

export interface Point {
  x: number;
  y: number;
}

export interface DraggableOptions {
  /** Selector for a drag handle inside the element. */
  handle?: string;
  axis?: 'x' | 'y' | 'both';
  /** Keep the element inside `'parent'`, `'window'`, a selector, or an element. */
  containment?: 'parent' | 'window' | string | HTMLElement;
  /** Snap to a grid `[x, y]` in px. */
  grid?: [number, number];
  /** Arrow-key step in px when focused. @default 10 */
  keyboardStep?: number;
  onStart?: (detail: DragDetail) => void;
  onDrag?: (detail: DragDetail) => void;
  onEnd?: (detail: DragDetail) => void;
}

export interface DragDetail {
  /** Total offset from the original position. */
  x: number;
  y: number;
  /** Offset during this drag. */
  dx: number;
  dy: number;
}

export interface EditableOptions {
  type?: 'text' | 'textarea' | 'number' | 'date' | 'email' | 'url' | 'select';
  /** Options for `type: 'select'`. */
  choices?: Array<string | { value: string; label: string }>;
  placeholder?: string;
  /** Return `true`, or an error message. */
  validate?: (value: string) => true | string | Promise<true | string>;
  /** Save when focus leaves the input. @default true */
  saveOnBlur?: boolean;
  /** Called with the new value; throwing (or rejecting) restores the previous text. */
  onSave?: (value: string, element: HTMLElement) => void | Promise<void>;
  onCancel?: (element: HTMLElement) => void;
  /** Accessible label for the input. @default the element's aria-label, or 'Edit' */
  label?: string;
}

export interface GridNavigationOptions {
  cellSelector?: string;
  rowSelector?: string;
  /** Arrow keys wrap around at the edges. @default false */
  wrap?: boolean;
  /** `'exit'` (default): Tab leaves the grid. `'cells'`: Tab moves between cells. */
  tabBehavior?: 'exit' | 'cells';
  /** Rows moved by PageUp/PageDown. @default 10 */
  pageSize?: number;
  onNavigate?: (cell: HTMLElement, direction: string) => void;
  onEdit?: (cell: HTMLElement, key?: string) => void;
}

export interface InfiniteScrollOptions {
  /** Load when the end is within this many px. @default 300 */
  threshold?: number;
  /** Scroll root: the element itself, the viewport, or a selector. @default auto */
  root?: 'self' | 'viewport' | string;
  /** Selector for an existing sentinel element. */
  sentinel?: string;
  /** Load the next page. */
  loadMore?: () => Promise<unknown> | unknown;
  /** Whether more pages exist. @default always true (or the ListView's hasMore) */
  hasMore?: () => boolean;
  /** Id of a ListView to page through (instead of `loadMore`). */
  view?: string;
}

export interface SortableOptions {
  /** Selector for sortable items (direct children by default). */
  items?: string;
  handle?: string;
  /** Containers sharing a group accept each other's items. */
  group?: string;
  /** Layout direction. @default auto-detected */
  direction?: 'vertical' | 'horizontal';
  /** Class on the dragged item. @default 'is-sorting' */
  draggingClass?: string;
  /** Class on the drop placeholder. @default 'sortable-placeholder' */
  placeholderClass?: string;
  /** Duration (ms) of the slide and drop animations; 0 turns them off. Reduced motion always turns them off. @default 180 */
  animation?: number;
  /** Pixels a mouse or pen must move before a drag starts, so clicks still work. @default 5 */
  activationDistance?: number;
  /** On touch screens, how long (ms) to press before a drag starts, so swiping still scrolls. @default 200 */
  touchDelay?: number;
  /** Scroll containers and the page when dragging near their edges. @default true */
  autoScroll?: boolean;
  onEnd?: (detail: SortDetail) => void;
}

export interface SortDetail {
  item: HTMLElement;
  /** `data-id` of the item, if present. */
  id: string | null;
  from: HTMLElement;
  to: HTMLElement;
  oldIndex: number;
  newIndex: number;
}

export interface ResizableOptions {
  /** Edges/corners with handles. @default ['e', 's', 'se'] */
  handles?: Array<'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'>;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Arrow-key step in px. @default 10 */
  keyboardStep?: number;
  onResize?: (size: { width: number; height: number }) => void;
  onEnd?: (size: { width: number; height: number }) => void;
}

export interface DropdownOptions {
  /** Filter options as the user types. @default true */
  searchable?: boolean;
  placeholder?: string;
  /** Text when nothing matches. @default 'No matches' */
  emptyText?: string;
  onChange?: (value: string) => void;
}

export interface TooltipOptions {
  /** Text (defaults to `data-tooltip`, then `title`). */
  content?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Show delay in ms. @default 300 */
  delay?: number;
}

export interface ContextMenuItem {
  label?: string;
  /** Action name reported in `context-menu:select`. */
  action?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

export interface ContextMenuOptions {
  items?: ContextMenuItem[];
  /** Selector for elements inside the host that open the menu. @default the host */
  target?: string;
  onSelect?: (action: string, target: HTMLElement) => void;
}
