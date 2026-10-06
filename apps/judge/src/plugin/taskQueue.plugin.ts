import type { PluginDefinition } from "@libreoj/plugin-core";

import config from "../config";
import { createTaskQueue } from "../taskQueue";
import { JUDGE_TASK_QUEUE } from "../seam";

/**
 * The plugin that provides the `judgeTaskQueue` seam. Applying it builds the working-directory queue through
 * {@link createTaskQueue} and publishes it under {@link JUDGE_TASK_QUEUE}; the queue is owned by the plugin's context
 * and is created at apply time instead of at module import time.
 *
 * Consumers resolve the queue through `getTaskQueue()`, so they need not depend on this plugin directly.
 */
export const taskQueuePlugin: PluginDefinition = {
  name: "@libreoj/judge-task-queue",
  provide: [JUDGE_TASK_QUEUE],
  apply(ctx) {
    ctx.set(JUDGE_TASK_QUEUE, createTaskQueue(config));
  }
};
