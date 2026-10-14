import type { ModuleResolver, PluginDefinition, ResolveOptions } from "./plugin";

/**
 * A {@link ModuleResolver} that tries an ordered list of resolvers and returns the first success. A resolver is
 * attempted only when the ones before it fail: a synchronous throw or a rejected promise advances to the next
 * resolver, while a resolved value -- synchronous or asynchronous -- short-circuits and is returned. When every
 * resolver fails, the last error is rethrown, because it is the most concrete (for example the filesystem
 * {@link NodeResolver}'s "Cannot resolve plugin ...").
 *
 * This lets a host resolve its in-tree bundles from an in-memory map and anything else from the filesystem, so a
 * profile entry the map does not know falls through instead of aborting boot.
 */
export class ChainResolver implements ModuleResolver {
  private readonly resolvers: readonly ModuleResolver[];

  constructor(resolvers: readonly ModuleResolver[]) {
    if (resolvers.length === 0) throw new Error("ChainResolver requires at least one resolver");
    this.resolvers = resolvers;
  }

  async resolve(name: string, options?: ResolveOptions): Promise<PluginDefinition> {
    let lastError: unknown;
    for (const resolver of this.resolvers) {
      try {
        // `await` also catches a synchronous throw from `resolve`, so a sync miss and an async rejection are handled
        // identically, and a resolved value returns before the remaining resolvers run.
        return await resolver.resolve(name, options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}
