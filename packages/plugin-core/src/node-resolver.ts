import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { deepMerge, isPlainObject } from "./object";
import {
  normalizePlugin,
  type ModuleResolver,
  type PluginDefinition,
  type PluginFunction,
  type ResolveOptions
} from "./plugin";

/** The `libreoj` block of a plugin package's `package.json`. */
export interface PluginManifest {
  /** Entry module, relative to the package root. Falls back to `main`, then to the resolved file. */
  entry?: string;
  /** Default configuration for the plugin, the lowest layer under the plugin's own `config.defaults`. */
  config?: Record<string, unknown>;
}

interface PackageJson {
  main?: string;
  /** Node's module kind for the package: `"module"` makes its `.js` files (and the entry) ES modules. */
  type?: string;
  libreoj?: PluginManifest;
}

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

/** Walks up from `start` to the nearest directory containing a `package.json`. */
function findPackageJson(start: string): string | undefined {
  let dir = start;
  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Unwraps a module's exports to the value that describes the plugin: an ES module's named `plugin` export, then its
 * `default` export, then the exports object itself (a CommonJS module's `module.exports` when neither is present).
 */
function unwrapExports(moduleExports: unknown): unknown {
  if (moduleExports === null || (typeof moduleExports !== "object" && typeof moduleExports !== "function")) {
    return moduleExports;
  }
  const record = moduleExports as { plugin?: unknown; default?: unknown };
  if (record.plugin !== undefined) return record.plugin;
  if (record.default !== undefined) return record.default;
  return moduleExports;
}

/**
 * Normalizes an unwrapped module export into a `PluginDefinition`: a function is lifted through `normalizePlugin`
 * (using its own name, or `fallbackName` for an anonymous one), and an object must itself carry a name and apply.
 * Returns `undefined` when the export is not a usable plugin.
 */
function toDefinition(candidate: unknown, fallbackName: string): PluginDefinition | undefined {
  if (typeof candidate === "function") {
    return normalizePlugin(candidate as PluginFunction, fallbackName);
  }
  if (
    isPlainObject(candidate) &&
    typeof (candidate as { name?: unknown }).name === "string" &&
    typeof (candidate as { apply?: unknown }).apply === "function"
  ) {
    return candidate as unknown as PluginDefinition;
  }
  return undefined;
}

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
    let manifest: PackageJson = {};
    let packageJsonPath: string | undefined;
    const found = findPackageJson(packageRoot);
    if (found) {
      packageJsonPath = found;
      packageRoot = path.dirname(found);
      manifest = JSON.parse(readFileSync(found, "utf8")) as PackageJson;
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
    manifest: PackageJson,
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
  private async loadEsm(name: string, entryFile: string, manifest: PackageJson): Promise<PluginDefinition> {
    let moduleExports: unknown;
    try {
      moduleExports = await dynamicImport(pathToFileURL(entryFile).href);
    } catch (error) {
      throw new Error(`Failed to load plugin "${name}" from "${entryFile}": ${describeError(error)}`);
    }

    return this.finalize(name, entryFile, manifest, moduleExports);
  }

  /** Picks the definition out of the module exports and folds in the `libreoj.config` manifest layer. */
  private finalize(name: string, entryFile: string, manifest: PackageJson, moduleExports: unknown): PluginDefinition {
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

  private resolveEntry(name: string, resolvedFile: string, packageRoot: string, manifest: PackageJson): string {
    const entry = manifest.libreoj?.entry;
    if (entry === undefined) return resolvedFile;

    try {
      return require.resolve(path.resolve(packageRoot, entry));
    } catch (error) {
      throw new Error(`Plugin "${name}" manifest entry "${entry}" could not be resolved: ${describeError(error)}`);
    }
  }
}
