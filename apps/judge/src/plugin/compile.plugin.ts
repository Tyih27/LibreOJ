import type { PluginDefinition } from "@libreoj/plugin-core";

import config from "../config";
import { createCompileService } from "../compile";
import {
  JUDGE_COMPILE,
  JUDGE_FILE,
  JUDGE_SANDBOX,
  JUDGE_TASK_QUEUE,
  type FileService,
  type SandboxService,
  type TaskQueueService
} from "../seam";

/**
 * The plugin that provides the `judgeCompile` seam. Applying it builds the compilation front end through
 * {@link createCompileService} and publishes it under {@link JUDGE_COMPILE}; the result cache and in-flight compile
 * map are owned by the plugin's context and created at apply time instead of at module import time.
 *
 * It requires the task queue (compilation is scheduled through `TaskQueueService.runTaskQueued`), the sandbox (the
 * compiler runs in it) and the file store (extra source files are located through it). Consumers resolve the compiler
 * through `getCompile()`, so they need not depend on this plugin directly.
 */
export const compilePlugin: PluginDefinition = {
  name: "@libreoj/judge-compile",
  inject: { required: [JUDGE_TASK_QUEUE, JUDGE_SANDBOX, JUDGE_FILE] },
  provide: [JUDGE_COMPILE],
  apply(ctx) {
    ctx.set(
      JUDGE_COMPILE,
      createCompileService(
        config,
        ctx.get<TaskQueueService>(JUDGE_TASK_QUEUE),
        ctx.get<SandboxService>(JUDGE_SANDBOX),
        ctx.get<FileService>(JUDGE_FILE)
      )
    );
  }
};
