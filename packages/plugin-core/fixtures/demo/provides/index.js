"use strict";

// A minimal CommonJS plugin package: the host loads `module.exports.plugin`.
module.exports.plugin = {
  name: "@fixture/provides",
  inject: { required: [] },
  provide: ["greeting"],
  config: { defaults: { greeting: "hello" } },
  apply(ctx) {
    ctx.provide("greeting", "hello");
  }
};
