import type { PluginDefinition } from "@libreoj/plugin-core";

import type { Config } from "../config";
import type { RPC } from "../rpc";
import { JUDGE_CONFIG, JUDGE_RPC } from "../seam";

/**
 * The plugin that starts the judge's task-consuming threads.
 *
 * It is start-only: there is nothing to register at apply time, so the threads are launched in `start`, after the whole
 * tree has settled. Because the RPC plugin is listed before this bundle, its `start` has already awaited `connect()`, so
 * the consumer threads only begin polling once the socket is ready.
 *
 * `startTaskConsumerThread` is an infinite consume loop (it never returns). It must not be awaited: awaiting it would
 * keep `host.load` from ever resolving and stall the process before the threads could be started. Fire-and-forget
 * `void` is the intended way to run it.
 */
export const consumerPlugin: PluginDefinition = {
  name: "@libreoj/judge-consumer",
  inject: { required: [JUDGE_CONFIG, JUDGE_RPC] },
  apply() {
    // Nothing to register; the consumer threads are launched in `start` below.
  },
  start(ctx) {
    const cfg = ctx.get<Config>(JUDGE_CONFIG);
    const rpc = ctx.get<RPC>(JUDGE_RPC);
    // eslint-disable-next-line no-void
    for (let i = 0; i < cfg.taskConsumingThreads; i++) void rpc.startTaskConsumerThread(i);
  }
};
