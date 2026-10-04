import { dump } from "js-yaml";
import type { ResolvedConfig } from "./config";
import { isPlainObject } from "./object";
import type { PluginState } from "./plugin";

/**
 * The state a plugin reports in a dump. It extends the runtime lifecycle state with `"disabled"`, because a disabled
 * entry is never mounted and so has no lifecycle state to report; this keeps the runtime `PluginState` enum honest.
 */
export type PluginDumpState = PluginState | "disabled";

/** Recursively sorts object keys so dumped output is deterministic, leaving arrays in order. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
    return sorted;
  }
  return value;
}

/**
 * Serializes a resolved config tree to YAML. The output is deterministic: entries keep resolution order, per-plugin
 * config object keys are sorted, warnings keep layer order, and line wrapping is disabled so golden tests compare
 * byte for byte.
 */
export function dumpConfig(resolved: ResolvedConfig): string {
  const document = {
    plugins: resolved.plugins.map(plugin => ({
      name: plugin.name,
      source: plugin.source,
      disabled: plugin.disabled,
      config: sortKeysDeep(plugin.config)
    })),
    warnings: [...resolved.warnings]
  };

  return dump(document, { noRefs: true, lineWidth: -1 });
}
