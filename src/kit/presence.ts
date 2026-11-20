/**
 * `<a-presence>`: who else is here, as a row of avatars, for a collaborative
 * session (or anything with the same shape).
 *
 * ```ts
 * const presence = document.querySelector('a-presence');
 * presence.self = { name: 'Hypatia', color: '#1d4b98' };
 * presence.session = app.collab.open('doc-1', textarea);
 * ```
 *
 * ```html
 * <a-presence max="4" announce aria-label="People editing"></a-presence>
 * ```
 *
 * Each avatar shows initials on the person's color (with text that stays
 * readable on it) and their name in a tooltip. Past `max`, a "+3" button
 * opens the full list. With `announce`, people joining and leaving are read
 * out (a few at a time).
 *
 * It only needs `peers` and `on('presence', …)` from the session, so it adds
 * no collaboration code to a page by itself.
 *
 * @module components/presence
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import type { CollabUser, RemoteCursor } from '../realtime/types';
import type { MixinInstance } from '../mixins/types';
import { tooltipMixin } from '../mixins/tooltip';
import { attachPopup, type Popup } from '../mixins/popup';
import { announce } from '../mixins/utils';
import { uniqueId } from '../utils/dom';

/** What `<a-presence>` needs from a session: `CollabSession` has it. */
export interface PresenceSource {
  readonly peers: RemoteCursor[];
  on(event: 'presence', listener: (peers: RemoteCursor[]) => void): () => void;
}

const PALETTE = ['#1d4b98', '#a32c17', '#235f41', '#7a4e07', '#8a1a38', '#5c3a1e', '#1d5e66', '#4f2d7f'];

/** Initials for a name: the first and last words ("Hypatia of Alexandria" → "HA"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0];
  return (words.length > 1 ? first + words[words.length - 1][0] : first).toUpperCase();
}

/** A stable color for a name, for people without one. */
export function colorFor(name: string): string {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/** Black or white, whichever reads better on `color` (a hex or `rgb()` color). */
export function textOn(color: string): '#000' | '#fff' {
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1];
    rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
    if (m) rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (!rgb) return '#fff';
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast with white is (1.05)/(L+0.05); with black, (L+0.05)/0.05.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#fff' : '#000';
}

interface Person {
  id: string;
  name: string;
  color: string;
  self: boolean;
}

export class Presence extends Component {
  #session: PresenceSource | null = null;
  #off: (() => void) | null = null;
  #self: CollabUser | null = null;
  #list: HTMLUListElement | null = null;
  #overflow: HTMLButtonElement | null = null;
  #panel: HTMLUListElement | null = null;
  #popup: Popup | null = null;
  #tips: MixinInstance[] = [];
  #known = new Map<string, string>();
  #joined: string[] = [];
  #left: string[] = [];
  #announceTimer: ReturnType<typeof setTimeout> | null = null;

  static get observedAttributes(): string[] {
    return ['max'];
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  /** The session whose people to show. */
  get session(): PresenceSource | null {
    return this.#session;
  }
  set session(session: PresenceSource | null) {
    this.#off?.();
    this.#off = null;
    this.#session = session;
    this.#known.clear();
    if (session) this.#off = session.on('presence', () => this.#render(true));
    this.#render();
  }

  /** You, shown first as "(you)". */
  get self(): CollabUser | null {
    return this.#self;
  }
  set self(user: CollabUser | null) {
    this.#self = user;
    this.#render();
  }

  /** Everyone shown, you first. */
  get people(): Array<{ id: string; name: string; color: string; self: boolean }> {
    const out: Person[] = [];
    if (this.#self) out.push({ id: 'self', name: this.#self.name, color: this.#self.color ?? colorFor(this.#self.name), self: true });
    for (const peer of this.#session?.peers ?? []) {
      const name = peer.user?.name ?? 'Guest';
      out.push({ id: peer.clientId, name, color: peer.user?.color ?? colorFor(name), self: false });
    }
    return out;
  }

  protected override onConnected(): void {
    if (this.#list) return;
    const list = document.createElement('ul');
    list.className = 'ar-presence';
    list.setAttribute('aria-label', this.getAttribute('aria-label') ?? 'People here');
    const overflow = document.createElement('button');
    overflow.type = 'button';
    overflow.className = 'ar-presence__more';
    overflow.hidden = true;
    const panel = document.createElement('ul');
    panel.className = 'ar-presence__panel';
    panel.id = uniqueId('ar-presence');
    overflow.setAttribute('aria-controls', panel.id);
    overflow.setAttribute('aria-expanded', 'false');
    this.replaceChildren(list, overflow, panel);
    this.#list = list;
    this.#overflow = overflow;
    this.#panel = panel;
    this.#popup = attachPopup(panel, { anchor: () => overflow, placement: 'bottom', gap: 6 });
    overflow.addEventListener('click', () => this.#toggle());
    this.listen(document, 'keydown', e => {
      if ((e as KeyboardEvent).key === 'Escape' && this.#popup?.isOpen()) {
        this.#toggle(false);
        overflow.focus();
      }
    });
    this.listen(document, 'pointerdown', e => {
      if (this.#popup?.isOpen() && !this.contains(e.target as Node)) this.#toggle(false);
    });
    this.#render();
  }

  protected override onDisconnected(): void {
    for (const tip of this.#tips.splice(0)) tip.destroy();
    this.#list = null;
    if (this.#announceTimer) clearTimeout(this.#announceTimer);
  }

  #toggle(open = !this.#popup?.isOpen()): void {
    if (open) this.#popup?.show();
    else this.#popup?.hide();
    this.#overflow?.setAttribute('aria-expanded', String(open));
  }

  #avatar(person: Person): HTMLElement {
    const el = document.createElement('span');
    el.className = 'ar-presence__avatar';
    el.style.background = person.color;
    el.style.color = textOn(person.color);
    el.textContent = initials(person.name);
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  #render(changed = false): void {
    const list = this.#list;
    if (!list) return;
    const people = this.people;
    if (changed) this.#track(people);
    else this.#known = new Map(people.map(p => [p.id, p.name]));

    for (const tip of this.#tips.splice(0)) tip.destroy();
    const max = Math.max(1, Number(this.getAttribute('max')) || 5);
    // With overflow, keep room for the "+N" button.
    const shown = people.length > max ? people.slice(0, max - 1) : people;
    list.replaceChildren(...shown.map(person => {
      const li = document.createElement('li');
      li.className = 'ar-presence__person';
      li.dataset.id = person.id;
      li.tabIndex = 0;
      const label = person.self ? `${person.name} (you)` : person.name;
      const name = document.createElement('span');
      name.className = 'ar-visually-hidden';
      name.textContent = label;
      li.append(this.#avatar(person), name);
      this.#tips.push(tooltipMixin(li, { content: label, placement: 'bottom' }));
      return li;
    }));

    const hidden = people.length - shown.length;
    const overflow = this.#overflow!;
    overflow.hidden = hidden === 0;
    overflow.textContent = `+${hidden}`;
    overflow.setAttribute('aria-label', `${hidden} more: show everyone`);
    this.#panel!.replaceChildren(...people.map(person => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = person.self ? `${person.name} (you)` : person.name;
      li.append(this.#avatar(person), name);
      return li;
    }));
    if (hidden === 0) this.#toggle(false);
  }

  /** Note who joined and left, and announce them shortly (in batches). */
  #track(people: Person[]): void {
    const now = new Map(people.map(p => [p.id, p.name]));
    for (const [id, name] of now) if (!this.#known.has(id) && id !== 'self') this.#joined.push(name);
    for (const [id, name] of this.#known) if (!now.has(id) && id !== 'self') this.#left.push(name);
    this.#known = now;
    if (!this.hasAttribute('announce') || (!this.#joined.length && !this.#left.length) || this.#announceTimer) return;
    this.#announceTimer = setTimeout(() => {
      this.#announceTimer = null;
      const parts: string[] = [];
      if (this.#joined.length) parts.push(`${listNames(this.#joined)} joined`);
      if (this.#left.length) parts.push(`${listNames(this.#left)} left`);
      this.#joined = [];
      this.#left = [];
      announce(parts.join('. '));
    }, 1000);
  }
}

function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

/** Define `<a-presence>` (idempotent). `import 'arethesis/components/presence'` calls this. */
export function definePresence(): void {
  defineComponent({ tag: 'a-presence' })(Presence);
}
