/**
 * `<a-list>`: a declarative list. Write the item markup in a child
 * `<template>`, point it at an endpoint, and it loads, renders, updates live
 * and pages with infinite scroll. No JavaScript required.
 *
 * ```html
 * <a-list data-list="listPeople" data-page-size="20" infinite>
 *   <template data-item>
 *     <li><strong data-bind="name"></strong> <span data-bind="role" data-display="badge"></span></li>
 *   </template>
 *   <template data-empty><li>No people yet.</li></template>
 * </a-list>
 * ```
 *
 * Fields come from the `data-bind` attributes in the item template; set the
 * display type with `data-display` and a date pattern with `data-format`.
 *
 * @module kit/list
 */

import { Component } from '../components/component';
import { defineComponent } from '../components/decorators';
import type { BindConfig, DisplayType, FieldBindConfig } from '../binding/types';

export class List extends Component {
  #templates = new Map<string, DocumentFragment>();
  #container: HTMLElement | null = null;


  protected override onConnected(): void {
    if (!this.#container) this.#capture();
  }

  #capture(): void {
    for (const t of Array.from(this.querySelectorAll<HTMLTemplateElement>(':scope > template'))) {
      const kind = t.hasAttribute('data-empty') ? 'empty' : t.hasAttribute('data-loading') ? 'loading' : t.hasAttribute('data-error') ? 'error' : 'item';
      this.#templates.set(kind, t.content.cloneNode(true) as DocumentFragment);
      t.remove();
    }
    const tag = this.getAttribute('data-tag') ?? (this.#templates.get('item')?.firstElementChild?.tagName === 'LI' ? 'ul' : 'div');
    this.#container = document.createElement(tag);
    this.#container.className = 'ar-list';
    this.#container.setAttribute('data-items', '');
    if (this.getAttribute('aria-label')) this.#container.setAttribute('aria-label', this.getAttribute('aria-label')!);
    this.replaceChildren(this.#container);
  }

  protected override async loadTemplate(templateId: string): Promise<DocumentFragment | null> {
    if (templateId === 'main') {
      if (!this.#container) this.#capture();
      // Keep the container that is already rendered.
      const fragment = document.createDocumentFragment();
      fragment.appendChild(this.#container!);
      return fragment;
    }
    const t = this.#templates.get(templateId);
    return t ? (t.cloneNode(true) as DocumentFragment) : null;
  }

  protected override async hasTemplate(templateId: string): Promise<boolean> {
    return templateId === 'main' || this.#templates.has(templateId);
  }

  protected override get bindConfig(): BindConfig {
    const fields: Record<string, FieldBindConfig> = {};
    const item = this.#templates.get('item');
    // One entry per element, so a field can appear several times with different displays.
    for (const [index, el] of Array.from(item?.querySelectorAll('[data-bind]') ?? []).entries()) {
      el.setAttribute('data-ar-field', String(index));
      fields[`${el.getAttribute('data-bind')}#${index}`] = {
        field: el.getAttribute('data-bind')!,
        selector: `[data-ar-field="${index}"]`,
        displayType: (el.getAttribute('data-display') as DisplayType | null) ?? undefined,
        format: el.getAttribute('data-format') ?? undefined,
        attribute: el.getAttribute('data-attribute') ?? undefined,
      };
    }
    return {
      fields,
      itemTemplate: 'item',
      emptyTemplate: this.#templates.has('empty') ? 'empty' : undefined,
      loadingTemplate: this.#templates.has('loading') ? 'loading' : undefined,
      errorTemplate: this.#templates.has('error') ? 'error' : undefined,
      infiniteScroll: this.hasAttribute('infinite') ? { threshold: Number(this.getAttribute('data-threshold')) || 300 } : false,
    };
  }
}

/** Define `<a-list>` (idempotent). `import 'arethesis/components/list'` calls this. */
export function defineList(): void {
  defineComponent({ tag: 'a-list' })(List);
}
