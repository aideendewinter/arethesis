/**
 * MixinRegistry: register behaviors and apply them to elements, in code or
 * declaratively with `data-mixin`.
 *
 * ```html
 * <div data-mixin="draggable tooltip"
 *      data-mixin-draggable-axis="x"
 *      data-tooltip="Drag me sideways">…</div>
 * ```
 *
 * Option attributes are `data-mixin-<mixin>-<option>` with kebab-case option
 * names (`data-mixin-grid-navigation-tab-behavior="cells"` → `tabBehavior`).
 * Values are parsed as numbers, booleans, null or JSON where possible.
 *
 * @module mixins/registry
 */

import type { MixinDefinition, MixinFunction, MixinInstance } from './types';
import { camelCase } from '../utils/dom';

export class MixinRegistry {
  private definitions = new Map<string, MixinDefinition>();
  private applied = new WeakMap<HTMLElement, Map<string, MixinInstance>>();
  private observers = new Set<MutationObserver>();

  /** Register a mixin. Re-registering a name replaces it. */
  register<O>(name: string, definition: MixinDefinition<O> | MixinFunction<O>): void {
    const def = typeof definition === 'function' ? { fn: definition } : definition;
    this.definitions.set(name, def as unknown as MixinDefinition);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  names(): string[] {
    return Array.from(this.definitions.keys());
  }

  /**
   * Apply a mixin. Returns the existing instance if it is already applied, or
   * null if it is unknown or conflicts with an applied mixin.
   */
  apply<O extends object = Record<string, unknown>>(element: HTMLElement, name: string, options: O = {} as O): MixinInstance | null {
    const def = this.definitions.get(name);
    if (!def) {
      console.error(`Unknown mixin "${name}"`);
      return null;
    }
    let map = this.applied.get(element);
    if (!map) {
      map = new Map();
      this.applied.set(element, map);
    }
    const existing = map.get(name);
    if (existing) return existing;

    for (const conflict of def.conflicts ?? []) {
      if (map.has(conflict)) {
        console.error(`Mixin "${name}" conflicts with "${conflict}"`);
        return null;
      }
    }
    for (const dep of def.dependencies ?? []) {
      if (!map.has(dep)) this.apply(element, dep, {});
    }
    try {
      const instance = def.fn(element, options as Record<string, unknown>);
      map.set(name, instance);
      element.dataset.mixinsApplied = Array.from(map.keys()).join(' ');
      return instance;
    } catch (err) {
      console.error(`Failed to apply mixin "${name}":`, err);
      return null;
    }
  }

  /** The instance of a mixin on an element. */
  get(element: HTMLElement, name: string): MixinInstance | undefined {
    return this.applied.get(element)?.get(name);
  }

  isApplied(element: HTMLElement, name: string): boolean {
    return this.applied.get(element)?.has(name) ?? false;
  }

  /** Destroy one mixin on an element. */
  remove(element: HTMLElement, name: string): boolean {
    const map = this.applied.get(element);
    const instance = map?.get(name);
    if (!map || !instance) return false;
    instance.destroy();
    map.delete(name);
    if (map.size) element.dataset.mixinsApplied = Array.from(map.keys()).join(' ');
    else delete element.dataset.mixinsApplied;
    return true;
  }

  /** Destroy every mixin on an element. */
  removeAll(element: HTMLElement): void {
    const map = this.applied.get(element);
    if (!map) return;
    for (const instance of map.values()) instance.destroy();
    map.clear();
    delete element.dataset.mixinsApplied;
  }

  /** Read options for a mixin from an element's attributes. */
  readOptions(element: Element, name: string): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    const json = element.getAttribute(`data-mixin-${name}`);
    if (json && json.trim().startsWith('{')) {
      try {
        Object.assign(options, JSON.parse(json));
      } catch {
        console.error(`data-mixin-${name} is not valid JSON`);
      }
    }
    const prefix = `data-mixin-${name}-`;
    for (const attr of Array.from(element.attributes)) {
      if (attr.name.startsWith(prefix)) options[camelCase(attr.name.slice(prefix.length))] = parseValue(attr.value);
    }
    return options;
  }

  /** Apply mixins declared with `data-mixin` within a root (including the root). */
  init(root: ParentNode = document): void {
    const elements: Element[] = [];
    if (root instanceof Element && root.hasAttribute('data-mixin')) elements.push(root);
    elements.push(...Array.from(root.querySelectorAll('[data-mixin]')));
    for (const element of elements) {
      for (const name of (element.getAttribute('data-mixin') ?? '').split(/[\s,]+/).filter(Boolean)) {
        if (!this.isApplied(element as HTMLElement, name)) this.apply(element as HTMLElement, name, this.readOptions(element, name));
      }
    }
  }

  /**
   * Keep a subtree in sync: apply mixins to added `[data-mixin]` elements and
   * destroy them on removed ones. Returns a function that stops observing.
   */
  observe(root: Element | Document = document): () => void {
    this.init(root);
    const target = root instanceof Document ? root.documentElement : root;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        record.removedNodes.forEach(node => {
          if (!(node instanceof HTMLElement) || node.isConnected) return;
          for (const el of [node, ...Array.from(node.querySelectorAll<HTMLElement>('[data-mixins-applied]'))]) this.removeAll(el);
        });
        record.addedNodes.forEach(node => {
          if (node instanceof Element) this.init(node);
        });
      }
    });
    observer.observe(target, { childList: true, subtree: true });
    this.observers.add(observer);
    return () => {
      observer.disconnect();
      this.observers.delete(observer);
    };
  }

  /** Stop all observers. */
  disconnectObservers(): void {
    for (const o of this.observers) o.disconnect();
    this.observers.clear();
  }
}

function parseValue(value: string): unknown {
  if (value === '' || value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^[[{"]/.test(value.trim())) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** Global registry. */
export const mixinRegistry = new MixinRegistry();

export const registerMixin = mixinRegistry.register.bind(mixinRegistry);
export const applyMixin = mixinRegistry.apply.bind(mixinRegistry);
export const removeMixin = mixinRegistry.remove.bind(mixinRegistry);
export const initMixins = mixinRegistry.init.bind(mixinRegistry);
export const observeMixins = mixinRegistry.observe.bind(mixinRegistry);
