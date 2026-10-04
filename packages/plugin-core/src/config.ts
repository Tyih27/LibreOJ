import { deepMerge, isPlainObject } from "./object";

/**
 * Where a resolved plugin entry came from. `bundles` and `plugins` are contributed by configuration layers;
 * `runtime` marks a plugin mounted after `load` through `PluginHost.install`.
 */
export type PluginSource = "bundles" | "plugins" | "runtime";

/** One layer of the configuration stack: a profile, a site patch file, or a CLI overlay. */
export interface ConfigLayer {
  /** Human-readable layer name, used for diagnostics only. */
  name?: string;
  /** Plugin package names contributed by this layer, applied in order. */
  bundles?: string[];
  /** Out-of-tree plugins (local paths or package names) contributed by this layer, applied in order. */
  plugins?: string[];
  /** Default configuration per plugin, merged into the running tree. */
  config?: Record<string, unknown>;
  /** Overrides applied after this layer's bundles; `{ disabled: true }` disables an entry. */
  patch?: Record<string, unknown>;
}

/** A named profile, which may extend another profile applied before it. */
export interface Profile extends ConfigLayer {
  extends?: string;
}

export interface ResolvedPlugin {
  name: string;
  source: PluginSource;
  config: Record<string, unknown>;
  /** Whether an upper layer disabled this entry. Disabled entries stay visible so dump-config can report them. */
  disabled: boolean;
}

export interface ResolvedConfig {
  plugins: ResolvedPlugin[];
  /** Diagnostics for entries that were recognized but could not be applied, in layer order. */
  warnings: string[];
}

/**
 * Expands a profile into its ordered layers, following `extends` transitively. The base profile comes first and the
 * requested profile last, matching the application order. Throws on unknown profiles and cyclic chains.
 */
export function resolveProfileChain(entry: string, profiles: Record<string, Profile>): ConfigLayer[] {
  const chain: Profile[] = [];
  const seen = new Set<string>();
  let current: string | undefined = entry;

  while (current !== undefined) {
    if (seen.has(current)) throw new Error(`Cyclic profile extends chain detected at "${current}"`);
    seen.add(current);

    const profile: Profile | undefined = profiles[current];
    if (!profile) throw new Error(`Unknown profile "${current}" referenced by extends`);

    chain.push(profile);
    current = profile.extends;
  }

  chain.reverse();
  return chain.map(({ extends: _extends, ...layer }) => layer);
}

function layerLabel(layer: ConfigLayer, index: number): string {
  return layer.name ?? `<layer ${index}>`;
}

/**
 * Flattens an ordered layer stack into the effective plugin tree. Resolution runs in two passes so that a `config` or
 * `patch` entry may forward-reference a plugin registered by a later layer. The first pass registers every layer's
 * `bundles` and `plugins` in order (deduplicated by first occurrence, recording the first source). The second pass
 * walks the layers again, deep-merging each `config`, then applying each `patch` (upper layers win; `disabled` toggles
 * an entry without dropping it).
 *
 * Entries that mention a plugin no layer ever registers, or whose value is not a plain object, cannot be applied;
 * instead of being silently dropped they are reported in `warnings`.
 */
export function resolveConfig(layers: ConfigLayer[]): ResolvedConfig {
  const order: string[] = [];
  const sources = new Map<string, PluginSource>();
  const configs = new Map<string, Record<string, unknown>>();
  const disabled = new Map<string, boolean>();
  const warnings: string[] = [];

  const register = (name: string, source: PluginSource): void => {
    if (sources.has(name)) return;
    order.push(name);
    sources.set(name, source);
    configs.set(name, {});
    disabled.set(name, false);
  };

  const warn = (kind: "config" | "patch", name: string, label: string, reason: string): void => {
    warnings.push(`${kind} entry for plugin "${name}" in layer "${label}" was ignored: ${reason}`);
  };

  // Pass 1: register every plugin contributed by any layer, allowing forward references in pass 2.
  for (const layer of layers) {
    for (const name of layer.bundles ?? []) register(name, "bundles");
    for (const name of layer.plugins ?? []) register(name, "plugins");
  }

  // Pass 2: apply configuration in layer order, so later layers still override earlier ones.
  layers.forEach((layer, index) => {
    const label = layerLabel(layer, index);

    for (const [name, value] of Object.entries(layer.config ?? {})) {
      if (!sources.has(name)) {
        warn("config", name, label, "plugin is not registered by any layer");
        continue;
      }
      if (!isPlainObject(value)) {
        warn("config", name, label, "value is not a plain object");
        continue;
      }
      configs.set(name, deepMerge(configs.get(name) as Record<string, unknown>, value));
    }

    for (const [name, value] of Object.entries(layer.patch ?? {})) {
      if (!sources.has(name)) {
        warn("patch", name, label, "plugin is not registered by any layer");
        continue;
      }
      if (!isPlainObject(value)) {
        warn("patch", name, label, "value is not a plain object");
        continue;
      }
      const { disabled: flag, ...rest } = value;
      if (Object.keys(rest).length > 0) {
        configs.set(name, deepMerge(configs.get(name) as Record<string, unknown>, rest));
      }
      if (flag !== undefined) {
        if (typeof flag === "boolean") disabled.set(name, flag);
        else warn("patch", name, label, `"disabled" must be a boolean, got ${typeof flag}`);
      }
    }
  });

  return {
    plugins: order.map(name => ({
      name,
      source: sources.get(name) as PluginSource,
      config: configs.get(name) as Record<string, unknown>,
      disabled: disabled.get(name) as boolean
    })),
    warnings
  };
}

/** Convenience wrapper: expand `entry` (following `extends`) and resolve it in one call. */
export function resolveProfileConfig(entry: string, profiles: Record<string, Profile>): ResolvedConfig {
  return resolveConfig(resolveProfileChain(entry, profiles));
}
