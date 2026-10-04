import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { deepMerge, isPlainObject } from "./object";
import type { ModuleResolver, PluginDefinition } from "./plugin";

/** The `libreoj` block of a plugin package's `package.json`. */
export interface PluginManifest {
  /** Entry module, relative to the package root. Falls back to `main`, then to the resolved file. */
  entry?: string;
  /** Default configuration for the plugin, the lowest layer under the plugin's own `config.defaults`. */
  config?: Record<string, unknown>;
}

interface PackageJson {
  main?: string;
  libreoj?: PluginManifest;
}

export interface NodeResolverOptions {
  /** Directory relative plugin paths and package lookups are resolved from. Defaults to `process.cwd()`. */
  baseDir?: string;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

/** Picks a `PluginDefinition` out of a module's exports: `plugin`, then `default`, then the export itself. */
function extractDefinition(moduleExports: unknown): PluginDefinition | undefined {
  if (!isPlainObject(moduleExports)) return undefined;

  const candidate = moduleExports.plugin ?? moduleExports.default ?? moduleExports;
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
 * A {@link ModuleResolver} that loads CommonJS plugin packages from the filesystem with `require`.
 *
 * Lookup: a name starting with `.` or an absolute path is resolved from `baseDir`; anything else is resolved as a
 * package from `baseDir`. The nearest `package.json` is read for the `libreoj` manifest: `libreoj.entry` selects the
 * entry module (otherwise `main`, otherwise the resolved file) and `libreoj.config` supplies default configuration
 * *below* the plugin's own `config.defaults`.
 *
 * M1 supports CommonJS entries only. An ESM entry (`import()`) is deferred: a plugin distributed as ESM would need an
 * asynchronous `resolve` and a `.mjs`/`"type": "module"` aware loader.
 */
export class NodeResolver implements ModuleResolver {
  private readonly baseDir: string;

  constructor(options: NodeResolverOptions = {}) {
    this.baseDir = options.baseDir ?? process.cwd();
  }

  resolve(name: string): PluginDefinition {
    const resolvedFile = this.resolveFile(name);

    let packageRoot = path.dirname(resolvedFile);
    let manifest: PackageJson = {};
    const packageJsonPath = findPackageJson(packageRoot);
    if (packageJsonPath) {
      packageRoot = path.dirname(packageJsonPath);
      manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
    }

    const entryFile = this.resolveEntry(name, resolvedFile, packageRoot, manifest);

    let moduleExports: unknown;
    try {
      moduleExports = require(entryFile);
    } catch (error) {
      throw new Error(`Failed to load plugin "${name}" from "${entryFile}": ${describeError(error)}`);
    }

    const definition = extractDefinition(moduleExports);
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
