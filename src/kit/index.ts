/**
 * Arethesis component kit: ready-made, accessible components built on the
 * framework. Import once to register the elements, and include the theme:
 *
 * ```ts
 * import 'arethesis/components';
 * import 'arethesis/components/theme.css';
 * ```
 *
 * The theme is built from design tokens (W3C Design Tokens Format 2025.10),
 * published as `arethesis/tokens/*`. See `setTheme`, `setContrast` and
 * `themeBootHtml` for switching themes without a flash.
 *
 * @packageDocumentation
 */

export { DataTable } from './data-table';
export type { DataTableColumn, DataTableConfig } from './data-table';
export { FlexView } from './flex-view';
export type { FlexPanelConfig, FlexViewConfig } from './flex-view';
export { List } from './list';
export { Form } from './form';
export { Chart, niceTicks } from './chart';
export type { ChartConfig, ChartRow, ChartSeries, ChartType, ChartX } from './chart';
export { openCellEditor } from './cell-editor';
export type { CellEditor, CellEditorOptions, CellMove, CellEditorType } from './cell-editor';
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
