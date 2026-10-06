/**
 * Typed accessors for the judge's runtime services.
 *
 * Consumers call these to resolve a service from the composition root instead of importing a module-level singleton.
 * Resolution is lazy: the plugin that provides the service must already be active, which the kernel guarantees through
 * `inject.required` gating and `start` ordering.
 */

import { getPluginHost } from "./plugin-host";

import type { Config } from "../config";
import type { RPC } from "../rpc";
import {
  JUDGE_COMPILE,
  JUDGE_CONFIG,
  JUDGE_FILE,
  JUDGE_RPC,
  JUDGE_SANDBOX,
  JUDGE_TASK_QUEUE,
  type CompileService,
  type FileService,
  type SandboxService,
  type TaskQueueService
} from "../seam";

function resolve<T>(name: string): T {
  return getPluginHost().root.get<T>(name);
}

export function getConfig(): Config {
  return resolve<Config>(JUDGE_CONFIG);
}

export function getRpc(): RPC {
  return resolve<RPC>(JUDGE_RPC);
}

export function getTaskQueue(): TaskQueueService {
  return resolve<TaskQueueService>(JUDGE_TASK_QUEUE);
}

export function getCompile(): CompileService {
  return resolve<CompileService>(JUDGE_COMPILE);
}

export function getSandbox(): SandboxService {
  return resolve<SandboxService>(JUDGE_SANDBOX);
}

export function getFile(): FileService {
  return resolve<FileService>(JUDGE_FILE);
}
