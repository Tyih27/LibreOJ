// A minimal ESM plugin package: the host loads the `plugin` named export through a dynamic `import()`.
export const plugin = {
  name: "@fixture/esm-provides",
  inject: { required: [] },
  provide: ["esm.greeting"],
  apply(ctx) {
    ctx.provide("esm.greeting", "hello from esm");
  }
};
