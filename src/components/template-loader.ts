/**
 * TemplateLoader: fetch, parse and cache HTML templates.
 *
 * A template file (or inline HTML string) can hold several `<template id>`
 * elements, e.g. `main`, `loading`, `error`, `item`, `empty`. Files are fetched
 * once; concurrent loads share a request; every `load()` returns a fresh clone.
 *
 * @module components/template-loader
 */

import { cssEscape, parseHtml } from '../utils/dom';

export class TemplateLoader {
  private files = new Map<string, DocumentFragment>();
  private pending = new Map<string, Promise<DocumentFragment>>();
  private extracted = new Map<string, DocumentFragment>();
  private fetchImpl: () => typeof fetch = () => globalThis.fetch.bind(globalThis);

  /** Use a custom fetch (for tests or mock backends). */
  setFetch(fetchImpl: typeof fetch): void {
    this.fetchImpl = () => fetchImpl;
  }

  /** Register inline HTML under a key, so `load(key)` never hits the network. */
  register(key: string, html: string): void {
    this.files.set(key, parseHtml(html));
    for (const k of this.extracted.keys()) if (k.startsWith(`${key}#`)) this.extracted.delete(k);
  }

  /**
   * Load a file, or one `<template id>` from it. If the file has no `<template>`
   * elements, asking for `'main'` returns the whole file.
   */
  async load(path: string, templateId?: string): Promise<DocumentFragment> {
    const file = await this.loadFile(path);
    if (!templateId) return file.cloneNode(true) as DocumentFragment;
    const key = `${path}#${templateId}`;
    let fragment = this.extracted.get(key);
    if (!fragment) {
      fragment = this.extract(file, templateId, path);
      this.extracted.set(key, fragment);
    }
    return fragment.cloneNode(true) as DocumentFragment;
  }

  /** Whether a file has a `<template>` with this id (after loading). */
  async has(path: string, templateId: string): Promise<boolean> {
    const file = await this.loadFile(path);
    return file.querySelector(`template#${cssEscape(templateId)}`) !== null;
  }

  private loadFile(path: string): Promise<DocumentFragment> {
    const cached = this.files.get(path);
    if (cached) return Promise.resolve(cached);
    let pending = this.pending.get(path);
    if (!pending) {
      pending = this.fetchFile(path).then(
        fragment => {
          this.files.set(path, fragment);
          this.pending.delete(path);
          return fragment;
        },
        err => {
          this.pending.delete(path);
          throw err;
        },
      );
      this.pending.set(path, pending);
    }
    return pending;
  }

  private async fetchFile(path: string): Promise<DocumentFragment> {
    const response = await this.fetchImpl()(path);
    if (!response.ok) throw new Error(`Failed to load template ${path} (${response.status})`);
    return parseHtml(await response.text());
  }

  private extract(file: DocumentFragment, templateId: string, path: string): DocumentFragment {
    const template = file.querySelector<HTMLTemplateElement>(`template#${cssEscape(templateId)}`);
    if (template) return template.content.cloneNode(true) as DocumentFragment;
    if (templateId === 'main' && !file.querySelector('template')) return file.cloneNode(true) as DocumentFragment;
    throw new Error(`Template "#${templateId}" not found in ${path}`);
  }

  /** Warm the cache. */
  async preload(paths: string[]): Promise<void> {
    await Promise.all(paths.map(p => this.loadFile(p)));
  }

  isCached(path: string): boolean {
    return this.files.has(path);
  }

  /** Drop cached files (inline registrations included). */
  clearCache(): void {
    this.files.clear();
    this.extracted.clear();
  }
}

/** Shared loader used by every component. */
export const templateLoader = new TemplateLoader();
