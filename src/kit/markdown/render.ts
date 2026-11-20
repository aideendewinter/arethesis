/**
 * A small, safe Markdown renderer: the CommonMark core most documents use,
 * plus GFM tables, task lists and strikethrough.
 *
 * Supported: ATX headings, paragraphs and hard breaks, emphasis, strong,
 * `code`, fenced code blocks, block quotes, nested bulleted, numbered and
 * task lists, links, images, autolinks, horizontal rules, strikethrough and
 * pipe tables. Raw HTML is not supported: it's shown as text.
 *
 * Every piece of text is escaped, URLs go through `sanitizeUrl`, and the
 * result goes through `sanitizeHtml`, so the output is safe to insert.
 * Block elements carry `data-line` (the 0-based source line), so a preview
 * can be scrolled in step with the source.
 *
 * @module kit/markdown/render
 */

import { sanitizeHtml } from '../../utils/sanitize';
import { sanitizeUrl } from '../../utils/url';

const BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'];
const ALLOWED_TAGS = [...BLOCK_TAGS, 'a', 'img', 'em', 'strong', 'del', 'code', 'br', 'span'];
const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': ['class', 'data-line', 'title'],
  a: ['href'],
  img: ['src', 'alt'],
  ol: ['start'],
  span: ['role', 'aria-label', 'aria-checked'],
};

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── Inline ─────────────────────────────────────────────────────────────────

/** Render inline Markdown (already a single block's text) to HTML. */
export function renderInline(text: string): string {
  // Code spans and links are swapped for placeholders so their contents aren't parsed again.
  const held: string[] = [];
  const hold = (html: string): string => `\u0000${held.push(html) - 1}\u0000`;

  let s = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code: string) => hold(`<code>${escapeHtml(code.trim() || code)}</code>`));
  // Backslash escapes.
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, (_, ch: string) => hold(escapeHtml(ch)));
  // Images, then links: ![alt](src "title") and [text](href "title").
  s = s.replace(/!\[([^\]]*)\]\(\s*<?([^\s)>]*)>?(?:\s+"([^"]*)")?\s*\)/g, (_, alt: string, src: string, title?: string) => {
    const url = sanitizeUrl(src, 'image');
    return url ? hold(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`) : hold(escapeHtml(alt));
  });
  s = s.replace(/\[([^\]]+)\]\(\s*<?([^\s)>]*)>?(?:\s+"([^"]*)")?\s*\)/g, (_, label: string, href: string, title?: string) => {
    const url = sanitizeUrl(href);
    const inner = renderEmphasis(escapeHtml(label));
    return url ? hold(`<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${inner}</a>`) : hold(inner);
  });
  // Autolinks: <https://…>
  s = s.replace(/<((?:https?|mailto):[^\s<>]+)>/g, (_, href: string) => {
    const url = sanitizeUrl(href);
    return url ? hold(`<a href="${escapeHtml(url)}">${escapeHtml(href)}</a>`) : hold(escapeHtml(href));
  });
  s = renderEmphasis(escapeHtml(s));
  // Hard breaks: two trailing spaces or a backslash before a newline.
  s = s.replace(/(?: {2,}|\\)\n/g, '<br>');
  // Placeholders can be nested (a code span inside a link label): resolve until none are left.
  // eslint-disable-next-line no-control-regex
  const placeholder = /\u0000(\d+)\u0000/g;
  for (let round = 0; placeholder.test(s) && round < 10; round++) s = s.replace(placeholder, (_, i: string) => held[Number(i)]);
  return s;
}

function renderEmphasis(s: string): string {
  return s
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(^|[^\w*])\*(?=\S)([\s\S]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
}

// ── Blocks ─────────────────────────────────────────────────────────────────

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (line: string) => line.trim() === '';
const startsBlock = (line: string, next?: string) =>
  FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line) || (line.includes('|') && next !== undefined && TABLE_DIVIDER.test(next));

interface ListItem {
  indent: number;
  ordered: boolean;
  start: number;
  lines: string[];
  line: number;
}

function renderBlocks(lines: string[], offset: number): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const at = ` data-line="${offset + i}"`;
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) body.push(lines[j++]);
      out.push(`<pre${at}><code${fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
      i = j + 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}${at}>${renderInline(heading[2] ?? '')}</h${level}>`);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push(`<hr${at}>`);
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      let j = i;
      while (j < lines.length && (QUOTE.test(lines[j]) || (!isBlank(lines[j]) && !startsBlock(lines[j]) && body.length))) {
        body.push(lines[j].replace(QUOTE, ''));
        j++;
      }
      out.push(`<blockquote${at}>${renderBlocks(body, offset + i)}</blockquote>`);
      i = j;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const block: string[] = [];
      // A different marker (- vs *, 1. vs 1)) at the same depth starts a new list, as in CommonMark.
      const first = LIST_ITEM.exec(line)!;
      const markerKind = (m: RegExpExecArray) => m[2].replace(/\d+/, '1');
      const sameList = (l: string) => {
        const m = LIST_ITEM.exec(l);
        return !m || m[1].length > first[1].length + 1 || markerKind(m) === markerKind(first);
      };
      let j = i;
      // A list continues through indented lines and single blank lines followed by more list.
      while (j < lines.length) {
        const l = lines[j];
        if (!sameList(l)) break;
        if (LIST_ITEM.test(l) || (!isBlank(l) && /^\s+/.test(l)) || (!isBlank(l) && block.length && !startsBlock(l) && !isBlank(lines[j - 1]))) {
          block.push(l);
          j++;
        } else if (isBlank(l) && j + 1 < lines.length && ((LIST_ITEM.test(lines[j + 1]) && sameList(lines[j + 1])) || /^\s{2,}\S/.test(lines[j + 1]))) {
          block.push(l);
          j++;
        } else break;
      }
      out.push(renderList(block, offset + i));
      i = j;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const rows: string[] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && !isBlank(lines[j])) rows.push(lines[j++]);
      out.push(renderTable(line, lines[i + 1], rows, offset + i));
      i = j;
      continue;
    }
    // Paragraph: until a blank line or another block.
    const body = [line];
    let j = i + 1;
    while (j < lines.length && !isBlank(lines[j]) && !startsBlock(lines[j], lines[j + 1])) body.push(lines[j++]);
    out.push(`<p${at}>${renderInline(body.map(l => l.replace(/^\s+/, '')).join('\n'))}</p>`);
    i = j;
  }
  return out.join('');
}

function renderList(block: string[], offset: number): string {
  // Group lines into items: an item starts at a list marker no deeper than the first one.
  const first = LIST_ITEM.exec(block[0])!;
  const baseIndent = first[1].length;
  const items: ListItem[] = [];
  block.forEach((line, index) => {
    const m = LIST_ITEM.exec(line);
    if (m && m[1].length <= baseIndent + 1) {
      items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10) || 1, lines: [m[3]], line: offset + index });
    } else {
      // Continuation or nested content, de-indented relative to the item's text.
      items[items.length - 1].lines.push(line.replace(new RegExp(`^ {0,${baseIndent + 4}}`), ''));
    }
  });
  const ordered = items[0].ordered;
  const tag = ordered ? 'ol' : 'ul';
  const start = ordered && items[0].start !== 1 ? ` start="${items[0].start}"` : '';
  const tasks = items.some(item => /^\[[ xX]\]\s/.test(item.lines[0]));
  const html = items.map(item => {
    let text = item.lines[0];
    let check = '';
    const task = /^\[([ xX])\]\s+/.exec(text);
    if (task) {
      const done = task[1] !== ' ';
      check = `<span class="md-check${done ? ' is-checked' : ''}" role="img" aria-label="${done ? 'Done' : 'Not done'}"></span>`;
      text = text.slice(task[0].length);
    }
    const rest = item.lines.slice(1);
    const nested = rest.some(l => !isBlank(l)) ? renderBlocks(rest, item.line + 1) : '';
    return `<li data-line="${item.line}"${task ? ' class="md-task"' : ''}>${check}${renderInline(text)}${nested}</li>`;
  });
  return `<${tag} data-line="${offset}"${start}${tasks ? ' class="md-tasks"' : ''}>${html.join('')}</${tag}>`;
}

function splitRow(row: string): string[] {
  const cells = row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/);
  return cells.map(c => c.trim().replace(/\\\|/g, '|'));
}

function renderTable(header: string, divider: string, rows: string[], offset: number): string {
  const align = splitRow(divider).map(d => (d.startsWith(':') && d.endsWith(':') ? 'center' : d.endsWith(':') ? 'right' : d.startsWith(':') ? 'left' : ''));
  const cell = (tag: string, text: string, col: number) => `<${tag}${align[col] ? ` class="md-align-${align[col]}"` : ''}>${renderInline(text)}</${tag}>`;
  const head = splitRow(header).map((c, col) => cell('th', c, col)).join('');
  const body = rows.map((r, n) => `<tr data-line="${offset + 2 + n}">${splitRow(r).map((c, col) => cell('td', c, col)).join('')}</tr>`).join('');
  return `<table data-line="${offset}"><thead><tr>${head}</tr></thead>${body ? `<tbody>${body}</tbody>` : ''}</table>`;
}

/** Render Markdown to sanitized HTML. */
export function renderMarkdown(source: string): string {
  const html = renderBlocks(source.replace(/\r\n?/g, '\n').split('\n'), 0);
  return sanitizeHtml(html, { allowedTags: ALLOWED_TAGS, allowedAttributes: ALLOWED_ATTRIBUTES });
}

export interface OutlineEntry {
  level: number;
  text: string;
  /** 0-based source line. */
  line: number;
  /** Offset of the heading's first character in the source. */
  offset: number;
}

/** The ATX headings of a document (outside code blocks), for an outline. */
export function markdownOutline(source: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  let fence: string | null = null;
  let offset = 0;
  source.split('\n').forEach((line, index) => {
    const f = FENCE.exec(line);
    if (f && (!fence || line.trim().startsWith(fence))) fence = fence ? null : f[1];
    else if (!fence) {
      const h = HEADING.exec(line);
      if (h && h[2]) out.push({ level: h[1].length, text: h[2].replace(/[*_`~]/g, ''), line: index, offset });
    }
    offset += line.length + 1;
  });
  return out;
}
