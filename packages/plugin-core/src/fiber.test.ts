import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Context, type PluginDefinition, type PluginFunction } from "./index";

test("ctx.plugin keeps a dependent pending until its provider is mounted, then activates it", async () => {
  let applies = 0;
  const consumer: PluginDefinition = {
    name: "consumer",
    inject: { required: ["greeting"] },
    apply() {
      applies += 1;
    }
  };
  const provider: PluginDefinition = {
    name: "provider",
    provide: ["greeting"],
    apply(ctx) {
      ctx.provide("greeting", "hello");
    }
  };

  const root = new Context();
  const consumerFiber = root.plugin(consumer);

  // The fiber is mounted but gated: mounted-before-provider must wait rather than fail.
  await root.fibers.settle();
  assert.equal(consumerFiber.state, "pending");
  assert.equal(consumerFiber.context.parent, root);
  assert.equal(applies, 0);

  const providerFiber = root.plugin(provider);
  await root.fibers.settle();

  assert.equal(providerFiber.state, "active");
  assert.equal(consumerFiber.state, "active");
  assert.equal(applies, 1);

  await root.dispose();
});

test("disposing a provider deactivates its dependents and remounting it re-applies them", async () => {
  let applies = 0;
  const consumer: PluginDefinition = {
    name: "consumer",
    inject: { required: ["greeting"] },
    apply() {
      applies += 1;
    }
  };
  const provider: PluginDefinition = {
    name: "provider",
    provide: ["greeting"],
    apply(ctx) {
      ctx.provide("greeting", "hello");
    }
  };

  const root = new Context();
  const consumerFiber = root.plugin(consumer);
  const providerFiber = root.plugin(provider);
  await root.fibers.settle();
  assert.equal(applies, 1);
  assert.equal(consumerFiber.state, "active");

  // Runtime unload of the provider: the dependent must fall back to pending from a fresh context.
  const previousContext = consumerFiber.context;
  await providerFiber.dispose();
  await root.fibers.settle();

  assert.equal(providerFiber.state, "disposed");
  assert.equal(consumerFiber.state, "pending");
  assert.notEqual(consumerFiber.context, previousContext);
  assert.equal(previousContext.disposed, true);

  // Remount: the dependent re-activates and applies again.
  root.plugin(provider);
  await root.fibers.settle();

  assert.equal(consumerFiber.state, "active");
  assert.equal(applies, 2);

  await root.dispose();
});

test("disposing a dependent removes it from the kernel without touching its provider", async () => {
  const consumer: PluginDefinition = {
    name: "consumer",
    inject: { required: ["greeting"] },
    apply() {}
  };
  const provider: PluginDefinition = {
    name: "provider",
    provide: ["greeting"],
    apply(ctx) {
      ctx.provide("greeting", "hello");
    }
  };

  const root = new Context();
  const consumerFiber = root.plugin(consumer);
  const providerFiber = root.plugin(provider);
  await root.fibers.settle();

  await consumerFiber.dispose();
  await root.fibers.settle();

  assert.equal(consumerFiber.state, "disposed");
  assert.equal(providerFiber.state, "active");
  assert.equal(root.fibers.list.includes(consumerFiber), false);

  await root.dispose();
});

test("ctx.inject runs, revokes, and reruns its callback as dependencies come and go", async () => {
  const root = new Context();
  const gate = root.fork("gate");
  let runs = 0;
  let undos = 0;

  root.inject(["svc"], () => {
    runs += 1;
    return () => {
      undos += 1;
    };
  });

  assert.equal(runs, 0);

  gate.provide("svc", 1);
  assert.equal(runs, 1);

  await gate.dispose();
  assert.equal(runs, 1);
  assert.equal(undos, 1);

  const gateAgain = root.fork("gate-again");
  gateAgain.provide("svc", 2);
  assert.equal(runs, 2);

  // Disposal of the owning context revokes the callback's current registration.
  await root.dispose();
  assert.equal(undos, 2);
});

test("ctx.inject revokes the registration when its owning context is disposed, and its disposer is idempotent", async () => {
  const root = new Context();
  const gate = root.fork("gate");
  let runs = 0;
  let undos = 0;
  const off = root.inject(["svc"], () => {
    runs += 1;
    return () => {
      undos += 1;
    };
  });

  gate.provide("svc", 1);
  assert.equal(runs, 1);

  off();
  off();
  assert.equal(undos, 1);
  assert.equal(root.has("svc"), true);

  await root.dispose();
  assert.equal(undos, 1);
});

test("a failing apply rolls back its services, records error, and dispose is idempotent", async () => {
  const errors: { name: string; error: unknown }[] = [];
  const bad: PluginDefinition = {
    name: "bad",
    provide: ["bad"],
    apply(ctx) {
      ctx.provide("bad", 1);
      throw new Error("boom");
    }
  };

  const root = new Context();
  root.fibers.configure({ onError: (name, error) => errors.push({ name, error }) });
  const fiber = root.plugin(bad);
  await root.fibers.settle();

  assert.equal(fiber.state, "error");
  assert.match(String(fiber.error), /boom/);
  assert.equal(root.has("bad"), false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, "bad");

  await fiber.dispose();
  await fiber.dispose();
  assert.equal(fiber.state, "disposed");

  await root.dispose();
});

test("fatal mode rejects settle and exposes the fatal error", async () => {
  const bad: PluginDefinition = {
    name: "bad",
    apply() {
      throw new Error("boom");
    }
  };

  const root = new Context();
  root.fibers.configure({ failureMode: "fatal" });
  root.plugin(bad);

  await assert.rejects(root.fibers.settle(), /boom/);
  assert.match(String(root.fibers.fatalError), /boom/);

  await root.dispose();
});

test("a function plugin carrying metadata can be mounted directly with ctx.plugin", async () => {
  let applied = 0;
  function greeting(ctx: Context): void {
    ctx.provide("greeting", "hello");
  }
  Object.assign(greeting, { provide: ["greeting"] });

  const consumer: PluginFunction = Object.assign(
    function consumer(ctx: Context): void {
      applied += 1;
      ctx.get("greeting");
    },
    { inject: { required: ["greeting"] } }
  );

  const root = new Context();
  root.plugin(consumer);
  // Function plugins must be named to normalize; `consumer` carries its declaration name.
  assert.equal(root.fibers.list.length, 1);

  root.plugin(greeting);
  await root.fibers.settle();

  assert.equal(applied, 1);
  assert.equal(root.fibers.list.length, 2);

  await root.dispose();
});

test("a throwing ctx.inject callback is reported and leaves no placeholder that blocks a retry", async () => {
  const errors: { name: string; error: unknown }[] = [];
  const root = new Context();
  root.fibers.configure({ onError: (name, error) => errors.push({ name, error }) });
  let runs = 0;

  root.inject(["svc"], () => {
    runs += 1;
    throw new Error("inject boom");
  });

  const gate = root.fork("gate");
  gate.provide("svc", 1);
  assert.equal(runs, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, "root");
  assert.match(String(errors[0].error), /inject boom/);

  // The failed callback left no placeholder: the dependency going away and returning reruns it.
  await gate.dispose();
  const gateAgain = root.fork("gate-again");
  gateAgain.provide("svc", 2);
  assert.equal(runs, 2);
  assert.equal(errors.length, 2);

  await root.dispose();
});

test("a fiber emits ready on its context after a successful apply, bubbling to ancestors", async () => {
  const order: string[] = [];
  const record = (label: string): void => {
    order.push(label);
  };
  const plugin: PluginDefinition = {
    name: "greeter",
    apply(ctx) {
      record("apply");
      ctx.on("ready", () => record("own-ready"));
    }
  };

  const root = new Context();
  root.on("ready", () => record("root-ready"));
  const fiber = root.plugin(plugin);
  await root.fibers.settle();

  assert.equal(fiber.state, "active");
  // The plugin's own listener is on the emitting context, so it runs before the ancestor's.
  assert.deepEqual(order, ["apply", "own-ready", "root-ready"]);

  await root.dispose();
});

test("a fiber emits dispose before its context is actually disposed, bubbling to ancestors", async () => {
  const observed: boolean[] = [];
  let pluginContext: Context | undefined;
  const plugin: PluginDefinition = {
    name: "resource",
    apply(ctx) {
      pluginContext = ctx;
      ctx.on("dispose", () => {
        observed.push(ctx.disposed);
      });
    }
  };

  const root = new Context();
  root.on("dispose", () => {
    observed.push(pluginContext?.disposed ?? true);
  });
  const fiber = root.plugin(plugin);
  await root.fibers.settle();

  await fiber.dispose();

  // Both the plugin's own listener and the ancestor's saw the context still alive when dispose fired.
  assert.deepEqual(observed, [false, false]);
  assert.equal(pluginContext?.disposed, true);
  assert.equal(fiber.state, "disposed");

  await root.dispose();
});

test("optional dependencies never gate activation and their availability is observable", async () => {
  const root = new Context();
  const provider = root.fork("provider");
  let applies = 0;
  const plugin: PluginDefinition = {
    name: "optional-consumer",
    inject: { optional: ["extra"], required: [] },
    apply() {
      applies += 1;
    }
  };

  const fiber = root.plugin(plugin);
  await root.fibers.settle();

  // A missing optional service still activates the plugin.
  assert.equal(fiber.state, "active");
  assert.equal(applies, 1);
  assert.deepEqual(fiber.optionalAvailable, { extra: false });
  assert.deepEqual(fiber.missingOptional(), ["extra"]);

  // Its appearance and disappearance are observable without touching the activation state.
  provider.set("extra", 1);
  assert.deepEqual(fiber.optionalAvailable, { extra: true });
  assert.deepEqual(fiber.missingOptional(), []);
  assert.equal(fiber.state, "active");

  await provider.dispose();
  assert.deepEqual(fiber.optionalAvailable, { extra: false });
  assert.equal(fiber.state, "active");

  await root.dispose();
});

test("ctx.inject inside a plugin reruns as an optional-only service comes and goes", async () => {
  const root = new Context();
  const provider = root.fork("provider");
  const runs: boolean[] = [];
  const plugin: PluginDefinition = {
    name: "optional-watcher",
    // The plugin's own activation is not gated; the optional service is observed through ctx.inject instead.
    inject: { optional: ["extra"] },
    apply(ctx) {
      ctx.inject(["extra"], () => {
        runs.push(true);
        return () => runs.push(false);
      });
    }
  };

  root.plugin(plugin);
  await root.fibers.settle();
  assert.deepEqual(runs, []);

  provider.set("extra", 1);
  assert.deepEqual(runs, [true]);

  await provider.dispose();
  assert.deepEqual(runs, [true, false]);

  await root.dispose();
});

test("a dependency-driven deactivation emits dispose and a later reactivation emits ready again", async () => {
  const events: string[] = [];
  const consumer: PluginDefinition = {
    name: "consumer",
    inject: { required: ["greeting"] },
    apply(ctx) {
      ctx.on("ready", () => {
        events.push("ready");
      });
      ctx.on("dispose", () => {
        events.push("dispose");
      });
    }
  };
  const provider: PluginDefinition = {
    name: "provider",
    provide: ["greeting"],
    apply(ctx) {
      ctx.provide("greeting", "hello");
    }
  };

  const root = new Context();
  const consumerFiber = root.plugin(consumer);
  const providerFiber = root.plugin(provider);
  await root.fibers.settle();
  assert.deepEqual(events, ["ready"]);

  // Unloading the provider tears the dependent's context down, then a remount rebuilds and re-applies it.
  await providerFiber.dispose();
  await root.fibers.settle();
  assert.equal(consumerFiber.state, "pending");
  assert.deepEqual(events, ["ready", "dispose"]);

  root.plugin(provider);
  await root.fibers.settle();
  assert.equal(consumerFiber.state, "active");
  assert.deepEqual(events, ["ready", "dispose", "ready"]);

  await root.dispose();
});
