import type { PluginDefinition } from "@libreoj/plugin-core";

import type { Config } from "../config";
import { createRpc, type RPC } from "../rpc";
import { JUDGE_CONFIG, JUDGE_RPC } from "../seam";

/**
 * The plugin that provides the `judgeRpc` seam. Applying it builds the RPC client through {@link createRpc} and
 * publishes it under {@link JUDGE_RPC}; the client is owned by the plugin's context and created at apply time instead
 * of at module import time.
 *
 * The connection is established in `start`, after the whole tree has been registered, so the previous startup order
 * (host loaded, then connect) is preserved. Consumers resolve the client through `getRpc()`.
 */
export const rpcPlugin: PluginDefinition = {
  name: "@libreoj/judge-rpc",
  inject: { required: [JUDGE_CONFIG] },
  provide: [JUDGE_RPC],
  apply(ctx) {
    ctx.set(JUDGE_RPC, createRpc(ctx.get<Config>(JUDGE_CONFIG)));
  },
  async start(ctx) {
    await ctx.get<RPC>(JUDGE_RPC).connect();
  }
};
