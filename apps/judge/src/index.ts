import "./logging";
import "reflect-metadata";

import * as path from "node:path";

import * as winston from "winston";
import { InlineResolver, PluginHost, composeLayers } from "@libreoj/plugin-core";

import { checkersPlugin } from "./plugin/checkers.plugin";
import { compilePlugin } from "./plugin/compile.plugin";
import { configPlugin } from "./plugin/config.plugin";
import { consumerPlugin } from "./plugin/consumer.plugin";
import { filePlugin } from "./plugin/file.plugin";
import { languagesPlugin } from "./plugin/languages.plugin";
import { setPluginHost } from "./plugin/plugin-host";
import { rpcPlugin } from "./plugin/rpc.plugin";
import { sandboxPlugin } from "./plugin/sandbox.plugin";
import { taskQueuePlugin } from "./plugin/taskQueue.plugin";

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
const JUDGE_CONSUMER_BUNDLE = "@libreoj/judge-consumer";

// The judge's composition root. The nine runtime bundles are mapped here; the profile only names them, and
// `composeLayers` turns the profile (plus the optional site/home patch) into the layers `host.load` consumes. The host
// is registered with the module-level accessor before `host.load()`, so the `languages` and `checkerRegistry` seams
// (resolved lazily from `getLanguage` and the checker lookups) read the same host.
//
// Load order comes from the profile: `judge-config` is first, so every other bundle's `inject.required` is satisfied
// once it applies. During `load` the RPC plugin's `start` awaits the connection (`rpc.connect`), and only afterwards
// does the consumer plugin's `start` fire the task consumer threads. Both are plugin responsibilities now; this entry
// point no longer connects the RPC client or spawns the threads itself.
const host = new PluginHost({
  resolver: new InlineResolver({
    [JUDGE_CONFIG_BUNDLE]: configPlugin,
    [JUDGE_LANGUAGES_BUNDLE]: languagesPlugin,
    [JUDGE_CHECKERS_BUNDLE]: checkersPlugin,
    [JUDGE_TASK_QUEUE_BUNDLE]: taskQueuePlugin,
    [JUDGE_RPC_BUNDLE]: rpcPlugin,
    [JUDGE_SANDBOX_BUNDLE]: sandboxPlugin,
    [JUDGE_FILE_BUNDLE]: filePlugin,
    [JUDGE_COMPILE_BUNDLE]: compilePlugin,
    [JUDGE_CONSUMER_BUNDLE]: consumerPlugin
  }),
  failureMode: "fatal"
});

setPluginHost(host);

// The profile path can be overridden for site installations; otherwise it is the one shipped at the repository root,
// resolved relative to this file so it works regardless of the current working directory.
const profile = process.env.LIBREOJ_JUDGE_PROFILE ?? path.resolve(__dirname, "../../../profiles/judge.yaml");

host.load(composeLayers({ profile, homePatchFile: process.env.LIBREOJ_PATCH_FILE })).catch(err => {
  winston.error(err);
  process.exit(1);
});
