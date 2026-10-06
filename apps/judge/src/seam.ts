/**
 * Service Definitions for the judge's runtime services.
 *
 * These are judge-internal seams: the contract is the concrete service's own type (mirroring the Cordis/dsh approach,
 * where a service's definition is its class/interface and there is no separate mirrored contract package). They live
 * here rather than in `@libreoj/plugin-api` because nothing outside the judge consumes them; `plugin-api` is reserved
 * for seams that cross the Backend-Judge boundary (http, code language, language, checker).
 *
 * Every service is registered by a plugin and resolved by its consumers through `root.get(NAME)`. See
 * `plugin/services.ts` for the typed accessors.
 */

import type { CompileResult, CompileTask } from "./compile";
import type { Config } from "./config";
import type { Disposer } from "./posixUtils";
import type { RPC } from "./rpc";
import type * as fileModule from "./file";
import type * as sandboxModule from "./sandbox";

/** Service name for the loaded judge {@link Config}. */
export const JUDGE_CONFIG = "judgeConfig";

/** Service name for the connected {@link RPC} client. */
export const JUDGE_RPC = "judgeRpc";

/** Service name for the task working-directory queue. */
export const JUDGE_TASK_QUEUE = "judgeTaskQueue";

/** Service name for the compilation cache/front end. */
export const JUDGE_COMPILE = "judgeCompile";

/** Service name for the sandbox runner. */
export const JUDGE_SANDBOX = "judgeSandbox";

/** Service name for the file store (requesting and locating submission data). */
export const JUDGE_FILE = "judgeFile";

/** The judge configuration, as produced by the config provider. */
export type JudgeConfig = Config;

/** The judge RPC client. */
export type JudgeRpc = RPC;

/** Runs a task when a working directory is available. */
export interface TaskQueueService {
  runTaskQueued<T>(task: (taskWorkingDirectory: string, disposer?: Disposer) => Promise<T>): Promise<T>;
}

/** Compiles a submission and caches the result. */
export interface CompileService {
  compile(compileTask: CompileTask): Promise<CompileResult>;
}

/** Runs a compiled program inside the sandbox. */
export interface SandboxService {
  startSandbox: typeof sandboxModule.startSandbox;
  runSandbox: typeof sandboxModule.runSandbox;
}

/** Requests and locates the files referenced by a task. */
export interface FileService {
  ensureFiles: typeof fileModule.ensureFiles;
  getFile: typeof fileModule.getFile;
  getFileHash: typeof fileModule.getFileHash;
}
