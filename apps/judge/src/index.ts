import "reflect-metadata";
import * as winston from "winston";
import { InlineResolver, PluginHost } from "@libreoj/plugin-core";

import config from "./config";
import rpc from "./rpc";
import { checkersPlugin } from "./plugin/checkers.plugin";
import { compilePlugin } from "./plugin/compile.plugin";
import { languagesPlugin } from "./plugin/languages.plugin";
import { setPluginHost } from "./plugin/plugin-host";
import { taskQueuePlugin } from "./plugin/taskQueue.plugin";

if (process.getuid() !== 0) {
  winston.error("This program requires root to run");
  process.exit(1);
}

const JUDGE_LANGUAGES_BUNDLE = "@libreoj/judge-languages";
const JUDGE_CHECKERS_BUNDLE = "@libreoj/judge-checkers";
const JUDGE_TASK_QUEUE_BUNDLE = "@libreoj/judge-task-queue";
const JUDGE_COMPILE_BUNDLE = "@libreoj/judge-compile";

// The judge's composition root. It is registered with the module-level accessor before `host.load()`, so the
// `languages` and `checkerRegistry` seams (resolved lazily from `getLanguage` and the checker lookups) read the same
// host. Saving each registry as a plugin keeps the existing startup order: the host is loaded before the RPC
// connection is established.
const host = new PluginHost({
  resolver: new InlineResolver({
    [JUDGE_LANGUAGES_BUNDLE]: languagesPlugin,
    [JUDGE_CHECKERS_BUNDLE]: checkersPlugin,
    [JUDGE_TASK_QUEUE_BUNDLE]: taskQueuePlugin,
    [JUDGE_COMPILE_BUNDLE]: compilePlugin
  }),
  failureMode: "fatal"
});

setPluginHost(host);

host
  .load([{ bundles: [JUDGE_LANGUAGES_BUNDLE, JUDGE_CHECKERS_BUNDLE, JUDGE_TASK_QUEUE_BUNDLE, JUDGE_COMPILE_BUNDLE] }])
  .then(() => {
    rpc.connect().then(() => {
      for (let i = 0; i < config.taskConsumingThreads; i++) rpc.startTaskConsumerThread(i);
    });
  });
