import type { PluginDefinition } from "@libreoj/plugin-core";

import config from "../config";
import { createCompileService } from "../compile";
import { JUDGE_COMPILE, JUDGE_TASK_QUEUE, type TaskQueueService } from "../seam";

/**
 * The plugin that provides the `judgeCompile` seam. Applying it builds the compilation front end through
 * {@link createCompileService} and publishes it under {@link JUDGE_COMPILE}; the result cache and in-flight compile
 * map are owned by the plugin's context and created at apply time instead of at module import time.
 *
 * It requires the task queue, because compilation is scheduled through `TaskQueueService.runTaskQueued`. Consumers
 * resolve the compiler through `getCompile()`, so they need not depend on this plugin directly.
 */
export const compilePlugin: PluginDefinition = {
  name: "@libreoj/judge-compile",
  inject: { required: [JUDGE_TASK_QUEUE] },
  provide: [JUDGE_COMPILE],
  apply(ctx) {
    ctx.set(JUDGE_COMPILE, createCompileService(config, ctx.get<TaskQueueService>(JUDGE_TASK_QUEUE)));
  }
};
