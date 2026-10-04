import { test } from "node:test";
import * as assert from "node:assert/strict";
import { load } from "js-yaml";
import { InlineResolver, PluginHost, type ModuleResolver, type PluginDefinition, type ResolveOptions } from "./index";

function stateOf(host: PluginHost, name: string): string | undefined {
  return host.plugins.find(record => record.name === name)?.state;
}

function dumped(host: PluginHost): {
  plugins: { name: string; source: string; disabled: boolean; state: string; config: Record<string, unknown> }[];
  warnings: string[];
} {
  return load(host.dumpConfig()) as never;
}

test("install mounts a plugin at runtime, activates and starts it, and reflects it in the dump", async () => {
  const events: string[] = [];
  const base: PluginDefinition = {
    name: "base",
    apply() {
      events.push("base:apply");
    }
  };
  const extra: PluginDefinition = {
    name: "extra",
    provide: ["extra"],
    apply(ctx) {
      events.push("extra:apply");
      ctx.provide("extra", 42);
    },
    start() {
      events.push("extra:start");
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ base, extra }) });
  await host.load([{ bundles: ["base"] }]);
  assert.equal(stateOf(host, "extra"), undefined);

  const fiber = await host.install("extra", { flag: true });
  assert.equal(fiber.name, "extra");
  assert.equal(fiber.state, "active");
  assert.equal(host.root.get("extra"), 42);
  assert.deepEqual(events, ["base:apply", "extra:apply", "extra:start"]);

  const entry = dumped(host).plugins.find(plugin => plugin.name === "extra");
  assert.equal(entry?.state, "active");
  assert.equal(entry?.source, "runtime");
  assert.equal(entry?.config.flag, true);

  await host.dispose();
});

test("install activates a plugin whose required service is already provided", async () => {
  const provider: PluginDefinition = {
    name: "provider",
    provide: ["greeting"],
    apply(ctx) {
      ctx.provide("greeting", "hi");
    }
  };
  const consumer: PluginDefinition = {
    name: "consumer",
    inject: { required: ["greeting"] },
    apply(ctx) {
      ctx.get("greeting");
      ctx.provide("consumer.ready", true);
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ provider, consumer }) });
  await host.load([{ bundles: ["provider"] }]);

  const fiber = await host.install("consumer");
  assert.equal(fiber.state, "active");
  assert.equal(host.root.has("consumer.ready"), true);

  await host.dispose();
});

test("uninstall removes the plugin, revokes its service, and deactivates dependents", async () => {
  const provider: PluginDefinition = {
    name: "provider",
    provide: ["greeting"],
    apply(ctx) {
      ctx.provide("greeting", "hi");
    }
  };
  const consumer: PluginDefinition = {
    name: "consumer",
    inject: { required: ["greeting"] },
    apply() {}
  };

  const host = new PluginHost({ resolver: new InlineResolver({ provider, consumer }) });
  await host.load([{ bundles: ["provider", "consumer"] }]);
  assert.equal(stateOf(host, "consumer"), "active");
  assert.equal(host.root.has("greeting"), true);

  await host.uninstall("provider");

  assert.equal(host.root.has("greeting"), false);
  assert.equal(stateOf(host, "provider"), undefined);
  assert.equal(stateOf(host, "consumer"), "pending");
  assert.equal(
    host.plugins.some(record => record.name === "provider"),
    false
  );
  assert.equal(
    dumped(host).plugins.some(plugin => plugin.name === "provider"),
    false
  );

  await host.dispose();
});

test("reload re-resolves with fresh and applies the new definition", async () => {
  let version = 1;
  const freshFlags: boolean[] = [];
  const resolver: ModuleResolver = {
    resolve(name: string, options?: ResolveOptions): PluginDefinition {
      freshFlags.push(options?.fresh ?? false);
      const captured = version;
      return {
        name,
        provide: ["value"],
        apply(ctx) {
          ctx.provide("value", captured);
        }
      };
    }
  };

  const host = new PluginHost({ resolver });
  await host.load([{ bundles: ["switcher"] }]);
  assert.equal(host.root.get("value"), 1);

  version = 2;
  const fiber = await host.reload("switcher");

  assert.equal(fiber.state, "active");
  assert.equal(host.root.get("value"), 2);
  // `load` resolves without `fresh`; `reload` asks the resolver for a fresh module.
  assert.deepEqual(freshFlags, [false, true]);
  assert.equal(dumped(host).plugins.find(plugin => plugin.name === "switcher")?.state, "active");

  await host.dispose();
});

test("install, uninstall and reload require load() to have been called", async () => {
  const a: PluginDefinition = { name: "a", apply() {} };
  const host = new PluginHost({ resolver: new InlineResolver({ a }) });

  await assert.rejects(host.install("a"), /requires load\(\)/);
  await assert.rejects(host.uninstall("a"), /requires load\(\)/);
  await assert.rejects(host.reload("a"), /requires load\(\)/);

  await host.dispose();
});

test("install after dispose fails clearly", async () => {
  const a: PluginDefinition = { name: "a", apply() {} };
  const host = new PluginHost({ resolver: new InlineResolver({ a }) });
  await host.load([{ bundles: ["a"] }]);
  await host.dispose();

  await assert.rejects(host.install("b"), /disposed/i);
  await assert.rejects(host.uninstall("a"), /disposed/i);
  await assert.rejects(host.reload("a"), /disposed/i);
});

test("installing a name that is already installed fails clearly", async () => {
  const a: PluginDefinition = { name: "a", apply() {} };
  const host = new PluginHost({ resolver: new InlineResolver({ a }) });
  await host.load([{ bundles: ["a"] }]);

  await assert.rejects(host.install("a"), /already installed/);

  await host.dispose();
});

test("uninstalling an unknown plugin fails clearly", async () => {
  const a: PluginDefinition = { name: "a", apply() {} };
  const host = new PluginHost({ resolver: new InlineResolver({ a }) });
  await host.load([{ bundles: ["a"] }]);

  await assert.rejects(host.uninstall("ghost"), /not installed/);

  await host.dispose();
});

test("install records a failing apply in skip mode without rejecting", async () => {
  const errors: { name: string; error: unknown }[] = [];
  const bad: PluginDefinition = {
    name: "bad",
    apply() {
      throw new Error("boom");
    }
  };

  const host = new PluginHost({
    resolver: new InlineResolver({ bad }),
    failureMode: "skip",
    onError: (name, error) => errors.push({ name, error })
  });
  await host.load([]);

  const fiber = await host.install("bad");
  assert.equal(fiber.state, "error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, "bad");
  assert.ok(dumped(host).warnings.some(warning => /error/i.test(warning)));

  await host.dispose();
});

test("install rejects in fatal mode like load", async () => {
  const bad: PluginDefinition = {
    name: "bad",
    apply() {
      throw new Error("boom");
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ bad }), failureMode: "fatal" });
  await host.load([]);

  await assert.rejects(host.install("bad"), /boom/);
  assert.match(String(host.fatalError), /boom/);

  await host.dispose();
});

test("concurrent installs of different plugins serialize and each registers once", async () => {
  const a: PluginDefinition = { name: "a", apply() {} };
  const b: PluginDefinition = { name: "b", apply() {} };
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const resolver: ModuleResolver = {
    async resolve(name: string): Promise<PluginDefinition> {
      if (name === "a") {
        await gate;
        order.push("a");
        return a;
      }
      order.push("b");
      return b;
    }
  };

  const host = new PluginHost({ resolver });
  await host.load([]);

  const installA = host.install("a");
  const installB = host.install("b");
  release();

  const [fiberA, fiberB] = await Promise.all([installA, installB]);
  assert.equal(fiberA.state, "active");
  assert.equal(fiberB.state, "active");
  // "b" could only resolve after "a"'s whole mutation finished, proving serialization.
  assert.deepEqual(order, ["a", "b"]);
  assert.deepEqual(
    host.plugins.map(record => record.name),
    ["a", "b"]
  );
  assert.deepEqual(
    dumped(host).plugins.map(plugin => plugin.name),
    ["a", "b"]
  );

  await host.dispose();
});

test("concurrent installs of the same plugin register it exactly once", async () => {
  const a: PluginDefinition = { name: "a", apply() {} };
  let resolveCount = 0;
  const resolver: ModuleResolver = {
    resolve(): PluginDefinition {
      resolveCount += 1;
      return a;
    }
  };

  const host = new PluginHost({ resolver });
  await host.load([]);

  const results = await Promise.allSettled([host.install("a"), host.install("a")]);
  const fulfilled = results.filter(result => result.status === "fulfilled");
  const rejected = results.filter(result => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(String((rejected[0] as PromiseRejectedResult).reason), /already installed/);
  // The losing call failed its duplicate check before ever resolving a definition.
  assert.equal(resolveCount, 1);
  assert.equal(host.plugins.filter(record => record.name === "a").length, 1);
  assert.equal(dumped(host).plugins.filter(plugin => plugin.name === "a").length, 1);

  await host.dispose();
});

test("install reusing a disabled entry keeps its profile config when no config is given", async () => {
  const a: PluginDefinition = {
    name: "a",
    apply() {}
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a }) });
  await host.load([{ bundles: ["a"], config: { a: { flag: "kept" } }, patch: { a: { disabled: true } } }]);

  // Disabled until installed; it is not loaded yet.
  assert.equal(stateOf(host, "a"), undefined);
  assert.deepEqual(dumped(host).plugins.find(plugin => plugin.name === "a")?.config, { flag: "kept" });

  await host.install("a");

  const entry = dumped(host).plugins.find(plugin => plugin.name === "a");
  assert.equal(entry?.disabled, false);
  assert.equal(entry?.state, "active");
  // The reused entry's profile config must survive the install that supplied no config.
  assert.deepEqual(entry?.config, { flag: "kept" });

  await host.dispose();
});

test("a failed fresh apply during reload is rolled back so the original plugin is restored", async () => {
  const original: PluginDefinition = {
    name: "switcher",
    provide: ["value"],
    apply(ctx) {
      ctx.provide("value", 1);
    }
  };
  const freshFlags: boolean[] = [];
  const resolver: ModuleResolver = {
    resolve(name: string, options?: ResolveOptions): PluginDefinition {
      freshFlags.push(options?.fresh ?? false);
      if (options?.fresh) {
        return {
          name,
          provide: ["value"],
          apply() {
            throw new Error("fresh apply boom");
          }
        };
      }
      return original;
    }
  };

  const host = new PluginHost({ resolver, failureMode: "fatal" });
  await host.load([{ bundles: ["switcher"] }]);
  const before = dumped(host).plugins;
  assert.equal(host.root.get("value"), 1);

  await assert.rejects(host.reload("switcher"), /fresh apply boom/);

  // The failed fresh mount was rolled back transactionally, so reload's restore remounted the original definition
  // instead of colliding with a leftover record. The fatal stays observable, but the plugin tree is unchanged.
  assert.equal(stateOf(host, "switcher"), "active");
  assert.equal(host.root.get("value"), 1);
  assert.equal(host.plugins.filter(record => record.name === "switcher").length, 1);
  assert.deepEqual(dumped(host).plugins, before);
  assert.match(String(host.fatalError), /fresh apply boom/);
  assert.deepEqual(freshFlags, [false, true, false]);

  await host.dispose();
});

test("a failed reload rolls back to the original plugin and stays usable", async () => {
  const original: PluginDefinition = {
    name: "switcher",
    provide: ["value"],
    apply(ctx) {
      ctx.provide("value", 1);
    }
  };
  let failFresh = false;
  const freshFlags: boolean[] = [];
  const resolver: ModuleResolver = {
    resolve(name: string, options?: ResolveOptions): PluginDefinition {
      freshFlags.push(options?.fresh ?? false);
      if (options?.fresh && failFresh) throw new Error("fresh resolve boom");
      return original;
    }
  };

  const host = new PluginHost({ resolver });
  await host.load([{ bundles: ["switcher"] }]);
  const before = host.dumpConfig();
  assert.equal(host.root.get("value"), 1);

  failFresh = true;
  await assert.rejects(host.reload("switcher"), /fresh resolve boom/);

  // Rolled back to the original definition: still installed, active, serving its service, and dump-identical.
  assert.equal(stateOf(host, "switcher"), "active");
  assert.equal(host.root.get("value"), 1);
  assert.equal(host.plugins.filter(record => record.name === "switcher").length, 1);
  assert.equal(host.dumpConfig(), before);
  assert.deepEqual(freshFlags, [false, true, false]);

  await host.dispose();
});
