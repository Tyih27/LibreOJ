import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { findPackageJson, readPackageJson, toDefinition, unwrapExports, type PluginPackageJson } from "./manifest";
import { deepMerge, isPlainObject } from "./object";
import { type ModuleResolver, type PluginDefinition, type ResolveOptions } from "./plugin";

export interface NodeResolverOptions {
  /** Directory relative plugin paths and package lookups are resolved from. Defaults to `process.cwd()`. */
  baseDir?: string;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A genuine dynamic `import()`. This package compiles to CommonJS, where TypeScript would downlevel a literal
 * `import()` to `require`; building the import through `new Function` keeps it a native ESM load.
 */
const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;

/**
 * A {@link ModuleResolver} that loads plugin packages from the filesystem. Lookup: a name starting with `.` or an
 * absolute path is resolved from `baseDir`; anything else is resolved as a package from `baseDir`. The nearest
 * `package.json` is read for the `libreoj` manifest (`libreoj.entry` selects the entry module, else `main`, else the
 * resolved file; `libreoj.config` supplies default configuration below the plugin's own `config.defaults`) and for
 * the module kind.
 *
 * A package is an ES module when its `package.json` sets `type: "module"` or its entry ends in `.mjs`/`.mts`; it is
 * loaded with a real dynamic `import()` and `resolve` returns a promise. Otherwise the entry is loaded with `require`
 * and `resolve` returns synchronously. Pass `{ fresh: true }` to evict the entry (and its `package.json`) from the
 * CommonJS cache, so a file changed on disk is re-read; Node's ESM loader exposes no cache invalidation, so `fresh`
 * has no effect on an ES module and a reloaded ESM plugin keeps its originally evaluated instance.
 */
export class NodeResolver implements ModuleResolver {
  private readonly baseDir: string;

  constructor(options: NodeResolverOptions = {}) {
    this.baseDir = options.baseDir ?? process.cwd();
  }

  resolve(name: string, options: ResolveOptions = {}): PluginDefinition | Promise<PluginDefinition> {
    const resolvedFile = this.resolveFile(name);

    let packageRoot = path.dirname(resolvedFile);
    let manifest: PluginPackageJson = {};
    let packageJsonPath: string | undefined;
    const found = findPackageJson(packageRoot);
    if (found) {
      packageJsonPath = found;
      packageRoot = path.dirname(found);
      manifest = readPackageJson(found);
    }

    const entryFile = this.resolveEntry(name, resolvedFile, packageRoot, manifest);
    const isEsm = manifest.type === "module" || /\.mjs$|\.mts$/.test(entryFile);

    if (isEsm) return this.loadEsm(name, entryFile, manifest);
    return this.loadCommonJs(name, entryFile, packageJsonPath, manifest, options);
  }

  /** Evicts the cached module instances for a CommonJS entry so it is re-read from disk. */
  private loadCommonJs(
    name: string,
    entryFile: string,
    packageJsonPath: string | undefined,
    manifest: PluginPackageJson,
    options: ResolveOptions
  ): PluginDefinition {
    if (options.fresh) {
      delete require.cache[entryFile];
      if (packageJsonPath) delete require.cache[packageJsonPath];
    }

    let moduleExports: unknown;
    try {
      moduleExports = require(entryFile);
    } catch (error) {
      throw new Error(`Failed to load plugin "${name}" from "${entryFile}": ${describeError(error)}`);
    }

    return this.finalize(name, entryFile, manifest, moduleExports);
  }

  /** Loads an ES module entry with a native dynamic `import()`, which no cache-invalidation API can bypass. */
  private async loadEsm(name: string, entryFile: string, manifest: PluginPackageJson): Promise<PluginDefinition> {
    let moduleExports: unknown;
    try {
      moduleExports = await dynamicImport(pathToFileURL(entryFile).href);
    } catch (error) {
      throw new Error(`Failed to load plugin "${name}" from "${entryFile}": ${describeError(error)}`);
    }

    return this.finalize(name, entryFile, manifest, moduleExports);
  }

  /** Picks the definition out of the module exports and folds in the `libreoj.config` manifest layer. */
  private finalize(
    name: string,
    entryFile: string,
    manifest: PluginPackageJson,
    moduleExports: unknown
  ): PluginDefinition {
    const definition = toDefinition(unwrapExports(moduleExports), name);
    if (!definition) {
      throw new Error(
        `Plugin "${name}" at "${entryFile}" does not export a PluginDefinition ` +
          `(expected a \`plugin\` or \`default\` export with a name and apply)`
      );
    }

    const manifestConfig = manifest.libreoj?.config;
    if (!isPlainObject(manifestConfig)) return definition;

    // The manifest is the lowest default layer: the plugin's own `config.defaults` overrides it.
    const defaults = deepMerge(manifestConfig, definition.config?.defaults ?? {});
    return { ...definition, config: { ...(definition.config ?? {}), defaults } };
  }

  private resolveFile(name: string): string {
    if (name.startsWith(".") || path.isAbsolute(name)) {
      const target = path.isAbsolute(name) ? name : path.resolve(this.baseDir, name);
      try {
        return require.resolve(target);
      } catch (error) {
        throw new Error(`Cannot resolve plugin "${name}" from "${this.baseDir}": ${describeError(error)}`);
      }
    }

    try {
      return require.resolve(name, { paths: [this.baseDir] });
    } catch (error) {
      throw new Error(`Cannot resolve plugin "${name}" from "${this.baseDir}": ${describeError(error)}`);
    }
  }

  private resolveEntry(name: string, resolvedFile: string, packageRoot: string, manifest: PluginPackageJson): string {
    const entry = manifest.libreoj?.entry;
    if (entry === undefined) return resolvedFile;

    try {
      return require.resolve(path.resolve(packageRoot, entry));
    } catch (error) {
      throw new Error(`Plugin "${name}" manifest entry "${entry}" could not be resolved: ${describeError(error)}`);
    }
  }
}
