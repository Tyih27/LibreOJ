import type { Context } from "./context";

/** Lifecycle states a plugin moves through inside a `PluginHost`. */
export type PluginState = "pending" | "loading" | "active" | "disposing" | "disposed" | "error";

/**
 * Declarative configuration handling for a plugin.
 *
 * - `defaults` is the lowest-priority configuration layer, overridden by every profile layer.
 * - `parse` validates and normalizes the merged configuration; it should throw on invalid input.
 */
export interface PluginConfigSchema<T = Record<string, unknown>> {
  parse?(input: unknown): T;
  defaults?: Record<string, unknown>;
}

/**
 * The static description of a plugin. `apply` registers the plugin's services and effects; `start` is called once,
 * after every plugin that could be activated has settled, for work that needs the whole tree registered first.
 */
export interface PluginDefinition<TConfig = Record<string, unknown>> {
  /** Unique id within a host, e.g. "@libreoj/http-nest". */
  name: string;
  /** Service dependencies: `required` gates activation, `optional` is advisory only. */
  inject?: { required?: string[]; optional?: string[] };
  /** Service names this plugin registers, declared for diagnostics; the actual registration happens in `apply`. */
  provide?: string[];
  config?: PluginConfigSchema<TConfig>;
  apply(ctx: Context, config: TConfig): void | Promise<void>;
  start?(ctx: Context, config: TConfig): void | Promise<void>;
}

/** Turns a plugin name into its definition. The kernel is agnostic to how modules are loaded. */
export interface ModuleResolver {
  resolve(name: string): PluginDefinition | Promise<PluginDefinition>;
}

/**
 * A `ModuleResolver` backed by an in-memory map. Used by tests and fixtures; a missing name throws so a misconfigured
 * profile fails loudly rather than silently dropping a plugin.
 */
export class InlineResolver implements ModuleResolver {
  constructor(private readonly modules: Record<string, PluginDefinition>) {}

  resolve(name: string): PluginDefinition {
    const definition = this.modules[name];
    if (!definition) throw new Error(`Unknown plugin "${name}"`);
    return definition;
  }
}
