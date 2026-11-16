/**
 * `defineComponent`: register a custom element with its template.
 *
 * Works as a legacy (`experimentalDecorators`) or standard decorator, or as a
 * plain function:
 *
 * ```ts
 * @defineComponent({ tag: 'person-card', template: '/templates/person-card.html' })
 * class PersonCard extends Component {}
 *
 * // or, without decorators:
 * defineComponent({ tag: 'person-card', html: `<template id="main">…</template>` })(PersonCard);
 * ```
 *
 * @module components/decorators
 */

import type { ComponentMetadata, DefineComponentOptions } from './types';
import { templateLoader } from './template-loader';

/** Symbol under which metadata is stored on the class. */
export const COMPONENT_METADATA = Symbol.for('arethesis.componentMetadata');

type Ctor = CustomElementConstructor;

export function defineComponent(options: DefineComponentOptions) {
  if (!/^[a-z][a-z0-9._]*-[a-z0-9._-]*$/.test(options.tag)) {
    throw new Error(`Invalid custom element name "${options.tag}": use lowercase letters and a hyphen.`);
  }
  return function <T extends Ctor>(constructor: T, _context?: unknown): T {
    const metadata: ComponentMetadata = { ...options };
    if (options.html !== undefined) {
      metadata.templateKey = `inline:${options.tag}`;
      templateLoader.register(metadata.templateKey, options.html);
    } else if (options.template) {
      metadata.templateKey = options.template;
    }
    Object.defineProperty(constructor, COMPONENT_METADATA, { value: metadata, configurable: true });
    if (!customElements.get(options.tag)) customElements.define(options.tag, constructor);
    return constructor;
  };
}

/** Metadata set by `defineComponent`, if any. */
export function getComponentMetadata(constructor: Ctor | (abstract new (...args: never[]) => unknown) | object): ComponentMetadata | undefined {
  return (constructor as unknown as Record<symbol, ComponentMetadata | undefined>)[COMPONENT_METADATA];
}
