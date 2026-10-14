import * as path from "node:path";
import { findPackageJson, readPackageJson, type PluginPackageJson } from "./manifest";
import { NodeResolver, type NodeResolverOptions } from "./node-resolver";
import { isPlainObject } from "./object";
import type { PluginDefinition } from "./plugin";

/**
 * The outcome of validating a plugin package against the distribution format. `ok` is true only when `errors` is
 * empty; `warnings` are advisory and never fail validation. The header fields (`definitionName`, `entry`,
 * `moduleKind`, `manifestEntry`, `manifestConfig`) are filled in as far as resolution got, so they are present even
 * when validation fails late.
 */
export interface PluginValidationResult {
  ok: boolean;
  /** The name or path the caller asked to validate, echoed back unchanged. */
  requested: string;
  /** The loaded definition's `name`, when the module loaded. */
  definitionName?: string;
  /** Absolute path of the entry module actually loaded. */
  entry?: string;
  /** How the entry is loaded: CommonJS `require` (`"cjs"`) or native dynamic `import()` (`"esm"`). */
  moduleKind?: "cjs" | "esm";
  /** The package's `libreoj.entry`, when present. */
  manifestEntry?: string;
  /** Whether the package's `package.json` declared a `libreoj.config` block. */
  manifestConfig?: boolean;
  /** Fatal conformance problems; a non-empty list means `ok` is false. */
  errors: string[];
  /** Non-fatal advisories about the package. */
  warnings: string[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether every element of `value` is a string. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

/** A bare package name (as opposed to a relative or absolute path), so `requested` names the package itself. */
function looksLikePackageName(name: string): boolean {
  return !name.startsWith(".") && !name.startsWith("/");
}

/**
 * Resolves `name` to an on-disk file the same way `NodeResolver` does, or `undefined` when it cannot be found. This
 * only locates the file so the package root and manifest can be inspected; the definition itself is still loaded
 * through `NodeResolver` below, so CJS/ESM selection stays in one place.
 */
function resolveEntryFile(name: string, baseDir: string): string | undefined {
  try {
    if (name.startsWith(".") || path.isAbsolute(name)) {
      const target = path.isAbsolute(name) ? name : path.resolve(baseDir, name);
      return require.resolve(target);
    }
    return require.resolve(name, { paths: [baseDir] });
  } catch {
    return undefined;
  }
}

/**
 * Validates that a plugin package conforms to the distribution format, returning actionable errors instead of
 * throwing. The definition is loaded through {@link NodeResolver}, so ESM entries load via dynamic `import()` and
 * CommonJS entries via `require`, using the same `libreoj.entry` → `main` → resolved file selection as the resolver.
 *
 * Fatal errors: the package or its entry cannot be resolved; there is no `package.json`; the `libreoj` manifest is not
 * an object or its `entry`/`config` fields have the wrong type; the module does not export a usable
 * `PluginDefinition` (an object with a string `name` and a function `apply`, or a named function); the definition's
 * `name` is empty/whitespace; `inject.required`/`inject.optional` or `provide` are present but not arrays of strings;
 * `config.defaults` is present but not a plain object; `config.parse` is present but not a function.
 *
 * Warnings: the package has no `libreoj.entry` (falling back to `main`); a package-name-style `requested` differs
 * from the definition's `name`; the definition declares no `config` schema.
 */
export async function validatePlugin(name: string, options: NodeResolverOptions = {}): Promise<PluginValidationResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const result: PluginValidationResult = { ok: false, requested: name, errors: [], warnings: [] };

  const resolvedFile = resolveEntryFile(name, baseDir);
  if (!resolvedFile) {
    result.errors.push(`Cannot resolve plugin "${name}" from "${baseDir}".`);
    return result;
  }

  let packageRoot = path.dirname(resolvedFile);
  const packageJsonPath = findPackageJson(packageRoot);
  if (!packageJsonPath) {
    result.errors.push(`No package.json found for "${name}" (searched upward from "${packageRoot}").`);
    return result;
  }
  packageRoot = path.dirname(packageJsonPath);

  let manifest: PluginPackageJson;
  try {
    manifest = readPackageJson(packageJsonPath);
  } catch (error) {
    result.errors.push(`Cannot read "${packageJsonPath}": ${describeError(error)}`);
    return result;
  }

  // The manifest is read as `unknown`: a real package.json can put anything under `libreoj`, and the resolver
  // silently ignores a malformed block, so the validator is where a third party finds out.
  const libreojBlock = (manifest as { libreoj?: unknown }).libreoj;
  if (libreojBlock !== undefined && !isPlainObject(libreojBlock)) {
    result.errors.push(`Plugin "${name}" libreoj manifest must be an object.`);
    return result;
  }

  const manifestEntry = libreojBlock?.entry;
  const manifestConfig = libreojBlock?.config;
  if (manifestEntry !== undefined && typeof manifestEntry !== "string") {
    result.errors.push(`Plugin "${name}" libreoj.entry must be a string.`);
    return result;
  }
  if (manifestConfig !== undefined && !isPlainObject(manifestConfig)) {
    result.errors.push(`Plugin "${name}" libreoj.config must be an object.`);
    return result;
  }

  result.manifestEntry = manifestEntry;
  result.manifestConfig = manifestConfig !== undefined;

  // Entry selection mirrors NodeResolver: `libreoj.entry`, else the resolved file (require.resolve already honored
  // the package's `main`/directory resolution).
  let entry = resolvedFile;
  if (result.manifestEntry !== undefined) {
    try {
      entry = require.resolve(path.resolve(packageRoot, result.manifestEntry));
    } catch (error) {
      result.errors.push(
        `Plugin "${name}" manifest entry "${result.manifestEntry}" could not be resolved: ${describeError(error)}`
      );
      return result;
    }
  }
  result.entry = entry;
  result.moduleKind = manifest.type === "module" || /\.mjs$|\.mts$/.test(entry) ? "esm" : "cjs";

  let definition: PluginDefinition;
  try {
    definition = await new NodeResolver(options).resolve(name);
  } catch (error) {
    result.errors.push(describeError(error));
    return result;
  }
  result.definitionName = definition.name;

  const raw = definition as unknown as Record<string, unknown>;
  const inject = raw.inject;
  const provide = raw.provide;
  const config = raw.config;

  if (definition.name.trim() === "") {
    result.errors.push(`Plugin "${name}" has an empty definition name.`);
  }

  if (inject !== undefined) {
    if (!isPlainObject(inject)) {
      result.errors.push(`Plugin "${definition.name}" inject must be an object.`);
    } else {
      for (const key of ["required", "optional"] as const) {
        const value = (inject as Record<string, unknown>)[key];
        if (value !== undefined && !isStringArray(value)) {
          result.errors.push(`Plugin "${definition.name}" inject.${key} must be an array of strings.`);
        }
      }
    }
  }

  if (provide !== undefined && !isStringArray(provide)) {
    result.errors.push(`Plugin "${definition.name}" provide must be an array of strings.`);
  }

  if (config !== undefined) {
    if (!isPlainObject(config)) {
      result.errors.push(`Plugin "${definition.name}" config must be an object.`);
    } else {
      if (config.defaults !== undefined && !isPlainObject(config.defaults)) {
        result.errors.push(`Plugin "${definition.name}" config.defaults must be a plain object.`);
      }
      if (config.parse !== undefined && typeof config.parse !== "function") {
        result.errors.push(`Plugin "${definition.name}" config.parse must be a function.`);
      }
    }
  }

  if (result.manifestEntry === undefined) {
    result.warnings.push(`Package for "${name}" has no libreoj.entry; falling back to main or the resolved file.`);
  }
  if (looksLikePackageName(name) && definition.name !== name) {
    result.warnings.push(`Requested "${name}" resolves to a plugin named "${definition.name}".`);
  }
  if (config === undefined) {
    result.warnings.push(`Plugin "${definition.name}" declares no config schema.`);
  }

  result.ok = result.errors.length === 0;
  return result;
}
