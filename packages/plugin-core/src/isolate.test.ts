import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Context, ServiceScope, type PluginDefinition } from "./index";

// --- ServiceScope unit level -------------------------------------------------------------------------------------

test("resolveScope stops at the nearest scope that isolates a name and falls through otherwise", () => {
  const root = new ServiceScope();
  const iso = new ServiceScope(root, ["db"]);
  const nested = new ServiceScope(iso, ["cache"]);

  // The root never isolates anything, so it is the fallback for every name.
  assert.equal(root.resolveScope("db"), root);
  assert.equal(root.resolveScope("anything"), root);

  // A scope owns exactly the names it isolates; other names fall through to the root.
  assert.equal(iso.resolveScope("db"), iso);
  assert.equal(iso.resolveScope("http"), root);

  // The nearest isolate wins for its own name, and an outer isolate still catches names it isolates.
  assert.equal(nested.resolveScope("cache"), nested);
  assert.equal(nested.resolveScope("db"), iso);
  assert.equal(nested.resolveScope("http"), root);
});

test("ServiceScope notifications walk up the scope chain, notifying each listener once", () => {
  const root = new ServiceScope();
  const iso = new ServiceScope(root, ["db"]);
  let rootRuns = 0;
  let isoRuns = 0;
  let sharedRuns = 0;
  const shared = (): void => {
    sharedRuns += 1;
  };
  root.onChange(() => rootRuns++);
  iso.onChange(() => isoRuns++);
  // The same listener registered on both scopes must fire once per change, not once per scope.
  iso.onChange(shared);
  root.onChange(shared);

  // A change in the isolate reaches its own listeners and the root's.
  iso.provide("db", 1);
  assert.equal(isoRuns, 1);
  assert.equal(rootRuns, 1);
  assert.equal(sharedRuns, 1);

  // A change in the root does not reach an isolate-local listener that is not registered there.
  root.provide("http", 1);
  assert.equal(isoRuns, 1);
  assert.equal(rootRuns, 2);
  assert.equal(sharedRuns, 2);
});

// --- Context.isolate ---------------------------------------------------------------------------------------------

test("an isolated name is invisible in both directions", () => {
  const root = new Context();
  root.set("db", "outer");
  const iso = root.isolate("db");

  // The isolate cannot see the outer registration...
  assert.equal(iso.has("db"), false);
  assert.equal(iso.tryGet("db"), undefined);
  assert.throws(() => iso.get("db"), /not available/);

  // ...and its own registration is local, without colliding with the outer one.
  iso.set("db", "inner");
  assert.equal(iso.get("db"), "inner");
  assert.equal(root.get("db"), "outer");
});

test("names outside the isolate set keep tree-global visibility", () => {
  const root = new Context();
  root.set("shared", 1);
  const iso = root.isolate("db");

  // An isolate sees an outer non-isolated service...
  assert.equal(iso.get("shared"), 1);

  // ...and a non-isolated registration from inside the isolate lands in the shared scope.
  iso.set("fromIso", 2);
  assert.equal(root.get("fromIso"), 2);
  assert.throws(() => root.set("fromIso", 3), /already provided/);
});

test("two sibling isolates never share storage, even for the same names", () => {
  const root = new Context();
  const a = root.isolate("db");
  const b = root.isolate("db");

  a.set("db", "A");
  b.set("db", "B");

  assert.equal(a.get("db"), "A");
  assert.equal(b.get("db"), "B");
  assert.equal(root.has("db"), false);
});

test("a single isolate accepts one name as a string or many as an array", () => {
  const root = new Context();
  const one = root.isolate("db");
  const many = root.isolate(["db", "cache"]);

  one.set("db", 1);
  many.set("db", 2);
  many.set("cache", 3);

  assert.equal(one.get("db"), 1);
  assert.equal(many.get("db"), 2);
  assert.equal(many.get("cache"), 3);
  assert.equal(root.has("db"), false);
  assert.equal(root.has("cache"), false);
});

test("fork, and plugin contexts inherit their isolate's scope", async () => {
  const root = new Context();
  const iso = root.isolate("db");
  const child = iso.fork("child");
  const grandchild = child.fork("grandchild");

  root.set("db", "outer");
  iso.set("db", "isolated");

  assert.equal(child.get("db"), "isolated");
  assert.equal(grandchild.get("db"), "isolated");
  assert.equal(root.get("db"), "outer");

  await root.dispose();

  // A plugin context forked from an isolate resolves the isolated service, never an outer one of the same name.
  let applied = 0;
  let seen: unknown;
  const reader: PluginDefinition = {
    name: "reader",
    inject: { required: ["db"] },
    apply(ctx) {
      applied += 1;
      seen = ctx.get("db");
    }
  };

  const pluginRoot = new Context();
  const pluginIso = pluginRoot.isolate("db");
  pluginRoot.set("db", "OUTER");
  const fiber = pluginIso.plugin(reader);
  await pluginRoot.fibers.settle();
  assert.equal(fiber.state, "pending");
  assert.equal(applied, 0);

  pluginIso.set("db", "INNER");
  await pluginRoot.fibers.settle();
  assert.equal(fiber.state, "active");
  assert.equal(applied, 1);
  assert.equal(seen, "INNER");

  await pluginRoot.dispose();
});

test("disposing an isolate removes its isolated services and its whole subtree", async () => {
  const root = new Context();
  const iso = root.isolate("db");
  const child = iso.fork("child");
  let childTornDown = false;
  child.effect(() => () => {
    childTornDown = true;
  });

  let rootChanges = 0;
  root.onServiceChange(() => rootChanges++);

  iso.set("db", 1);
  assert.equal(rootChanges, 1);

  await iso.dispose();

  // The removal is observable at the root and the subtree is gone.
  assert.equal(rootChanges, 2);
  assert.equal(child.disposed, true);
  assert.equal(childTornDown, true);

  // The boundary is gone, so a fresh isolate starts from a clean slate.
  const again = root.isolate("db");
  again.set("db", 2);
  assert.equal(again.get("db"), 2);

  await root.dispose();
});

test("a change inside an isolate notifies ancestor scope subscribers", () => {
  const root = new Context();
  const iso = root.isolate("db");
  const child = iso.fork("child");
  let rootChanges = 0;
  let childChanges = 0;
  root.onServiceChange(() => rootChanges++);
  child.onServiceChange(() => childChanges++);

  child.set("db", 1);
  // The root subscriber sees a change made deep inside the isolate, and the child's own subscriber fires exactly once.
  assert.equal(rootChanges, 1);
  assert.equal(childChanges, 1);
});

test("ctx.inject inside an isolate only accepts isolated registrations of that name", () => {
  const root = new Context();
  const iso = root.isolate("db");
  let runs = 0;
  iso.inject(["db"], () => {
    runs += 1;
    return () => {
      runs -= 1;
    };
  });

  // An outer provider of the isolated name does not satisfy the inject.
  root.set("db", "outer");
  assert.equal(runs, 0);

  iso.set("db", "inner");
  assert.equal(runs, 1);
});

test("a fiber mounted inside an isolate is gated on the isolated scope only", async () => {
  const root = new Context();
  const iso = root.isolate("greeting");
  let applies = 0;
  const consumer: PluginDefinition = {
    name: "consumer",
    inject: { required: ["greeting"] },
    apply() {
      applies += 1;
    }
  };

  const fiber = iso.plugin(consumer);
  await root.fibers.settle();
  assert.equal(fiber.state, "pending");

  // An outer provider of the isolated name must not satisfy the fiber.
  root.set("greeting", "outer");
  await root.fibers.settle();
  assert.equal(fiber.state, "pending");
  assert.equal(applies, 0);

  // A provider inside the isolate does.
  const provider = iso.fork("provider");
  provider.set("greeting", "inner");
  await root.fibers.settle();
  assert.equal(fiber.state, "active");
  assert.equal(applies, 1);

  // Removing the isolated provider deactivates the fiber again.
  await provider.dispose();
  await root.fibers.settle();
  assert.equal(fiber.state, "pending");

  await root.dispose();
});
