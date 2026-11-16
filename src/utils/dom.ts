/**
 * DOM helpers.
 *
 * @module utils/dom
 */

/** `CSS.escape` with a fallback for environments that lack it. */
export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/([^\w-])/g, '\\$1').replace(/^(\d)/, '\\3$1 ');
}

/** Convert `kebab-case` to `camelCase`. */
export function camelCase(value: string): string {
  return value.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

let idCounter = 0;
/** A document-unique id with a prefix. */
export function uniqueId(prefix = 'ar'): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}`;
}

/** Parse an HTML string into a DocumentFragment without executing scripts. */
export function parseHtml(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

/** Elements that can receive keyboard focus inside a root. */
export function focusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
  ));
}
