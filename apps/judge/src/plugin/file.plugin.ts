import type { PluginDefinition } from "@libreoj/plugin-core";

import type { Config } from "../config";
import { createFileService } from "../file";
import type { RPC } from "../rpc";
import { JUDGE_CONFIG, JUDGE_FILE, JUDGE_RPC } from "../seam";

/**
 * The plugin that provides the `judgeFile` seam. Applying it builds the file store through {@link createFileService}
 * and publishes it under {@link JUDGE_FILE}; the download queue, in-flight map and hash cache are owned by the plugin's
 * context and created at apply time instead of at module import time.
 *
 * It requires the RPC client, because the store requests missing files through it. Consumers resolve the store through
 * `getFile()`.
 */
export const filePlugin: PluginDefinition = {
  name: "@libreoj/judge-file",
  inject: { required: [JUDGE_CONFIG, JUDGE_RPC] },
  provide: [JUDGE_FILE],
  apply(ctx) {
    ctx.set(JUDGE_FILE, createFileService(ctx.get<Config>(JUDGE_CONFIG), ctx.get<RPC>(JUDGE_RPC)));
  }
};
