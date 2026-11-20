/**
 * Draws remote collaborators' carets and selections over a textarea, using a
 * hidden mirror element to measure where a character index lands on screen.
 * Selections are tinted with the collaborator's color, one rectangle per line.
 *
 * @module realtime/collab/cursor-overlay
 */

import type { RemoteCursor } from '../types';

const MIRRORED = [
  'boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily',
  'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordBreak', 'overflowWrap',
] as const;

function mirrorOf(textarea: HTMLTextAreaElement | HTMLInputElement): { mirror: HTMLDivElement; style: CSSStyleDeclaration } {
  const mirror = document.createElement('div');
  const style = getComputedStyle(textarea);
  for (const prop of MIRRORED) (mirror.style as unknown as Record<string, string>)[prop] = style[prop];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: textarea instanceof HTMLInputElement ? 'pre' : 'pre-wrap', wordWrap: 'break-word', overflow: 'hidden' });
  return { mirror, style };
}

/** Pixel position of a character index inside a textarea, relative to its padding box. */
export function caretCoordinates(textarea: HTMLTextAreaElement | HTMLInputElement, index: number): { top: number; left: number; height: number } {
  const { mirror, style } = mirrorOf(textarea);
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(index) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16;
  const result = {
    top: marker.offsetTop + (parseFloat(style.borderTopWidth) || 0),
    left: marker.offsetLeft + (parseFloat(style.borderLeftWidth) || 0),
    height: lineHeight,
  };
  mirror.remove();
  return result;
}

/**
 * The rectangles (one per visual line) covering the text from `from` to `to`
 * in a textarea, relative to its border box, ignoring scrolling.
 */
export function rangeRects(textarea: HTMLTextAreaElement | HTMLInputElement, from: number, to: number): Array<{ top: number; left: number; width: number; height: number }> {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(textarea.value.length, Math.max(from, to));
  if (start === end) return [];
  const { mirror, style } = mirrorOf(textarea);
  const span = document.createElement('span');
  span.textContent = textarea.value.slice(start, end);
  mirror.append(textarea.value.slice(0, start), span, textarea.value.slice(end) || '.');
  document.body.appendChild(mirror);
  const box = mirror.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16;
  const rects = Array.from(span.getClientRects())
    .filter(r => r.width > 0.5)
    .map(r => ({ top: r.top - box.top + (r.height - lineHeight) / 2, left: r.left - box.left, width: r.width, height: lineHeight }));
  mirror.remove();
  return rects;
}

export class CursorOverlay {
  private layer: HTMLDivElement;
  private cursors: RemoteCursor[] = [];
  private controller = new AbortController();
  private frame = 0;

  constructor(private textarea: HTMLTextAreaElement | HTMLInputElement) {
    const parent = textarea.parentElement ?? document.body;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    this.layer = document.createElement('div');
    this.layer.className = 'collab-cursors';
    this.layer.setAttribute('aria-hidden', 'true');
    Object.assign(this.layer.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden', inset: '0' });
    parent.appendChild(this.layer);
    const { signal } = this.controller;
    textarea.addEventListener('scroll', () => this.schedule(), { signal, passive: true });
    textarea.addEventListener('input', () => this.schedule(), { signal });
    window.addEventListener('resize', () => this.schedule(), { signal });
  }

  update(cursors: RemoteCursor[]): void {
    this.cursors = cursors;
    this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const ta = this.textarea;
    const offsetTop = ta.offsetTop - ta.scrollTop;
    const offsetLeft = ta.offsetLeft - ta.scrollLeft;
    this.layer.replaceChildren();
    for (const cursor of this.cursors) {
      if (!cursor.selection) continue;
      const color = cursor.user?.color ?? '#7c3aed';
      for (const r of rangeRects(ta, cursor.selection.anchor, cursor.selection.head)) {
        const highlight = document.createElement('div');
        highlight.className = 'collab-selection';
        Object.assign(highlight.style, {
          position: 'absolute', top: `${offsetTop + r.top}px`, left: `${offsetLeft + r.left}px`,
          width: `${r.width}px`, height: `${r.height}px`, background: color, opacity: '0.22',
        });
        this.layer.appendChild(highlight);
      }
      const head = Math.min(cursor.selection.head, ta.value.length);
      const pos = caretCoordinates(ta, head);
      const caret = document.createElement('div');
      caret.className = 'collab-cursor';
      Object.assign(caret.style, {
        position: 'absolute', top: `${offsetTop + pos.top}px`, left: `${offsetLeft + pos.left}px`,
        height: `${pos.height}px`, width: '2px', background: color,
      });
      const label = document.createElement('span');
      label.className = 'collab-cursor__label';
      label.textContent = cursor.user?.name ?? 'Guest';
      Object.assign(label.style, { position: 'absolute', bottom: '100%', left: '0', background: color, color: '#fff', whiteSpace: 'nowrap' });
      caret.appendChild(label);
      this.layer.appendChild(caret);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.controller.abort();
    this.layer.remove();
  }
}
