import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { isPlainObject } from "./object";
import { normalizePlugin, type PluginFunction, type PluginDefinition } from "./plugin";

/** The `libreoj` block of a plugin package's `package.json`. */
export interface PluginManifest {
  /** Entry module, relative to the package root. Falls back to `main`, then to the resolved file. */
  entry?: string;
  /** Default configuration for the plugin, the lowest layer under the plugin's own `config.defaults`. */
  config?: Record<string, unknown>;
}

/** The subset of a package's `package.json` that the resolver and validator read. */
export interface PluginPackageJson {
  main?: string;
  /** Node's module kind for the package: `"module"` makes its `.js` files (and the entry) ES modules. */
  type?: string;
  libreoj?: PluginManifest;
}

/** Walks up from `start` to the nearest directory containing a `package.json`. */
export function findPackageJson(start: string): string | undefined {
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
 * Reads and parses a `package.json`. Throws when the file is missing, is not valid JSON, or does not contain a JSON
 * object (a bare `null`, array, or primitive is rejected rather than surfaced as a confusing property access).
 */
export function readPackageJson(packageJsonPath: string): PluginPackageJson {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid package.json at "${packageJsonPath}": expected a JSON object.`);
  }
  return parsed as PluginPackageJson;
}

/**
 * Unwraps a module's exports to the value that describes the plugin: an ES module's named `plugin` export, then its
 * `default` export, then the exports object itself (a CommonJS module's `module.exports` when neither is present).
 */
export function unwrapExports(moduleExports: unknown): unknown {
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
export function toDefinition(candidate: unknown, fallbackName: string): PluginDefinition | undefined {
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
