"use strict";

// A minimal CommonJS plugin package: the host also accepts `module.exports.default`.
module.exports.default = {
  name: "@fixture/consumes",
  inject: { required: ["greeting"] },
  apply(ctx) {
    const greeting = ctx.get("greeting");
    // Register a dispose hook so teardown is exercised end to end.
    ctx.effect(() => () => {});
    ctx.provide("consumes.greeting", greeting);
  }
};
