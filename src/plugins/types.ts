/**
 * Plugin types.
 *
 * @module plugins/types
 */

import type { MixinDefinition, MixinFunction } from '../mixins/types';
import type { ValidatorFn } from '../binding/types';
import type { Arethesis } from '../core/arethesis';
import type { ArethesisConfig } from '../core/types';
import type { Component } from '../components/component';

export interface ValidatorDefinition {
  fn: ValidatorFn;
  /** Default message (supports `{param}` placeholders). */
  message?: string;
}

/**
 * A plugin bundles mixins, validators and lifecycle hooks.
 *
 * @example
 * ```ts
 * const companyEmail: ArethesisPlugin = {
 *   name: 'company-email',
 *   validators: {
 *     companyEmail: { fn: v => !v || String(v).endsWith('@example.org'), message: 'Use your company address' },
 *   },
 * };
 * app.use(companyEmail);
 * ```
 */
export interface ArethesisPlugin<Options = unknown> {
  name: string;
  version?: string;
  mixins?: Record<string, MixinDefinition | MixinFunction>;
  validators?: Record<string, ValidatorDefinition | ValidatorFn>;
  /** Runs when the plugin is registered. */
  install?(app: Arethesis, options: Options): void | Promise<void>;
  /** Runs at the start of `init()`; may return an updated config. */
  beforeInit?(config: ArethesisConfig, app: Arethesis): ArethesisConfig | void | Promise<ArethesisConfig | void>;
  /** Runs at the end of `init()` (or right away for plugins added later). */
  afterInit?(app: Arethesis): void | Promise<void>;
  /** Add behavior to every component, e.g. by patching `Component.prototype`. */
  extendComponent?(base: typeof Component): void;
  /** Runs on `app.destroy()`. */
  destroy?(app: Arethesis): void;
}

/** A plugin object, the name of a built-in plugin, or either with options. */
export type PluginRef =
  | ArethesisPlugin
  | string
  | { plugin: ArethesisPlugin | string; options?: unknown };

export interface PluginRegistrationOptions {
  /** Replace a plugin (and its mixins/validators) that is already registered. */
  override?: boolean;
}
