/**
 * Allowlist HTML sanitizer.
 *
 * Parses into an inert document (scripts don't run, images don't load), keeps
 * only allowed tags and attributes, and cleans every URL. Used by the `html`
 * display type and the rich-text editor.
 *
 * @module utils/sanitize
 */

import { sanitizeUrl } from './url';

export interface SanitizeOptions {
  /** Allowed tag names (lowercase). */
  allowedTags?: Iterable<string>;
  /** Allowed attributes per tag; `'*'` applies to every tag. */
  allowedAttributes?: Record<string, string[]>;
}

const DEFAULT_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p',
  'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'u', 'ul',
];

const DEFAULT_ATTRIBUTES: Record<string, string[]> = {
  '*': ['class', 'title', 'lang', 'dir'],
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  ol: ['start'],
};

/** Elements removed together with their content. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math',
  'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'frame', 'frameset',
]);

/** Return sanitized HTML. */
export function sanitizeHtml(html: unknown, options: SanitizeOptions = {}): string {
  if (html === null || html === undefined) return '';
  const tags = new Set(options.allowedTags ?? DEFAULT_TAGS);
  const attrs = options.allowedAttributes ?? DEFAULT_ATTRIBUTES;
  const doc = new DOMParser().parseFromString(`<body>${String(html)}</body>`, 'text/html');
  cleanChildren(doc.body, tags, attrs);
  return doc.body.innerHTML;
}

function cleanChildren(parent: Element, tags: Set<string>, attrs: Record<string, string[]>): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
      node.remove();
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (DROP_WITH_CONTENT.has(tag)) {
      el.remove();
      continue;
    }
    cleanChildren(el, tags, attrs);
    if (!tags.has(tag)) {
      // Unwrap: keep the (already cleaned) children, drop the element.
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    cleanAttributes(el, tag, attrs);
  }
}

function cleanAttributes(el: Element, tag: string, attrs: Record<string, string[]>): void {
  const allowed = new Set([...(attrs['*'] ?? []), ...(attrs[tag] ?? [])]);
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (!allowed.has(name) || name.startsWith('on')) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'href') {
      const safe = sanitizeUrl(attr.value, 'link');
      if (safe) el.setAttribute('href', safe);
      else el.removeAttribute('href');
    } else if (name === 'src') {
      const safe = sanitizeUrl(attr.value, 'image');
      if (safe) el.setAttribute('src', safe);
      else el.removeAttribute('src');
    }
  }
  if (tag === 'a' && el.getAttribute('target') === '_blank') {
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

/** Plain text of an HTML string. */
export function htmlToText(html: unknown): string {
  if (html === null || html === undefined) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return doc.body.textContent ?? '';
}
