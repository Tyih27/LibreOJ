import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Context, DisposableStack, ReversibleRegistry } from "./index";
import { RegistryCell } from "./registry";

function scopedRegistry(): { stack: DisposableStack; registry: ReversibleRegistry<number> } {
  const stack = new DisposableStack();
  const registry = new ReversibleRegistry<number>(disposer => {
    stack.add(disposer);
  });
  return { stack, registry };
}

test("set/get/has/keys/entries/size reflect the current entries", () => {
  const { registry } = scopedRegistry();

  registry.set("a", 1);
  registry.set("b", 2);

  assert.equal(registry.get("a"), 1);
  assert.equal(registry.get("missing"), undefined);
  assert.equal(registry.has("b"), true);
  assert.equal(registry.size, 2);
  assert.deepEqual(registry.keys(), ["a", "b"]);
  assert.deepEqual(registry.entries(), [
    ["a", 1],
    ["b", 2]
  ]);
});

test("delete removes an entry and reports whether it existed", () => {
  const { registry } = scopedRegistry();
  registry.set("a", 1);

  assert.equal(registry.delete("a"), true);
  assert.equal(registry.delete("a"), false);
  assert.equal(registry.has("a"), false);
  assert.equal(registry.size, 0);
});

test("keys() and entries() return copies that cannot mutate the registry", () => {
  const { registry } = scopedRegistry();
  registry.set("a", 1);

  registry.keys().push("bogus");
  registry.entries().pop();

  assert.deepEqual(registry.keys(), ["a"]);
  assert.deepEqual(registry.entries(), [["a", 1]]);
});

test("onChange fires on set and delete and its disposer stops notifications", () => {
  const { registry } = scopedRegistry();
  const sizes: number[] = [];
  const off = registry.onChange(() => sizes.push(registry.size));

  registry.set("a", 1);
  registry.delete("a");
  off();
  registry.set("b", 2);

  assert.deepEqual(sizes, [1, 0]);
});

test("the onChange disposer is idempotent and detaches the listener for good", () => {
  const { registry } = scopedRegistry();
  let calls = 0;
  const off = registry.onChange(() => calls++);

  registry.set("a", 1);
  off();
  off();
  registry.set("b", 2);
  registry.delete("b");

  assert.equal(calls, 1);
});

test("disposing a non-owner handle detaches only its own listeners", () => {
  const cell = new RegistryCell<number>();
  const stack = new DisposableStack();
  const owner = new ReversibleRegistry<number>(disposer => stack.add(disposer), cell, true);
  const handle = new ReversibleRegistry<number>(() => {}, cell, false);

  let ownerCalls = 0;
  let handleCalls = 0;
  owner.onChange(() => ownerCalls++);
  handle.onChange(() => handleCalls++);

  handle.set("a", 1);
  assert.equal(ownerCalls, 1);
  assert.equal(handleCalls, 1);

  handle.dispose();
  handle.dispose();

  owner.set("b", 2);
  owner.delete("b");

  assert.equal(ownerCalls, 3);
  assert.equal(handleCalls, 1);
});

test("a disposed child handle stops observing later sets, deletes, and reverts", async () => {
  const root = new Context();
  const child = root.fork("child");
  const rootView = root.registry<number>("numbers");
  const childView = child.registry<number>("numbers");

  const rootEvents: number[] = [];
  const childEvents: number[] = [];
  rootView.onChange(() => rootEvents.push(rootView.size));
  childView.onChange(() => childEvents.push(childView.size));

  childView.set("a", 1);
  await child.dispose();
  const childEventsAtDisposal = [...childEvents];

  rootView.set("b", 2);
  rootView.delete("b");
  rootView.set("c", 3);
  rootView.delete("c");

  assert.deepEqual(childEvents, childEventsAtDisposal);
  assert.ok(rootEvents.length > childEventsAtDisposal.length);
  assert.deepEqual(rootEvents.slice(-4), [1, 0, 1, 0]);
});

test("reverting registered sets restores the initial state and notifies listeners", () => {
  const { stack, registry } = scopedRegistry();
  const sizes: number[] = [];
  registry.onChange(() => sizes.push(registry.size));

  registry.set("a", 1);
  registry.set("a", 2);
  registry.set("b", 3);

  stack.run();

  assert.equal(registry.size, 0);
  assert.equal(registry.get("a"), undefined);
  assert.equal(registry.has("b"), false);
  assert.deepEqual(sizes, [1, 1, 2, 1, 1, 0]);
});

test("a registry is reverted when its owning context is disposed", async () => {
  const ctx = new Context();
  const registry = ctx.registry<number>("numbers");
  registry.set("a", 1);
  registry.set("b", 2);

  await ctx.dispose();

  assert.equal(registry.size, 0);
  assert.equal(registry.has("a"), false);
});

test("operations on a reverted registry throw while reads stay empty", async () => {
  const ctx = new Context();
  const registry = ctx.registry<number>("numbers");
  registry.set("a", 1);
  await ctx.dispose();

  assert.throws(() => registry.set("b", 2));
  assert.throws(() => registry.onChange(() => {}));
  assert.equal(registry.get("a"), undefined);
  assert.deepEqual(registry.keys(), []);
});

test("empty namespaces and empty keys are valid", () => {
  const { registry } = scopedRegistry();

  registry.set("", 42);

  assert.equal(registry.get(""), 42);
  assert.equal(registry.has(""), true);
});

test("reverting a chain restores a base value that predates it", () => {
  const cell = new RegistryCell<number>();
  cell.values.set("k", 100);
  const stack = new DisposableStack();
  const registry = new ReversibleRegistry<number>(disposer => stack.add(disposer), cell);

  registry.set("k", 1);
  registry.set("k", 2);
  assert.equal(registry.get("k"), 2);

  stack.run();

  assert.equal(registry.get("k"), 100);
});

test("delete clears the chain so a pending revert is a no-op", () => {
  const { stack, registry } = scopedRegistry();
  registry.set("a", 1);
  registry.delete("a");

  stack.run();

  assert.equal(registry.has("a"), false);
  assert.equal(registry.size, 0);
});

test("a throwing onChange listener cannot break set or suppress the write's revert", () => {
  const { stack, registry } = scopedRegistry();
  let others = 0;
  registry.onChange(() => {
    throw new Error("observer failed");
  });
  registry.onChange(() => others++);

  // `set` must return normally even though one observer throws.
  assert.doesNotThrow(() => registry.set("a", 1));
  assert.equal(registry.get("a"), 1);
  // The throwing observer must not stop the remaining observers from being notified.
  assert.equal(others, 1);

  // The revert disposer was still registered, so disposal rolls the write back.
  assert.doesNotThrow(() => stack.run());
  assert.equal(registry.has("a"), false);
  assert.equal(registry.size, 0);
});
