/**
 * Arethesis component kit: ready-made, accessible components built on the
 * framework. Import once to register every element, and include the theme:
 *
 * ```ts
 * import 'arethesis/components';
 * import 'arethesis/components/theme.css';
 * ```
 *
 * Or import only the elements you use, such as
 * `import 'arethesis/components/data-table'`.
 *
 * The theme is built from design tokens (W3C Design Tokens Format 2025.10),
 * published as `arethesis/tokens/*`. See `setTheme`, `setContrast` and
 * `themeBootHtml` for switching themes without a flash.
 *
 * @packageDocumentation
 */

import './elements/data-table';
import './elements/flex-view';
import './elements/list';
import './elements/form';
import './elements/chart';
import './elements/command-palette';
import './elements/sheet';
import './elements/markdown-editor';
import './elements/kanban';
import './elements/combobox';
import './elements/toast';

export { DataTable } from './data-table';
export type { DataTableColumn, DataTableConfig } from './data-table';
export { FlexView } from './flex-view';
export type { FlexPanelConfig, FlexViewConfig } from './flex-view';
export { List } from './list';
export { Form } from './form';
export { Chart, niceTicks } from './chart';
export type { ChartConfig, ChartRow, ChartSeries, ChartType, ChartX } from './chart';
export { CommandPalette, storeSource } from './command-palette';
export type { PaletteCommand, PaletteSource } from './command-palette';
export { Sheet } from './sheet/sheet';
export type { SheetConfig } from './sheet/sheet';
export { SheetModel } from './sheet/model';
export { parse as parseFormula, evaluate as evaluateFormula, shiftFormula, FormulaError, address, parseAddress, colName, colIndex } from './sheet/formula';
export type { CellValue, ErrorCode } from './sheet/formula';
export { openCellEditor } from './cell-editor';
export type { CellEditor, CellEditorOptions, CellMove, CellEditorType } from './cell-editor';
export { Combobox } from './combobox';
export type { ComboboxConfig, ComboboxOption, ComboboxSource } from './combobox';
export { Toaster, toast, connectToasts } from './toast';
export type { ToastOptions, ToastHandle, ToastKind, ConnectToastsOptions } from './toast';
export { Kanban } from './kanban';
export type { KanbanColumn, KanbanConfig } from './kanban';
export { MarkdownEditor } from './markdown-editor';
export type { MarkdownLayout, MarkdownMark } from './markdown-editor';
export { renderMarkdown, renderInline, markdownOutline } from './markdown/render';
export type { OutlineEntry } from './markdown/render';
export { highlightMarkdown, highlightLine, highlightInline } from './markdown/highlight';
export type { LineState } from './markdown/highlight';
export {
  setTheme,
  setContrast,
  getTheme,
  getContrast,
  applyStoredTheme,
  themeBootScript,
  themeBootHtml,
  CRITICAL_CSS,
  POLYCHROME_CRITICAL_CSS,
  THEME_STORAGE_KEY,
  CONTRAST_STORAGE_KEY,
} from './theme';
export type { ThemeChoice, ContrastChoice, ThemeStorageOptions } from './theme';
