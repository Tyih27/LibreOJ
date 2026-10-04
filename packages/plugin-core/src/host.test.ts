import { test } from "node:test";
import * as assert from "node:assert/strict";
import { load } from "js-yaml";
import { InlineResolver, PluginHost, type PluginDefinition, type PluginRecord } from "./index";

function stateOf(host: PluginHost, name: string): string | undefined {
  return host.plugins.find(record => record.name === name)?.state;
}

function dumped(host: PluginHost): {
  plugins: { name: string; source: string; disabled: boolean; state: string; config: Record<string, unknown> }[];
  warnings: string[];
} {
  return load(host.dumpConfig()) as never;
}

test("activates a dependent plugin once its provider appears, regardless of mount order", async () => {
  const order: string[] = [];
  const a: PluginDefinition = {
    name: "a",
    provide: ["a"],
    apply(ctx) {
      order.push("a:apply");
      ctx.provide("a", 1);
    }
  };
  const b: PluginDefinition = {
    name: "b",
    inject: { required: ["a"] },
    apply(ctx) {
      order.push("b:apply");
      ctx.provide("b", 2);
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a, b }) });
  // "b" is mounted before its provider "a"; it must wait rather than fail.
  await host.load([{ bundles: ["b", "a"] }]);

  assert.equal(stateOf(host, "a"), "active");
  assert.equal(stateOf(host, "b"), "active");
  assert.deepEqual(order, ["a:apply", "b:apply"]);

  await host.dispose();
});

test("keeps a plugin pending while a required dependency is missing and warns in the dump", async () => {
  let applied = false;
  const b: PluginDefinition = {
    name: "b",
    inject: { required: ["x"] },
    apply() {
      applied = true;
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ b }) });
  await host.load([{ bundles: ["b"] }]);

  assert.equal(stateOf(host, "b"), "pending");
  assert.equal(applied, false);

  const document = dumped(host);
  assert.ok(
    document.warnings.some(warning => warning.includes('"b"') && warning.includes("x")),
    `expected a pending warning for "b" missing "x", got ${JSON.stringify(document.warnings)}`
  );

  await host.dispose();
});

test("deactivates a plugin when a dependency disappears and re-applies it when the dependency returns", async () => {
  let aApplies = 0;
  let bApplies = 0;
  const a: PluginDefinition = {
    name: "a",
    inject: { required: ["gate"] },
    provide: ["x"],
    apply(ctx) {
      aApplies += 1;
      ctx.provide("x", aApplies);
    }
  };
  const b: PluginDefinition = {
    name: "b",
    inject: { required: ["x"] },
    apply() {
      bApplies += 1;
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a, b }) });

  // A plain context stands in for a provider plugin that can later be unloaded.
  const gate = host.root.fork("gate");
  gate.provide("gate", true);

  await host.load([{ bundles: ["a", "b"] }]);
  assert.equal(aApplies, 1);
  assert.equal(bApplies, 1);
  assert.equal(stateOf(host, "a"), "active");
  assert.equal(stateOf(host, "b"), "active");

  // The provider disappears: both the direct and the transitive dependent must deactivate.
  await gate.dispose();
  await host.reconcile();
  assert.equal(stateOf(host, "a"), "pending");
  assert.equal(stateOf(host, "b"), "pending");
  assert.equal(host.plugins.find(record => record.name === "b")?.state, "pending");

  // The provider returns: both must run apply again from a fresh context.
  const gateAgain = host.root.fork("gate-again");
  gateAgain.provide("gate", true);
  await host.reconcile();
  assert.equal(aApplies, 2);
  assert.equal(bApplies, 2);
  assert.equal(stateOf(host, "a"), "active");
  assert.equal(stateOf(host, "b"), "active");

  await host.dispose();
});

test("optional dependencies do not gate activation", async () => {
  let applied = false;
  const b: PluginDefinition = {
    name: "b",
    inject: { optional: ["missing"] },
    apply() {
      applied = true;
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ b }) });
  await host.load([{ bundles: ["b"] }]);

  assert.equal(applied, true);
  assert.equal(stateOf(host, "b"), "active");

  await host.dispose();
});

test("runs start once per active plugin, in load order, after every apply", async () => {
  const events: string[] = [];
  const a: PluginDefinition = {
    name: "a",
    provide: ["a"],
    apply(ctx) {
      events.push("a:apply");
      ctx.provide("a", 1);
    },
    start() {
      events.push("a:start");
    }
  };
  const b: PluginDefinition = {
    name: "b",
    inject: { required: ["a"] },
    apply() {
      events.push("b:apply");
    },
    start() {
      events.push("b:start");
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a, b }) });
  await host.load([{ bundles: ["a", "b"] }]);

  assert.deepEqual(events, ["a:apply", "b:apply", "a:start", "b:start"]);

  // A further reconcile must not re-run start.
  await host.reconcile();
  assert.deepEqual(events, ["a:apply", "b:apply", "a:start", "b:start"]);

  await host.dispose();
});

test("an apply failure rolls back its service in skip mode without affecting other plugins", async () => {
  const errors: { name: string; error: unknown }[] = [];
  const bad: PluginDefinition = {
    name: "bad",
    provide: ["bad"],
    apply(ctx) {
      ctx.provide("bad", 1);
      throw new Error("boom");
    }
  };
  const good: PluginDefinition = {
    name: "good",
    provide: ["good"],
    apply(ctx) {
      ctx.provide("good", 1);
    }
  };

  const host = new PluginHost({
    resolver: new InlineResolver({ bad, good }),
    failureMode: "skip",
    onError: (name, error) => errors.push({ name, error })
  });
  await host.load([{ bundles: ["bad", "good"] }]);

  assert.equal(stateOf(host, "bad"), "error");
  assert.equal(host.root.has("bad"), false);
  assert.equal(stateOf(host, "good"), "active");
  assert.equal(host.root.has("good"), true);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, "bad");

  const document = dumped(host);
  assert.ok(document.warnings.some(warning => warning.includes("bad") && /error/i.test(warning)));

  await host.dispose();
});

test("an apply failure rejects load in fatal mode", async () => {
  const bad: PluginDefinition = {
    name: "bad",
    apply() {
      throw new Error("boom");
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ bad }), failureMode: "fatal" });
  await assert.rejects(host.load([{ bundles: ["bad"] }]), /boom/);

  // The rejected promise is not the only signal: the fatal stays observable after the fact.
  assert.match(String(host.fatalError), /boom/);
  assert.ok(dumped(host).warnings.some(warning => /fatal/i.test(warning)));

  await host.dispose();
});

test("a fatal error from an externally triggered reconcile is recorded and reported, not swallowed", async () => {
  const errors: { name: string; error: unknown }[] = [];
  const a: PluginDefinition = {
    name: "a",
    inject: { required: ["gate"] },
    apply() {
      throw new Error("boom on reactivation");
    }
  };

  const host = new PluginHost({
    resolver: new InlineResolver({ a }),
    failureMode: "fatal",
    onError: (name, error) => errors.push({ name, error })
  });
  await host.load([{ bundles: ["a"] }]);
  assert.equal(stateOf(host, "a"), "pending");
  assert.equal(host.fatalError, null);

  // Providing the missing dependency fires `handleServiceChange`, which reconciles without any caller promise.
  const gate = host.root.fork("gate");
  gate.provide("gate", true);
  await assert.rejects(host.reconcile(), /boom on reactivation/);

  assert.match(String(host.fatalError), /boom on reactivation/);
  assert.ok(
    errors.some(entry => entry.name === "a"),
    `expected onError for "a", got ${JSON.stringify(errors)}`
  );
  assert.equal(stateOf(host, "a"), "error");
  assert.ok(dumped(host).warnings.some(warning => /fatal/i.test(warning)));

  await host.dispose();
});

test("start may provide a service that activates and starts a dependent before load resolves", async () => {
  const events: string[] = [];
  const a: PluginDefinition = {
    name: "a",
    provide: ["base"],
    apply(ctx) {
      ctx.provide("base", 1);
    },
    start(ctx) {
      events.push("a:start");
      // "ready" only exists once "a" has started; "b" must be activated and started before load resolves.
      ctx.provide("ready", true);
    }
  };
  const b: PluginDefinition = {
    name: "b",
    inject: { required: ["ready"] },
    apply() {
      events.push("b:apply");
    },
    start() {
      events.push("b:start");
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a, b }) });
  await host.load([{ bundles: ["a", "b"] }]);

  assert.equal(stateOf(host, "b"), "active");
  assert.deepEqual(events, ["a:start", "b:apply", "b:start"]);

  await host.dispose();
});

test("an externally reactivated plugin is started without an explicit reconcile", async () => {
  let starts = 0;
  let resolveStarted!: () => void;
  const started = new Promise<void>(resolve => {
    resolveStarted = resolve;
  });
  const a: PluginDefinition = {
    name: "a",
    inject: { required: ["gate"] },
    apply() {},
    start() {
      starts += 1;
      resolveStarted();
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a }) });
  await host.load([{ bundles: ["a"] }]);
  assert.equal(stateOf(host, "a"), "pending");
  assert.equal(starts, 0);

  // A runtime service change activates "a" with no caller promise; the host must observe the kernel settle and run
  // its start loop on its own. No manual `host.reconcile()` may be needed to mask the gap.
  const gate = host.root.fork("gate");
  gate.provide("gate", true);
  await started;

  assert.equal(stateOf(host, "a"), "active");
  assert.equal(starts, 1);

  await host.dispose();
});

test("start runs again after a plugin is deactivated and re-activated", async () => {
  const starts: string[] = [];
  const a: PluginDefinition = {
    name: "a",
    inject: { required: ["gate"] },
    apply(ctx) {
      ctx.provide("a", 1);
    },
    start() {
      starts.push("a");
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a }) });
  const gate = host.root.fork("gate");
  gate.provide("gate", true);
  await host.load([{ bundles: ["a"] }]);
  assert.deepEqual(starts, ["a"]);

  await gate.dispose();
  await host.reconcile();
  assert.equal(stateOf(host, "a"), "pending");

  const gateAgain = host.root.fork("gate-again");
  gateAgain.provide("gate", true);
  await host.reconcile();

  // `deactivate` deletes the name from `started`, so re-activation gives the plugin a fresh, unstarted lifecycle and
  // `start` runs again -- this is the documented `started.delete` semantics.
  assert.equal(stateOf(host, "a"), "active");
  assert.deepEqual(starts, ["a", "a"]);

  await host.dispose();
});

test("disabled plugins are neither loaded nor activated and are flagged in the dump", async () => {
  let applied = false;
  const a: PluginDefinition = {
    name: "a",
    apply() {
      applied = true;
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a }) });
  await host.load([{ bundles: ["a"], patch: { a: { disabled: true } } }]);

  assert.equal(applied, false);
  assert.equal(host.plugins.length, 0);

  const document = dumped(host);
  assert.equal(document.plugins.length, 1);
  assert.equal(document.plugins[0].name, "a");
  assert.equal(document.plugins[0].disabled, true);
  // A disabled entry is never mounted, so it reports the dump-only "disabled" label, not a lifecycle state.
  assert.equal(document.plugins[0].state, "disabled");
  assert.ok(document.warnings.some(warning => warning.includes('"a"') && /disabled/i.test(warning)));

  await host.dispose();
});

test("dispose tears down plugins and root, clears services, and makes later calls throw", async () => {
  const a: PluginDefinition = {
    name: "a",
    provide: ["a"],
    apply(ctx) {
      ctx.provide("a", 1);
    }
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a }) });
  await host.load([{ bundles: ["a"] }]);
  assert.equal(host.root.has("a"), true);

  // Observe the tree-wide scope through the controlled API: disposing the plugin context must revoke its service.
  let removals = 0;
  host.root.onServiceChange(() => removals++);
  await host.dispose();

  assert.ok(removals >= 1, `expected the service removal to be notified, got ${removals}`);
  assert.equal(host.root.disposed, true);
  assert.equal(host.plugins[0].state, "disposed");
  assert.equal(host.plugins[0].context.disposed, true);

  await assert.rejects(host.load([{ bundles: ["a"] }]), /disposed/i);
  assert.throws(() => host.dumpConfig(), /disposed/i);
});

test("dumpConfig reports optional dependency availability for a mounted plugin", async () => {
  const b: PluginDefinition = {
    name: "b",
    inject: { optional: ["extra"] },
    apply() {}
  };

  const host = new PluginHost({ resolver: new InlineResolver({ b }) });
  await host.load([{ bundles: ["b"] }]);

  const optionalOf = (): Record<string, boolean> | undefined => {
    const document = load(host.dumpConfig()) as {
      plugins: { name: string; optional?: Record<string, boolean> }[];
    };
    return document.plugins.find(plugin => plugin.name === "b")?.optional;
  };

  assert.deepEqual(optionalOf(), { extra: false });

  // An optional service becoming available is reflected without changing the activation state.
  const gate = host.root.fork("gate");
  gate.provide("extra", 1);
  assert.equal(stateOf(host, "b"), "active");
  assert.deepEqual(optionalOf(), { extra: true });

  await host.dispose();
});

test("dumpConfig is stable, reports state, and sorts config keys", async () => {
  const a: PluginDefinition = {
    name: "a",
    provide: ["a"],
    apply(ctx) {
      ctx.provide("a", 1);
    }
  };
  const b: PluginDefinition = {
    name: "b",
    inject: { required: ["a"] },
    apply() {}
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a, b }) });
  await host.load([{ bundles: ["a", "b"], config: { a: { z: 1, a: 2 } } }]);

  const first = host.dumpConfig();
  assert.equal(first, host.dumpConfig());

  const document = dumped(host);
  assert.ok(document.plugins.every(plugin => typeof plugin.state === "string"));
  const pluginA = document.plugins.find(plugin => plugin.name === "a");
  assert.equal(pluginA?.state, "active");
  assert.deepEqual(Object.keys(pluginA?.config ?? {}), ["a", "z"]);

  await host.dispose();
});

test("a plugin config schema supplies defaults under profile config and validates the result", async () => {
  const parsed: unknown[] = [];
  const a: PluginDefinition<{ port: number; host: string }> = {
    name: "a",
    config: {
      defaults: { port: 3000, host: "localhost" },
      parse(input) {
        parsed.push(input);
        const value = input as { port: unknown; host: unknown };
        if (typeof value.port !== "number") throw new Error("port must be a number");
        return { port: value.port, host: String(value.host) };
      }
    },
    apply() {}
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a }) });
  await host.load([{ bundles: ["a"], config: { a: { port: 8080 } } }]);

  const record = host.plugins[0];
  assert.deepEqual(record.config, { port: 8080, host: "localhost" });
  assert.equal(parsed.length, 1);

  const bad: PluginDefinition = {
    name: "a",
    config: {
      parse() {
        throw new Error("invalid config");
      }
    },
    apply() {}
  };
  const failing = new PluginHost({ resolver: new InlineResolver({ a: bad }) });
  await assert.rejects(failing.load([{ bundles: ["a"] }]), /invalid config/);

  await host.dispose();
  await failing.dispose();
});

test("the plugins accessor returns a defensive copy of the load order", async () => {
  const a: PluginDefinition = {
    name: "a",
    apply() {}
  };

  const host = new PluginHost({ resolver: new InlineResolver({ a }) });
  await host.load([{ bundles: ["a"] }]);

  const snapshot = host.plugins as PluginRecord[];
  assert.notEqual(snapshot, host.plugins);
  snapshot.length = 0;

  // Mutating the returned array must not reach the host's internal records.
  assert.equal(host.plugins.length, 1);
  assert.equal(stateOf(host, "a"), "active");

  await host.dispose();
});
