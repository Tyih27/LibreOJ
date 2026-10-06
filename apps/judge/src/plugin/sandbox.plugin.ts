import type { PluginDefinition } from "@libreoj/plugin-core";

import type { Config } from "../config";
import { createSandboxService } from "../sandbox";
import type { RPC } from "../rpc";
import { JUDGE_CONFIG, JUDGE_RPC, JUDGE_SANDBOX } from "../seam";

/**
 * The plugin that provides the `judgeSandbox` seam. Applying it builds the sandbox runner through
 * {@link createSandboxService} and publishes it under {@link JUDGE_SANDBOX}; the resolved sandbox user and the runner
 * are owned by the plugin's context and created at apply time instead of at module import time.
 *
 * It requires the RPC client, because the runner consults it for cancellation. Consumers resolve the runner through
 * `getSandbox()`.
 */
export const sandboxPlugin: PluginDefinition = {
  name: "@libreoj/judge-sandbox",
  inject: { required: [JUDGE_CONFIG, JUDGE_RPC] },
  provide: [JUDGE_SANDBOX],
  apply(ctx) {
    ctx.set(JUDGE_SANDBOX, createSandboxService(ctx.get<Config>(JUDGE_CONFIG), ctx.get<RPC>(JUDGE_RPC)));
  }
};
