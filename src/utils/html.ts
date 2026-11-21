/**
 * `html`: a template tag that escapes what you put in it.
 *
 * ```ts
 * setHtml(list, html`<ul>${items.map(i => html`<li data-id="${i.id}">${i.title}</li>`)}</ul>`);
 * ```
 *
 * - Values are escaped. Nested `html` results and arrays of them are kept
 *   as markup; `null`, `undefined` and `false` render as nothing.
 * - Where escaping can't make a value safe, it throws: in an unquoted
 *   attribute, between attributes, in an `on…` handler, or inside
 *   `<script>` or `<style>`.
 * - A value that starts a URL attribute (`href`, `src`, `action`, …) must be
 *   a safe URL; `javascript:` and the like become `about:invalid`.
 *
 * `unsafeHtml(s)` marks a string you trust as markup. For HTML from users,
 * use {@link sanitizeHtml} instead.
 *
 * @module utils/html
 */

import { sanitizeUrl } from './url';

const BRAND = Symbol('arethesis.html');

/** Markup made by {@link html} or {@link unsafeHtml}. */
export interface SafeHtml {
  readonly [BRAND]: true;
  toString(): string;
}

class Markup implements SafeHtml {
  readonly [BRAND] = true as const;
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** True for markup made by {@link html} or {@link unsafeHtml}. */
export function isSafeHtml(value: unknown): value is SafeHtml {
  return value instanceof Markup;
}

/** Mark a trusted string as markup, so `html` inserts it as-is. */
export function unsafeHtml(markup: string): SafeHtml {
  return new Markup(String(markup));
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for HTML (content or a quoted attribute). */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, c => ESCAPES[c]);
}

/** Set an element's content from {@link html} markup. */
export function setHtml(element: Element, markup: SafeHtml): void {
  element.innerHTML = markup.toString();
}

type Context =
  | { kind: 'text' }
  | { kind: 'attr'; name: string; atStart: boolean; listStart: boolean }
  | { kind: 'error'; reason: string };

const LINK_ATTRS = new Set(['href', 'action', 'formaction', 'xlink:href', 'cite', 'data', 'ping']);
const IMAGE_ATTRS = new Set(['src', 'srcset', 'poster']);

type State = 'text' | 'tagName' | 'endTag' | 'tag' | 'attrName' | 'afterName' | 'beforeValue' | 'dq' | 'sq' | 'unquoted' | 'raw' | 'comment';

/**
 * Where each hole of a template falls. The static parts are scanned once
 * (holes count as a neutral character) and the result is cached per call site.
 */
function scan(strings: readonly string[]): Context[] {
  const contexts: Context[] = [];
  let state: State = 'text';
  let tagName = '';
  let attr = '';
  let value = '';
  let rawEnd = '';

  for (let part = 0; part < strings.length; part++) {
    const s = strings[part];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      switch (state) {
        case 'text':
          if (c === '<') {
            if (s.startsWith('!--', i + 1)) {
              state = 'comment';
              i += 3;
            } else if (s[i + 1] === '/') {
              state = 'endTag';
              i++;
            } else if (/[a-z]/i.test(s[i + 1] ?? '')) {
              state = 'tagName';
              tagName = '';
            }
          }
          break;
        case 'comment':
          if (s.startsWith('-->', i)) {
            state = 'text';
            i += 2;
          }
          break;
        case 'endTag':
          if (c === '>') state = 'text';
          break;
        case 'raw':
          if (s.slice(i, i + rawEnd.length).toLowerCase() === rawEnd) {
            state = 'endTag';
            i += rawEnd.length - 1;
          }
          break;
        case 'tagName':
          if (/[\s/]/.test(c)) state = 'tag';
          else if (c === '>') state = enterContent(tagName);
          else tagName += c.toLowerCase();
          break;
        case 'tag':
          if (c === '>') state = enterContent(tagName);
          else if (!/[\s/]/.test(c)) {
            state = 'attrName';
            attr = c.toLowerCase();
          }
          break;
        case 'attrName':
          if (c === '=') state = 'beforeValue';
          else if (/\s/.test(c)) state = 'afterName';
          else if (c === '>') state = enterContent(tagName);
          else if (c === '/') state = 'tag';
          else attr += c.toLowerCase();
          break;
        case 'afterName':
          if (c === '=') state = 'beforeValue';
          else if (c === '>') state = enterContent(tagName);
          else if (!/\s/.test(c)) {
            state = 'attrName';
            attr = c.toLowerCase();
          }
          break;
        case 'beforeValue':
          value = '';
          if (c === '"') state = 'dq';
          else if (c === "'") state = 'sq';
          else if (c === '>') state = enterContent(tagName);
          else if (!/\s/.test(c)) {
            state = 'unquoted';
            value = c;
          }
          break;
        case 'dq':
        case 'sq':
          if (c === (state === 'dq' ? '"' : "'")) state = 'tag';
          else value += c;
          break;
        case 'unquoted':
          if (/\s/.test(c)) state = 'tag';
          else if (c === '>') state = enterContent(tagName);
          else value += c;
          break;
      }
    }
    if (part === strings.length - 1) break;
    contexts.push(contextFor(state, attr, value, tagName));
    // The hole itself counts as one character of whatever came before.
    if (state === 'dq' || state === 'sq' || state === 'unquoted') value += 'x';
  }
  return contexts;

  function enterContent(tag: string): State {
    if (tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'title') {
      rawEnd = `</${tag}`;
      return 'raw';
    }
    return 'text';
  }
}

function contextFor(state: State, attr: string, value: string, tag: string): Context {
  switch (state) {
    case 'text':
    case 'comment':
      return { kind: 'text' };
    case 'raw':
      return tag === 'textarea' || tag === 'title'
        ? { kind: 'text' }
        : { kind: 'error', reason: `inside <${tag}>` };
    case 'dq':
    case 'sq':
      if (attr.startsWith('on')) return { kind: 'error', reason: `in the ${attr} handler` };
      return { kind: 'attr', name: attr, atStart: value.trim() === '', listStart: /(^|,)\s*$/.test(value) };
    case 'beforeValue':
    case 'unquoted':
      return { kind: 'error', reason: `in the unquoted ${attr} attribute (add quotes)` };
    default:
      return { kind: 'error', reason: 'inside a tag, outside an attribute value' };
  }
}

const cache = new WeakMap<readonly string[], Context[]>();

function render(value: unknown, context: Context & { kind: 'text' | 'attr' }): string {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(v => render(v, context)).join('');
  if (context.kind === 'text') return isSafeHtml(value) ? value.toString() : escapeHtml(value);
  let text = String(value);
  const { name } = context;
  if ((LINK_ATTRS.has(name) && context.atStart) || (IMAGE_ATTRS.has(name) && (name === 'srcset' ? context.listStart : context.atStart))) {
    text = sanitizeUrl(text, IMAGE_ATTRS.has(name) ? 'image' : 'link') || (text.trim() ? 'about:invalid' : '');
  }
  return escapeHtml(text);
}

/** Build markup from a template, escaping every value. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let contexts = cache.get(strings);
  if (!contexts) {
    contexts = scan(strings);
    cache.set(strings, contexts);
  }
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const context = contexts[i];
    if (context.kind === 'error') {
      throw new Error(`html: a value can't go ${context.reason}: …${strings[i].slice(-40)}\${…}`);
    }
    out += render(values[i], context) + strings[i + 1];
  }
  return new Markup(out);
}
