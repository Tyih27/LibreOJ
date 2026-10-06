import "./logging";
import "reflect-metadata";
import * as winston from "winston";
import { InlineResolver, PluginHost } from "@libreoj/plugin-core";

import { checkersPlugin } from "./plugin/checkers.plugin";
import { compilePlugin } from "./plugin/compile.plugin";
import { configPlugin } from "./plugin/config.plugin";
import { filePlugin } from "./plugin/file.plugin";
import { languagesPlugin } from "./plugin/languages.plugin";
import { setPluginHost } from "./plugin/plugin-host";
import { rpcPlugin } from "./plugin/rpc.plugin";
import { sandboxPlugin } from "./plugin/sandbox.plugin";
import { getConfig } from "./plugin/services";
import { taskQueuePlugin } from "./plugin/taskQueue.plugin";
import type { RPC } from "./rpc";
import { JUDGE_RPC } from "./seam";

if (process.getuid() !== 0) {
  winston.error("This program requires root to run");
  process.exit(1);
}

const JUDGE_CONFIG_BUNDLE = "@libreoj/judge-config";
const JUDGE_LANGUAGES_BUNDLE = "@libreoj/judge-languages";
const JUDGE_CHECKERS_BUNDLE = "@libreoj/judge-checkers";
const JUDGE_TASK_QUEUE_BUNDLE = "@libreoj/judge-task-queue";
const JUDGE_RPC_BUNDLE = "@libreoj/judge-rpc";
const JUDGE_SANDBOX_BUNDLE = "@libreoj/judge-sandbox";
const JUDGE_FILE_BUNDLE = "@libreoj/judge-file";
const JUDGE_COMPILE_BUNDLE = "@libreoj/judge-compile";

// The judge's composition root. It is registered with the module-level accessor before `host.load()`, so the
// `languages` and `checkerRegistry` seams (resolved lazily from `getLanguage` and the checker lookups) read the same
// host. Every runtime service is now a plugin; the RPC connection is established by the RPC plugin's `start`, which the
// host awaits during `load`, so the task consumer threads are still started only after the connection is ready.
const host = new PluginHost({
  resolver: new InlineResolver({
    [JUDGE_CONFIG_BUNDLE]: configPlugin,
    [JUDGE_LANGUAGES_BUNDLE]: languagesPlugin,
    [JUDGE_CHECKERS_BUNDLE]: checkersPlugin,
    [JUDGE_TASK_QUEUE_BUNDLE]: taskQueuePlugin,
    [JUDGE_RPC_BUNDLE]: rpcPlugin,
    [JUDGE_SANDBOX_BUNDLE]: sandboxPlugin,
    [JUDGE_FILE_BUNDLE]: filePlugin,
    [JUDGE_COMPILE_BUNDLE]: compilePlugin
  }),
  failureMode: "fatal"
});

setPluginHost(host);

host
  .load([
    {
      bundles: [
        JUDGE_CONFIG_BUNDLE,
        JUDGE_LANGUAGES_BUNDLE,
        JUDGE_CHECKERS_BUNDLE,
        JUDGE_TASK_QUEUE_BUNDLE,
        JUDGE_RPC_BUNDLE,
        JUDGE_SANDBOX_BUNDLE,
        JUDGE_FILE_BUNDLE,
        JUDGE_COMPILE_BUNDLE
      ]
    }
  ])
  .then(() => {
    const rpc = host.root.get<RPC>(JUDGE_RPC);
    for (let i = 0; i < getConfig().taskConsumingThreads; i++) rpc.startTaskConsumerThread(i);
  });
