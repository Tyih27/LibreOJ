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
 * Service dependencies. `required` gates activation: the plugin stays `pending` until every required service is
 * resolvable. `optional` never gates activation: it only declares services the plugin may observe, exposed through
 * `Fiber.optionalAvailable` / `Fiber.missingOptional()` and reacted to with `ctx.inject`.
 */
export interface Inject {
  required?: string[];
  optional?: string[];
}

/**
 * The static description of a plugin. `apply` registers the plugin's services and effects; `start` is called once,
 * after every plugin that could be activated has settled, for work that needs the whole tree registered first.
 */
export interface PluginDefinition<TConfig = Record<string, unknown>> {
  /** Unique id within a host, e.g. "@libreoj/http-nest". */
  name: string;
  /** Service dependencies: `required` gates activation, `optional` is declarative and never gates. */
  inject?: { required?: string[]; optional?: string[] };
  /** Service names this plugin registers, declared for diagnostics; the actual registration happens in `apply`. */
  provide?: string[];
  config?: PluginConfigSchema<TConfig>;
  apply(ctx: Context, config: TConfig): void | Promise<void>;
  start?(ctx: Context, config: TConfig): void | Promise<void>;
}

/**
 * Cordis-style plugin: a callable that registers services/effects, optionally carrying the same static metadata as a
 * `PluginDefinition` (`name`/`inject`/`provide`/`Config`/`start`). `normalizePlugin` lifts it into a definition.
 */
export type PluginFunction<C = Record<string, unknown>> = ((ctx: Context, config: C) => void | Promise<void>) & {
  name?: string;
  inject?: Inject;
  provide?: string[];
  Config?: PluginConfigSchema<C>;
  start?: (ctx: Context, config: C) => void | Promise<void>;
};

/** Either a callable plugin or an explicit definition; both normalize to a `PluginDefinition`. */
export type PluginInput<C = Record<string, unknown>> = PluginFunction<C> | PluginDefinition<C>;

/**
 * Normalizes a plugin input into a `PluginDefinition`. A function keeps its own name, or the fallback when anonymous;
 * one of the two must be present. An object is returned unchanged after validating its name.
 */
export function normalizePlugin<C>(input: PluginInput<C>, fallbackName?: string): PluginDefinition<C> {
  if (typeof input === "function") {
    const name = input.name || fallbackName;
    if (!name) throw new Error("Plugin function must have a name, or a fallback name must be provided");
    return {
      name,
      inject: input.inject,
      provide: input.provide,
      config: input.Config,
      apply: input,
      start: input.start
    };
  }

  if (!input.name) throw new Error("Plugin must have a non-empty name");
  return input;
}

/** Options for {@link ModuleResolver.resolve}. */
export interface ResolveOptions {
  /**
   * Load the module fresh, bypassing any module cache, so a definition changed on disk is picked up. Supported for
   * CommonJS entries; a resolver may ignore it where the runtime offers no cache invalidation.
   */
  fresh?: boolean;
}

/**
 * Turns a plugin name into its definition. The kernel is agnostic to how modules are loaded. Resolution is
 * synchronous for in-memory resolvers and for CommonJS, and asynchronous when the entry is an ES module.
 */
export interface ModuleResolver {
  resolve(name: string, options?: ResolveOptions): PluginDefinition | Promise<PluginDefinition>;
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
