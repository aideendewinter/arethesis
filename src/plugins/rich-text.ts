/**
 * `rich-text` plugin: a small, dependency-free rich-text editor.
 *
 * Apply the `rich-text` mixin to a `<div>` (it becomes the editable area) or a
 * `<textarea>` (it is hidden and kept in sync, so forms submit the HTML).
 * Output is always sanitized: pasted content is cleaned, links are checked,
 * and only the allowed tags survive.
 *
 * - Toolbar: a WAI-ARIA toolbar (arrow keys move between buttons) whose
 *   buttons reflect the current formatting with `aria-pressed`.
 * - Shortcuts: Ctrl/Cmd + B, I, U, K (link), Shift+7/8 (lists).
 * - Events: `rich-text:change` `{ html, text }` plus a bubbling `input` event,
 *   so two-way binding (`inputType: 'rich-text'`) works.
 *
 * Validators: `richTextMinLength {min}`, `richTextMaxLength {max}`, `noEmptyParagraphs`.
 *
 * @module plugins/rich-text
 */

import type { ArethesisPlugin } from './types';
import { VERSION } from '../version';
import type { MixinInstance } from '../mixins/types';
import { htmlToText, sanitizeHtml, type SanitizeOptions } from '../utils/sanitize';
import { sanitizeUrl } from '../utils/url';
import { emit } from '../mixins/utils';
import { uniqueId } from '../utils/dom';

export type RichTextCommand =
  | 'bold' | 'italic' | 'underline' | 'strike' | 'h2' | 'h3' | 'paragraph'
  | 'bulletList' | 'orderedList' | 'blockquote' | 'code' | 'link' | 'clear' | 'undo' | 'redo';

export interface RichTextOptions {
  toolbar?: RichTextCommand[];
  placeholder?: string;
  /** Accessible name for the editor. */
  label?: string;
  sanitize?: SanitizeOptions;
}

const DEFAULT_TOOLBAR: RichTextCommand[] = ['bold', 'italic', 'underline', 'strike', 'h2', 'h3', 'bulletList', 'orderedList', 'blockquote', 'link', 'clear'];

const COMMANDS: Record<RichTextCommand, { label: string; icon: string; exec: string; arg?: string; state?: string; block?: string; shortcut?: string }> = {
  bold: { label: 'Bold', icon: 'B', exec: 'bold', state: 'bold', shortcut: 'b' },
  italic: { label: 'Italic', icon: 'I', exec: 'italic', state: 'italic', shortcut: 'i' },
  underline: { label: 'Underline', icon: 'U', exec: 'underline', state: 'underline', shortcut: 'u' },
  strike: { label: 'Strikethrough', icon: 'S', exec: 'strikeThrough', state: 'strikeThrough' },
  h2: { label: 'Heading', icon: 'H2', exec: 'formatBlock', arg: 'h2', block: 'h2' },
  h3: { label: 'Subheading', icon: 'H3', exec: 'formatBlock', arg: 'h3', block: 'h3' },
  paragraph: { label: 'Paragraph', icon: '¶', exec: 'formatBlock', arg: 'p', block: 'p' },
  bulletList: { label: 'Bulleted list', icon: '•', exec: 'insertUnorderedList', state: 'insertUnorderedList' },
  orderedList: { label: 'Numbered list', icon: '1.', exec: 'insertOrderedList', state: 'insertOrderedList' },
  blockquote: { label: 'Quote', icon: '❝', exec: 'formatBlock', arg: 'blockquote', block: 'blockquote' },
  code: { label: 'Code block', icon: '{ }', exec: 'formatBlock', arg: 'pre', block: 'pre' },
  link: { label: 'Link', icon: '', exec: 'createLink', shortcut: 'k' },
  clear: { label: 'Clear formatting', icon: '⌫', exec: 'removeFormat' },
  undo: { label: 'Undo', icon: '↶', exec: 'undo' },
  redo: { label: 'Redo', icon: '↷', exec: 'redo' },
};

function exec(command: string, arg?: string): boolean {
  try {
    // execCommand is deprecated but remains the only cross-browser way to edit
    // contenteditable with native undo; output is sanitized either way.
    return document.execCommand?.(command, false, arg) ?? false;
  } catch {
    return false;
  }
}

function richTextMixin(host: HTMLElement, options: RichTextOptions = {}): MixinInstance {
  const controller = new AbortController();
  const { signal } = controller;
  const sourceTextarea = host instanceof HTMLTextAreaElement ? host : null;
  const editor = sourceTextarea ? document.createElement('div') : host;
  const clean = (html: string): string => sanitizeHtml(html, options.sanitize);

  const wrapper = document.createElement('div');
  wrapper.className = 'rich-text';
  host.insertAdjacentElement('beforebegin', wrapper);
  const toolbar = document.createElement('div');
  toolbar.className = 'rich-text__toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Formatting');
  wrapper.appendChild(toolbar);
  if (sourceTextarea) {
    editor.innerHTML = clean(sourceTextarea.value);
    sourceTextarea.hidden = true;
    wrapper.append(editor, sourceTextarea);
  } else {
    editor.innerHTML = clean(editor.innerHTML);
    wrapper.appendChild(editor);
  }

  editor.contentEditable = 'true';
  editor.classList.add('rich-text__content');
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-multiline', 'true');
  if (options.label) editor.setAttribute('aria-label', options.label);
  if (options.placeholder) editor.dataset.placeholder = options.placeholder;
  if (!editor.id) editor.id = uniqueId('rich-text');
  exec('defaultParagraphSeparator', 'p');

  const buttons: HTMLButtonElement[] = [];
  for (const name of options.toolbar ?? DEFAULT_TOOLBAR) {
    const cmd = COMMANDS[name];
    if (!cmd) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `rich-text__button rich-text__button--${name}`;
    btn.dataset.command = name;
    // The icon is CSS generated content with empty alt text, so the accessible
    // name is exactly the label (WCAG 2.5.3 "label in name").
    btn.dataset.icon = cmd.icon;
    btn.setAttribute('aria-label', cmd.label);
    btn.title = cmd.shortcut ? `${cmd.label} (Ctrl+${cmd.shortcut.toUpperCase()})` : cmd.label;
    btn.tabIndex = buttons.length === 0 ? 0 : -1;
    if (cmd.state || cmd.block) btn.setAttribute('aria-pressed', 'false');
    toolbar.appendChild(btn);
    buttons.push(btn);
  }

  // Link input (instead of window.prompt).
  const linkBar = document.createElement('form');
  linkBar.className = 'rich-text__link';
  linkBar.hidden = true;
  const linkInput = document.createElement('input');
  linkInput.type = 'url';
  linkInput.placeholder = 'https://';
  linkInput.setAttribute('aria-label', 'Link URL');
  const linkApply = document.createElement('button');
  linkApply.type = 'submit';
  linkApply.textContent = 'Apply';
  linkBar.append(linkInput, linkApply);
  wrapper.insertBefore(linkBar, editor);
  let savedRange: Range | null = null;

  let lastHtml = editor.innerHTML;
  function changed(): void {
    const html = clean(editor.innerHTML);
    if (html === lastHtml) return;
    lastHtml = html;
    if (sourceTextarea) {
      sourceTextarea.value = html;
      sourceTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editor.classList.toggle('is-empty', htmlToText(html).trim() === '');
    emit(editor, 'rich-text:change', { html, text: htmlToText(html) });
  }
  editor.classList.toggle('is-empty', htmlToText(editor.innerHTML).trim() === '');

  function updateState(): void {
    const sel = document.getSelection();
    if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return;
    let block = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
    while (block && block !== editor && !/^(P|H2|H3|BLOCKQUOTE|PRE|LI)$/.test(block.tagName)) block = block.parentElement;
    const blockTag = block && block !== editor ? block.tagName.toLowerCase() : 'p';
    for (const btn of buttons) {
      const cmd = COMMANDS[btn.dataset.command as RichTextCommand];
      let pressed: boolean | null = null;
      if (cmd.block) pressed = blockTag === cmd.block;
      else if (cmd.state) {
        try {
          pressed = document.queryCommandState?.(cmd.state) ?? false;
        } catch {
          pressed = false;
        }
      }
      if (pressed !== null) btn.setAttribute('aria-pressed', String(pressed));
    }
  }

  function openLink(): void {
    const sel = document.getSelection();
    savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const anchor = sel?.anchorNode?.parentElement?.closest('a');
    linkInput.value = anchor?.getAttribute('href') ?? '';
    linkBar.hidden = false;
    linkInput.focus();
  }

  function run(name: RichTextCommand): void {
    const cmd = COMMANDS[name];
    editor.focus();
    if (name === 'link') {
      openLink();
      return;
    }
    if (cmd.block) {
      const current = buttons.find(b => b.dataset.command === name)?.getAttribute('aria-pressed') === 'true';
      exec('formatBlock', current ? 'p' : `<${cmd.arg}>`);
    } else {
      exec(cmd.exec, cmd.arg);
    }
    changed();
    updateState();
  }

  linkBar.addEventListener('submit', e => {
    e.preventDefault();
    const url = sanitizeUrl(linkInput.value.trim(), 'link');
    linkBar.hidden = true;
    editor.focus();
    if (savedRange) {
      const sel = document.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange);
    }
    if (url) exec('createLink', url);
    else exec('unlink');
    changed();
  }, { signal });
  linkInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      linkBar.hidden = true;
      editor.focus();
    }
  }, { signal });

  toolbar.addEventListener('mousedown', e => e.preventDefault(), { signal }); // keep the selection
  toolbar.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-command]');
    if (btn) run(btn.dataset.command as RichTextCommand);
  }, { signal });
  toolbar.addEventListener('keydown', e => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % buttons.length,
      ArrowLeft: (index - 1 + buttons.length) % buttons.length,
      Home: 0,
      End: buttons.length - 1,
    };
    const next = targets[e.key];
    if (next === undefined) return;
    e.preventDefault();
    buttons[index].tabIndex = -1;
    buttons[next].tabIndex = 0;
    buttons[next].focus();
  }, { signal });

  editor.addEventListener('input', e => {
    if (e.target === editor) changed();
  }, { signal });
  editor.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    const map: Record<string, RichTextCommand> = { b: 'bold', i: 'italic', u: 'underline', k: 'link' };
    if (map[key] && (options.toolbar ?? DEFAULT_TOOLBAR).includes(map[key])) {
      e.preventDefault();
      run(map[key]);
    } else if (e.shiftKey && (key === '7' || key === '&')) {
      e.preventDefault();
      run('orderedList');
    } else if (e.shiftKey && (key === '8' || key === '*')) {
      e.preventDefault();
      run('bulletList');
    }
  }, { signal });
  editor.addEventListener('paste', e => {
    const data = e.clipboardData;
    if (!data) return;
    e.preventDefault();
    const html = data.getData('text/html');
    if (html) exec('insertHTML', clean(html));
    else exec('insertText', data.getData('text/plain'));
    changed();
  }, { signal });
  editor.addEventListener('drop', e => {
    if (e.dataTransfer?.files.length) e.preventDefault();
  }, { signal });
  document.addEventListener('selectionchange', updateState, { signal });

  return {
    name: 'rich-text',
    element: host,
    options: options as Record<string, unknown>,
    editor,
    getHTML: () => clean(editor.innerHTML),
    getText: () => htmlToText(editor.innerHTML),
    setHTML: (html: string) => {
      editor.innerHTML = clean(html);
      changed();
    },
    command: run,
    destroy: () => {
      controller.abort();
      editor.removeAttribute('contenteditable');
      editor.classList.remove('rich-text__content', 'is-empty');
      editor.removeAttribute('role');
      editor.removeAttribute('aria-multiline');
      if (sourceTextarea) {
        sourceTextarea.hidden = false;
        wrapper.replaceWith(sourceTextarea);
      } else {
        wrapper.replaceWith(editor);
      }
    },
  };
}

export function richTextPlugin(): ArethesisPlugin {
  return {
    name: 'rich-text',
    version: VERSION,
    mixins: { 'rich-text': richTextMixin as never },
    validators: {
      richTextMinLength: {
        fn: (value, params) => {
          const text = htmlToText(value).trim();
          return text === '' || text.length >= Number(params.min ?? 0);
        },
        message: 'Write at least {min} characters',
      },
      richTextMaxLength: {
        fn: (value, params) => htmlToText(value).trim().length <= Number(params.max ?? Infinity),
        message: 'Keep it under {max} characters',
      },
      noEmptyParagraphs: {
        fn: value => !/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/i.test(String(value ?? '')),
        message: 'Remove empty paragraphs',
      },
    },
  };
}

export { richTextMixin };
