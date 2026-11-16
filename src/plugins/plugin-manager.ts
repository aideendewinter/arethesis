/**
 * PluginManager: registers plugins and runs their lifecycle hooks.
 *
 * @module plugins/plugin-manager
 */

import type { ArethesisPlugin, PluginRef, PluginRegistrationOptions } from './types';
import type { Arethesis } from '../core/arethesis';
import type { ArethesisConfig } from '../core/types';
import { mixinRegistry } from '../mixins/registry';
import { Component } from '../components/component';

const builtIns = new Map<string, () => ArethesisPlugin>();

/** Make a plugin loadable by name (`plugins: ['my-plugin']`). */
export function registerBuiltInPlugin(name: string, factory: () => ArethesisPlugin): void {
  builtIns.set(name, factory);
}

export class PluginManager {
  private plugins = new Map<string, { plugin: ArethesisPlugin; options: unknown }>();
  private pending: Promise<unknown>[] = [];
  private initialized = false;

  constructor(private app: Arethesis) {}

  /** Resolve a reference to a plugin object and its options. */
  resolve(ref: PluginRef, options?: unknown): { plugin: ArethesisPlugin; options: unknown } {
    if (typeof ref === 'string') {
      const factory = builtIns.get(ref);
      if (!factory) throw new Error(`Unknown plugin "${ref}". Built-in plugins: ${[...builtIns.keys()].join(', ')}`);
      return { plugin: factory(), options };
    }
    if ('plugin' in ref) {
      return this.resolve(ref.plugin, ref.options ?? options);
    }
    return { plugin: ref, options };
  }

  /** Register a plugin. Mixins and validators are available immediately. */
  use(ref: PluginRef, options?: unknown, registration: PluginRegistrationOptions = {}): void {
    const { plugin, options: opts } = this.resolve(ref, options);
    if (this.plugins.has(plugin.name) && !registration.override) {
      console.warn(`Plugin "${plugin.name}" is already registered`);
      return;
    }
    this.plugins.set(plugin.name, { plugin, options: opts });

    for (const [name, def] of Object.entries(plugin.mixins ?? {})) {
      if (mixinRegistry.has(name) && !registration.override) {
        console.warn(`Mixin "${name}" from plugin "${plugin.name}" is already registered; keeping the existing one`);
        continue;
      }
      mixinRegistry.register(name, def);
    }
    const engine = this.app.validation;
    for (const [name, def] of Object.entries(plugin.validators ?? {})) {
      if (engine.hasValidator(name) && !registration.override) {
        console.warn(`Validator "${name}" from plugin "${plugin.name}" is already registered; keeping the existing one`);
        continue;
      }
      if (typeof def === 'function') engine.registerValidator(name, def);
      else engine.registerValidator(name, def.fn, { message: def.message });
    }
    plugin.extendComponent?.(Component);

    const install = plugin.install?.(this.app, opts);
    if (install instanceof Promise) this.pending.push(install.catch(err => console.error(`Plugin "${plugin.name}" install failed:`, err)));
    if (this.initialized && plugin.afterInit) {
      this.pending.push(Promise.resolve(plugin.afterInit(this.app)).catch(err => console.error(`Plugin "${plugin.name}" afterInit failed:`, err)));
    }
  }

  /** Run `beforeInit` hooks in registration order, threading the config through. */
  async beforeInit(config: ArethesisConfig): Promise<ArethesisConfig> {
    await this.settle();
    let current = config;
    for (const { plugin } of this.plugins.values()) {
      if (plugin.beforeInit) current = (await plugin.beforeInit(current, this.app)) ?? current;
    }
    return current;
  }

  async afterInit(): Promise<void> {
    await this.settle();
    this.initialized = true;
    for (const { plugin } of this.plugins.values()) await plugin.afterInit?.(this.app);
  }

  /** Wait for async `install` hooks. */
  async settle(): Promise<void> {
    while (this.pending.length) await Promise.all(this.pending.splice(0));
  }

  get(name: string): ArethesisPlugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  names(): string[] {
    return Array.from(this.plugins.keys());
  }

  destroy(): void {
    for (const { plugin } of this.plugins.values()) plugin.destroy?.(this.app);
  }
}
