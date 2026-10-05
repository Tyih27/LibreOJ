import "reflect-metadata";
import * as winston from "winston";
import { InlineResolver, PluginHost } from "@libreoj/plugin-core";

import config from "./config";
import rpc from "./rpc";
import { languagesPlugin } from "./plugin/languages.plugin";
import { setPluginHost } from "./plugin/plugin-host";

if (process.getuid() !== 0) {
  winston.error("This program requires root to run");
  process.exit(1);
}

const JUDGE_LANGUAGES_BUNDLE = "@libreoj/judge-languages";

// The judge's composition root. It is registered with the module-level accessor before `host.load()`, so the
// `languages` seam (resolved lazily from `getLanguage`) reads the same host. Saving the language registry as a plugin
// keeps the existing startup order: the host is loaded before the RPC connection is established.
const host = new PluginHost({
  resolver: new InlineResolver({ [JUDGE_LANGUAGES_BUNDLE]: languagesPlugin }),
  failureMode: "fatal"
});

setPluginHost(host);

host.load([{ bundles: [JUDGE_LANGUAGES_BUNDLE] }]).then(() => {
  rpc.connect().then(() => {
    for (let i = 0; i < config.taskConsumingThreads; i++) rpc.startTaskConsumerThread(i);
  });
});
