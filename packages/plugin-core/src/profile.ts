import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { resolveProfileChain, type ConfigLayer, type Profile } from "./config";
import { isPlainObject } from "./object";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads and parses a YAML file, wrapping I/O and syntax failures in a message that names the file. */
function readYaml(filePath: string): unknown {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read config file "${filePath}": ${describeError(error)}`);
  }

  try {
    return load(text);
  } catch (error) {
    throw new Error(`Invalid YAML in "${filePath}": ${describeError(error)}`);
  }
}

/**
 * Validates the optional layer fields of a parsed document (a single profile, a named profile, or a patch file).
 * Each field must have the type its key implies; `label` names the document and profile so the error points at the
 * offending field. `extends` is accepted here even for patch files, where it is simply ignored by {@link toLayer}.
 */
function validateLayerFields(document: Record<string, unknown>, label: string): void {
  if (document.name !== undefined && typeof document.name !== "string") {
    throw new Error(`${label}: "name" must be a string`);
  }
  if (document.extends !== undefined && typeof document.extends !== "string") {
    throw new Error(`${label}: "extends" must be a string`);
  }

  for (const field of ["bundles", "plugins"] as const) {
    const value = document[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
      throw new Error(`${label}: "${field}" must be an array of strings`);
    }
  }

  for (const field of ["config", "patch"] as const) {
    const value = document[field];
    if (value !== undefined && !isPlainObject(value)) {
      throw new Error(`${label}: "${field}" must be a mapping`);
    }
  }
}

/**
 * Keeps only the `ConfigLayer` keys of a parsed document. Profile-only keys such as `extends` are dropped, because a
 * layer has no chain to follow.
 */
function toLayer(document: Record<string, unknown>): ConfigLayer {
  const layer: ConfigLayer = {};
  if (typeof document.name === "string") layer.name = document.name;
  if (Array.isArray(document.bundles)) layer.bundles = document.bundles as string[];
  if (Array.isArray(document.plugins)) layer.plugins = document.plugins as string[];
  if (isPlainObject(document.config)) layer.config = document.config;
  if (isPlainObject(document.patch)) layer.patch = document.patch;
  return layer;
}

/**
 * Loads a profile file into its ordered configuration layers.
 *
 * Two shapes are accepted:
 *
 * - A multi-profile file with a `profiles` mapping and an `active` name; the active profile's `extends` chain is
 *   expanded base-first, so earlier layers are overridden by later ones.
 * - A single-profile file with no `profiles` key; the whole document is one layer (it cannot `extends`).
 *
 * A missing file, invalid YAML, a file that is not a mapping, an undefined `active`, or an unknown profile all throw.
 */
export function loadProfileFile(filePath: string): ConfigLayer[] {
  const document = readYaml(filePath);
  if (!isPlainObject(document)) {
    throw new Error(`Profile file "${filePath}" must contain a YAML mapping`);
  }

  if (document.profiles === undefined) {
    validateLayerFields(document, `Profile file "${filePath}"`);
    return [toLayer(document)];
  }

  if (!isPlainObject(document.profiles)) {
    throw new Error(`"profiles" in "${filePath}" must be a mapping`);
  }
  if (typeof document.active !== "string" || document.active.length === 0) {
    throw new Error(`Profile file "${filePath}" must define a non-empty "active" profile`);
  }

  const profiles = document.profiles as Record<string, unknown>;
  for (const [name, profile] of Object.entries(profiles)) {
    if (!isPlainObject(profile)) {
      throw new Error(`Profile "${name}" in "${filePath}" must be a mapping`);
    }
    validateLayerFields(profile, `Profile "${name}" in "${filePath}"`);
  }

  if (!Object.prototype.hasOwnProperty.call(profiles, document.active)) {
    throw new Error(`Active profile "${document.active}" is not defined in "${filePath}"`);
  }

  return resolveProfileChain(document.active, profiles as Record<string, Profile>);
}

/**
 * Loads a YAML file as a single overlay layer (`name`/`bundles`/`plugins`/`config`/`patch`), applied after the
 * profile's own layers. Missing files, invalid YAML, and non-mapping documents throw.
 */
export function loadPatchFile(filePath: string): ConfigLayer {
  const document = readYaml(filePath);
  if (!isPlainObject(document)) {
    throw new Error(`Patch file "${filePath}" must contain a YAML mapping`);
  }
  validateLayerFields(document, `Patch file "${filePath}"`);
  return toLayer(document);
}
