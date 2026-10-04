import * as path from "node:path";
import type { ConfigLayer } from "./config";
import { loadPatchFile, loadProfileFile } from "./profile";

export interface ComposeLayersOptions {
  /** Path to the profile YAML whose `extends` chain expands to the base layers. */
  profile: string;
  /**
   * Path to the site/home patch layer, applied after the profile's own layers and before the CLI patches.
   * Callers typically pass `process.env.LIBREOJ_PATCH_FILE`.
   */
  homePatchFile?: string;
  /** Ordered CLI overlay files, applied last; each one overrides the ones before it. */
  patches?: string[];
}

/**
 * Assembles the full configuration layer stack shared by every loader and the `dump-config` CLI. Layers are applied in
 * the dsh order, later overriding earlier:
 *
 * 1. the profile file, expanded base-first through its `extends` chain (each profile's own `patch` rides in its layer);
 * 2. the site/home patch file, when one is given;
 * 3. each CLI `--patch` overlay, in the order supplied.
 *
 * Relative paths are resolved from the current working directory, matching CLI semantics. Missing files, invalid YAML,
 * and malformed documents all throw from {@link loadProfileFile} / {@link loadPatchFile}.
 */
export function composeLayers(options: ComposeLayersOptions): ConfigLayer[] {
  const layers = loadProfileFile(path.resolve(options.profile));

  const homePatchFile = options.homePatchFile;
  if (homePatchFile !== undefined && homePatchFile.length > 0) {
    layers.push(loadPatchFile(path.resolve(homePatchFile)));
  }

  for (const patch of options.patches ?? []) {
    layers.push(loadPatchFile(path.resolve(patch)));
  }

  return layers;
}
