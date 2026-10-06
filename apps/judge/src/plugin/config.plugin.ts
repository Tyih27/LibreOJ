import type { PluginDefinition } from "@libreoj/plugin-core";

import { initializeConfig, loadConfig } from "../config";
import { JUDGE_CONFIG } from "../seam";

/**
 * The plugin that provides the `judgeConfig` seam. Applying it reads and validates the configuration file through
 * {@link loadConfig}, applies its filesystem effects and warning checks through {@link initializeConfig}, and
 * publishes the result under {@link JUDGE_CONFIG}.
 *
 * This replaces the previous import-time singleton: loading and directory initialization now happen when the plugin
 * is applied, and a fatal configuration error rejects `host.load` (through fatal failure mode) instead of running at
 * module import. Other plugins depend on this seam, so it is the first bundle in the composition root.
 */
export const configPlugin: PluginDefinition = {
  name: "@libreoj/judge-config",
  provide: [JUDGE_CONFIG],
  apply(ctx) {
    const cfg = loadConfig();
    initializeConfig(cfg);
    ctx.set(JUDGE_CONFIG, cfg);
  }
};
