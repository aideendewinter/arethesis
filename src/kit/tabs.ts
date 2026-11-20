/**
 * `<a-tabs>`: tabs over plain markup (the WAI-ARIA tabs pattern). Without
 * scripts, the markup reads as headings and sections; with them, it becomes
 * a tab list.
 *
 * ```html
 * <a-tabs aria-label="Account">
 *   <h3 data-tab>Profile</h3>
 *   <section>…</section>
 *   <h3 data-tab>Billing</h3>
 *   <section>…</section>
 * </a-tabs>
 * ```
 *
 * Or write the tab list yourself (`role="tablist"` with `role="tab"`
 * buttons, and `role="tabpanel"` elements, matched by `aria-controls` or by
 * order).
 *
 * - Arrow keys move between tabs (Left/Right, or Up/Down with
 *   `orientation="vertical"`), Home and End go to the ends. With
 *   `activation="manual"`, Enter or Space shows the focused tab.
 * - Hidden panels use `hidden="until-found"`, so find-in-page still finds
 *   text in them and opens their tab.
 * - `data-hash` keeps the open tab in the URL (`#panel-id`).
 * - A panel holding `<template data-lazy>` gets its content the first time
 *   it's shown, so islands in it don't load early.
 *
 * Event: `tabs:change` (`{ index, tab, panel }`).
 *
 * @module components/tabs
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import { uniqueId } from '../utils/dom';

export class Tabs extends Component {
  #tabs: HTMLElement[] = [];
  #panels: HTMLElement[] = [];
  #selected = -1;
  #built = false;

  /** The open tab's index. */
  get selectedIndex(): number {
    return this.#selected;
  }

  get tabs(): HTMLElement[] {
    return [...this.#tabs];
  }

  get panels(): HTMLElement[] {
    return [...this.#panels];
  }

  protected override onConnected(): void {
    if (!this.#built) this.#build();
    if (this.hasAttribute('data-hash')) {
      this.listen(window, 'hashchange', () => this.#fromHash());
    }
  }

  #build(): void {
    this.#built = true;
    const id = this.id || uniqueId('ar-tabs');
    let list = this.querySelector<HTMLElement>(':scope > [role="tablist"]');
    if (list) {
      this.#tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
      const byOrder = Array.from(this.querySelectorAll<HTMLElement>(':scope > [role="tabpanel"]'));
      this.#panels = this.#tabs.map((tab, i) => {
        const controls = tab.getAttribute('aria-controls');
        return (controls && this.querySelector<HTMLElement>(`#${CSS.escape(controls)}`)) || byOrder[i];
      });
    } else {
      // Headings marked data-tab, each followed by its panel.
      list = document.createElement('div');
      list.setAttribute('role', 'tablist');
      const label = this.getAttribute('aria-label');
      if (label) list.setAttribute('aria-label', label);
      for (const heading of Array.from(this.querySelectorAll<HTMLElement>(':scope > [data-tab]'))) {
        const panel = heading.nextElementSibling as HTMLElement | null;
        if (!panel) continue;
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.textContent = heading.textContent?.trim() ?? '';
        if (heading.id) tab.dataset.from = heading.id;
        heading.remove();
        this.#tabs.push(tab);
        this.#panels.push(panel);
        list.append(tab);
      }
      this.prepend(list);
    }
    list.classList.add('ar-tabs__list');
    list.setAttribute('aria-orientation', this.getAttribute('orientation') === 'vertical' ? 'vertical' : 'horizontal');

    this.#tabs.forEach((tab, i) => {
      const panel = this.#panels[i];
      tab.id ||= `${id}-tab-${i}`;
      tab.classList.add('ar-tabs__tab');
      if (!panel) return;
      panel.id ||= `${id}-panel-${i}`;
      panel.setAttribute('role', 'tabpanel');
      panel.classList.add('ar-tabs__panel');
      panel.setAttribute('aria-labelledby', tab.id);
      tab.setAttribute('aria-controls', panel.id);
      // Panels without focusable content are focusable themselves, so Tab reaches them.
      if (!panel.querySelector('a[href], button, input, select, textarea, [tabindex]')) panel.tabIndex = 0;
      panel.addEventListener('beforematch', () => this.select(i));
    });

    list.addEventListener('click', e => {
      const tab = (e.target as Element).closest<HTMLElement>('[role="tab"]');
      const i = tab ? this.#tabs.indexOf(tab) : -1;
      if (i >= 0) this.select(i, { focus: true });
    });
    list.addEventListener('keydown', e => this.#onKey(e));

    const fromMarkup = this.#tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    const initial = this.#hashIndex() ?? (fromMarkup >= 0 ? fromMarkup : Number(this.getAttribute('selected') ?? 0));
    this.select(Math.min(Math.max(0, initial), this.#tabs.length - 1), { silent: true });
  }

  #onKey(e: KeyboardEvent): void {
    const current = this.#tabs.indexOf(e.target as HTMLElement);
    if (current < 0) return;
    const vertical = this.getAttribute('orientation') === 'vertical';
    const rtl = getComputedStyle(this).direction === 'rtl';
    const next = vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
    const prev = vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
    let target = -1;
    if (e.key === next) target = this.#step(current, 1);
    else if (e.key === prev) target = this.#step(current, -1);
    else if (e.key === 'Home') target = this.#step(-1, 1);
    else if (e.key === 'End') target = this.#step(this.#tabs.length, -1);
    else if ((e.key === 'Enter' || e.key === ' ') && this.#manual()) {
      e.preventDefault();
      this.select(current, { focus: true });
      return;
    }
    if (target < 0) return;
    e.preventDefault();
    if (this.#manual()) {
      this.#rove(target);
      this.#tabs[target].focus();
    } else {
      this.select(target, { focus: true });
    }
  }

  #manual(): boolean {
    return this.getAttribute('activation') === 'manual';
  }

  /** The next enabled tab from `from` in a direction, wrapping. */
  #step(from: number, dir: 1 | -1): number {
    const n = this.#tabs.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (this.#tabs[i].getAttribute('aria-disabled') !== 'true' && !(this.#tabs[i] as HTMLButtonElement).disabled) return i;
    }
    return -1;
  }

  #rove(index: number): void {
    this.#tabs.forEach((tab, i) => (tab.tabIndex = i === index ? 0 : -1));
  }

  /** Show a tab. */
  select(index: number, { focus = false, silent = false }: { focus?: boolean; silent?: boolean } = {}): void {
    const tab = this.#tabs[index];
    if (!tab) return;
    const changed = index !== this.#selected;
    this.#selected = index;
    this.#rove(index);
    this.#tabs.forEach((t, i) => t.setAttribute('aria-selected', String(i === index)));
    this.#panels.forEach((panel, i) => {
      if (!panel) return;
      if (i === index) {
        panel.removeAttribute('hidden');
        const lazy = panel.querySelector<HTMLTemplateElement>(':scope > template[data-lazy]');
        if (lazy) lazy.replaceWith(lazy.content.cloneNode(true));
      } else {
        // Find-in-page can still reach it (and opens it with `beforematch`).
        panel.setAttribute('hidden', 'until-found');
      }
    });
    if (focus) tab.focus();
    if (!changed || silent) return;
    if (this.hasAttribute('data-hash') && this.#panels[index]) {
      history.replaceState(history.state, '', `#${this.#panels[index].id}`);
    }
    this.emit('tabs:change', { index, tab, panel: this.#panels[index] });
  }

  #hashIndex(): number | null {
    if (!this.hasAttribute('data-hash') || !location.hash) return null;
    const id = decodeURIComponent(location.hash.slice(1));
    const i = this.#panels.findIndex(p => p?.id === id);
    return i >= 0 ? i : null;
  }

  #fromHash(): void {
    const i = this.#hashIndex();
    if (i !== null && i !== this.#selected) this.select(i);
  }
}

/** Define `<a-tabs>` (idempotent). `import 'arethesis/components/tabs'` calls this. */
export function defineTabs(): void {
  defineComponent({ tag: 'a-tabs' })(Tabs);
}
