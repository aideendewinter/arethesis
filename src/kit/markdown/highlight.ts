/**
 * Markdown syntax highlighting for a source editor, one line at a time.
 *
 * The output's text is exactly the input's (only wrapped in spans), so it
 * can sit behind a transparent textarea and line up character for
 * character. Only colors and weights change, never widths, provided the
 * font is monospaced.
 *
 * Lines are highlighted independently given the state left by the previous
 * line (whether it's inside a fenced code block), so an editor only has to
 * re-highlight the lines that changed.
 *
 * @module kit/markdown/highlight
 */

export interface LineState {
  /** The opening fence (``` or ~~~…) while inside a code block. */
  fence: string | null;
}

export const START_STATE: LineState = { fence: null };

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, html: string): string => (html ? `<span class="${cls}">${html}</span>` : '');

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HEADING = /^( {0,3})(#{1,6})(\s.*|)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^( {0,3}>)( ?)(.*)$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\](?=\s))?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Inline tokens, longest first. Each alternative's whole match is one token. */
const INLINE = /(`+)[\s\S]*?\1|!?\[[^\]\n]*\]\([^)\n]*\)|<(?:https?|mailto):[^\s<>]+>|(\*\*|__)(?=\S)[\s\S]*?\S\2|~~(?=\S)[\s\S]*?\S~~|(?<![\w*])\*(?=\S)[^*\n]*?\S\*(?!\*)|(?<!\w)_(?=\S)[^_\n]*?\S_(?!\w)|\\[\\`*_{}[\]()#+\-.!~|<>]/g;

/** Highlight inline Markdown. */
export function highlightInline(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const t = m[0];
    out += esc(text.slice(last, m.index));
    last = m.index! + t.length;
    if (t.startsWith('`')) {
      const fence = m[1];
      out += span('md-code', span('md-punct', esc(fence)) + esc(t.slice(fence.length, -fence.length)) + span('md-punct', esc(fence)));
    } else if (t.startsWith('[') || t.startsWith('![')) {
      const close = t.indexOf('](');
      const open = t.startsWith('!') ? 2 : 1;
      out += span('md-link', span('md-punct', esc(t.slice(0, open))) + highlightInline(t.slice(open, close)) + span('md-punct', '](') + span('md-url', esc(t.slice(close + 2, -1))) + span('md-punct', ')'));
    } else if (t.startsWith('<')) {
      out += span('md-url', esc(t));
    } else if (t.startsWith('**') || t.startsWith('__')) {
      out += span('md-strong', span('md-punct', t.slice(0, 2)) + highlightInline(t.slice(2, -2)) + span('md-punct', t.slice(-2)));
    } else if (t.startsWith('~~')) {
      out += span('md-del', span('md-punct', '~~') + highlightInline(t.slice(2, -2)) + span('md-punct', '~~'));
    } else if (t.startsWith('\\')) {
      out += span('md-punct', esc(t));
    } else {
      out += span('md-em', span('md-punct', t[0]) + highlightInline(t.slice(1, -1)) + span('md-punct', t[0]));
    }
  }
  return out + esc(text.slice(last));
}

/** Highlight one line, given the state after the previous line. */
export function highlightLine(line: string, state: LineState): { html: string; state: LineState } {
  if (state.fence) {
    const close = FENCE.exec(line);
    if (close && close[2][0] === state.fence[0] && close[2].length >= state.fence.length && !close[3].trim()) {
      return { html: span('md-fence', esc(line)), state: START_STATE };
    }
    return { html: span('md-codeblock', esc(line)), state };
  }
  const fence = FENCE.exec(line);
  if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) {
    return { html: span('md-fence', esc(fence[1] + fence[2])) + span('md-lang', esc(fence[3])), state: { fence: fence[2] } };
  }
  const heading = HEADING.exec(line);
  if (heading) {
    const level = heading[2].length;
    return { html: span(`md-h md-h${level}`, esc(heading[1]) + span('md-punct', heading[2]) + highlightInline(heading[3])), state };
  }
  if (RULE.test(line)) return { html: span('md-hr', esc(line)), state };
  const quote = QUOTE.exec(line);
  if (quote) {
    // A quote can hold a list or heading: highlight the rest as its own line.
    const inner = highlightLine(quote[3], START_STATE).html;
    return { html: span('md-quote', span('md-punct', esc(quote[1])) + quote[2] + inner), state };
  }
  const list = LIST.exec(line);
  if (list) {
    const task = list[4] ? span(/x/i.test(list[4]) ? 'md-task is-done' : 'md-task', esc(list[4])) : '';
    return { html: esc(list[1]) + span('md-list', esc(list[2])) + list[3] + task + highlightInline(list[5]), state };
  }
  if (TABLE_DIVIDER.test(line) && line.includes('|')) return { html: span('md-punct', esc(line)), state };
  if (line.includes('|') && /^\s*\|/.test(line)) {
    return { html: line.split(/(?<!\\)(\|)/).map(part => (part === '|' ? span('md-punct', '|') : highlightInline(part))).join(''), state };
  }
  return { html: highlightInline(line), state };
}

/** Highlight a whole document; returns one HTML string per line. */
export function highlightMarkdown(source: string): string[] {
  let state = START_STATE;
  return source.split('\n').map(line => {
    const result = highlightLine(line, state);
    state = result.state;
    return result.html;
  });
}
