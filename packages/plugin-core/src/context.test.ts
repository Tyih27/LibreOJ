import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Context, ServiceScope } from "./index";

// The former "child looks up along the parent chain" / "child shadows parent" / "provide is scoped to its own context"
// cases were removed: services are no longer per-context with parent-chain shadowing. One ServiceScope is shared by the
// whole plugin tree, so lookup has no notion of "own" vs "inherited" and a sibling can consume a service directly.

test("a service provided in one context is visible to every context in its tree", () => {
  const root = new Context();
  const child = root.fork("child");
  root.provide("db", { name: "root-db" });

  assert.deepEqual(child.get("db"), { name: "root-db" });
  assert.deepEqual(child.tryGet("db"), { name: "root-db" });
  assert.equal(child.has("db"), true);
});

test("a service provided by one sibling is visible to another sibling", () => {
  const root = new Context();
  const a = root.fork("a");
  const b = root.fork("b");
  a.provide("svc", 42);

  assert.equal(b.get("svc"), 42);
  assert.equal(root.has("svc"), true);
  assert.equal(b.has("svc"), true);
});

test("providing the same name twice anywhere in one tree throws", () => {
  const root = new Context();
  const a = root.fork("a");
  const b = root.fork("b");
  a.provide("x", 1);

  assert.throws(() => b.provide("x", 2), /already provided/);
  assert.throws(() => root.provide("x", 3), /already provided/);
  assert.equal(b.get("x"), 1);
});

test("disposing the provider removes its service for the whole tree", async () => {
  const root = new Context();
  const provider = root.fork("provider");
  const observer = root.fork("observer");
  provider.provide("svc", 1);

  assert.equal(observer.get("svc"), 1);

  await provider.dispose();

  assert.equal(observer.has("svc"), false);
  assert.equal(observer.tryGet("svc"), undefined);
  assert.throws(() => observer.get("svc"), /not available/);
});

test("independent root contexts do not share services", () => {
  const first = new Context();
  const second = new Context();
  first.provide("svc", 1);

  assert.equal(second.has("svc"), false);
  assert.equal(second.tryGet("svc"), undefined);
});

test("providing the same name twice in one context throws", () => {
  const ctx = new Context();
  ctx.provide("x", 1);

  assert.throws(() => ctx.provide("x", 2), /already provided/);
});

test("get throws for a missing service while tryGet and has report absence", () => {
  const ctx = new Context();

  assert.throws(() => ctx.get("missing"), /not available/);
  assert.equal(ctx.tryGet("missing"), undefined);
  assert.equal(ctx.has("missing"), false);
});

test("onServiceChange observes the tree-wide scope and is revoked when its context is disposed", async () => {
  const root = new Context();
  const child = root.fork("child");
  const changes: number[] = [];
  const off = child.onServiceChange(() => changes.push(1));

  // A service provided anywhere in the tree notifies the subscription.
  root.provide("a", 1);
  assert.equal(changes.length, 1);

  // The returned disposer detaches only this subscription.
  off();
  root.provide("b", 2);
  assert.equal(changes.length, 1);

  // A subscription added through the context is automatically revoked with it.
  child.onServiceChange(() => changes.push(1));
  await child.dispose();
  root.provide("c", 3);
  assert.equal(changes.length, 1);

  await root.dispose();
});

test("events bubble to ancestors, deepest listener first, and never downward", () => {
  const root = new Context();
  const child = root.fork("child");
  const grandchild = child.fork("grandchild");
  const order: string[] = [];
  root.on("ping", () => order.push("root"));
  child.on("ping", () => order.push("child"));
  grandchild.on("ping", () => order.push("grandchild"));

  grandchild.emit("ping");
  assert.deepEqual(order, ["grandchild", "child", "root"]);

  order.length = 0;
  child.emit("ping");
  assert.deepEqual(order, ["child", "root"]);

  order.length = 0;
  root.emit("ping");
  assert.deepEqual(order, ["root"]);
});

test("listeners on one context run in registration order and receive the emit arguments", () => {
  const ctx = new Context();
  const seen: unknown[][] = [];
  ctx.on("e", (...args) => seen.push(["first", ...args]));
  ctx.on("e", (...args) => seen.push(["second", ...args]));

  ctx.emit("e", 1, "two");

  assert.deepEqual(seen, [
    ["first", 1, "two"],
    ["second", 1, "two"]
  ]);
});

test("the disposer returned by on removes the listener", () => {
  const ctx = new Context();
  let count = 0;
  const off = ctx.on("e", () => count++);

  ctx.emit("e");
  assert.equal(count, 1);

  off();
  off();
  ctx.emit("e");
  assert.equal(count, 1);
});

test("effect runs immediately and its returned disposer runs once", () => {
  const ctx = new Context();
  const order: string[] = [];
  const dispose = ctx.effect(() => {
    order.push("run");
    return () => order.push("undo");
  });

  assert.deepEqual(order, ["run"]);

  dispose();
  dispose();
  assert.deepEqual(order, ["run", "undo"]);
});

test("effect accepts a listener that registers no disposer", () => {
  const ctx = new Context();
  let ran = false;

  ctx.effect(() => {
    ran = true;
  });

  assert.equal(ran, true);
});

test("fork creates a child with its own scope and config", () => {
  const root = new Context();
  const child = root.fork("child", { a: 1 });

  assert.equal(root.parent, null);
  assert.equal(root.scope, "root");
  assert.equal(child.parent, root);
  assert.equal(child.scope, "child");
  assert.deepEqual(child.config, { a: 1 });
});

test("disposes children in reverse creation order before its own disposers", async () => {
  const ctx = new Context();
  const order: string[] = [];
  ctx.effect(() => () => order.push("own"));
  const first = ctx.fork("first");
  first.effect(() => () => order.push("first"));
  const second = ctx.fork("second");
  second.effect(() => () => order.push("second"));

  await ctx.dispose();

  assert.deepEqual(order, ["second", "first", "own"]);
});

test("own disposers run in LIFO order", async () => {
  const ctx = new Context();
  const order: string[] = [];
  ctx.effect(() => () => order.push("a"));
  ctx.effect(() => () => order.push("b"));

  await ctx.dispose();

  assert.deepEqual(order, ["b", "a"]);
});

test("disposing a parent disposes its children and grandchildren", async () => {
  const root = new Context();
  const child = root.fork("child");
  const grandchild = child.fork("grandchild");

  await root.dispose();

  assert.equal(root.disposed, true);
  assert.equal(child.disposed, true);
  assert.equal(grandchild.disposed, true);
});

test("dispose is idempotent and disposing a child early does not re-run it", async () => {
  const root = new Context();
  const child = root.fork("child");
  let childRuns = 0;
  let rootRuns = 0;
  child.effect(() => () => childRuns++);
  root.effect(() => () => rootRuns++);

  await child.dispose();
  await root.dispose();
  await root.dispose();

  assert.equal(childRuns, 1);
  assert.equal(rootRuns, 1);
});

test("using a disposed context throws", async () => {
  const ctx = new Context();
  await ctx.dispose();

  assert.throws(() => ctx.provide("x", 1));
  assert.throws(() => ctx.get("x"));
  assert.throws(() => ctx.tryGet("x"));
  assert.throws(() => ctx.has("x"));
  assert.throws(() => ctx.on("e", () => {}));
  assert.throws(() => ctx.emit("e"));
  assert.throws(() => ctx.effect(() => {}));
  assert.throws(() => ctx.fork("child"));
  assert.throws(() => ctx.registry("ns"));
});

test("a child registry is a caller-bound handle over the ancestor's shared storage", () => {
  const root = new Context();
  const child = root.fork("child");
  const fromRoot = root.registry<string>("shared");
  const fromChild = child.registry<string>("shared");

  // Handles are bound to the caller, so they are distinct objects backed by the same cell.
  assert.notEqual(fromChild, fromRoot);
  assert.equal(child.registry<string>("shared"), fromChild);

  fromChild.set("k", "v");
  assert.equal(fromRoot.get("k"), "v");
});

test("same-named registries in independent context trees stay independent", () => {
  const first = new Context();
  const second = new Context();
  const firstRegistry = first.registry<string>("own");
  const secondRegistry = second.registry<string>("own");

  assert.notEqual(firstRegistry, secondRegistry);

  firstRegistry.set("k", "first");
  assert.equal(secondRegistry.has("k"), false);
  assert.equal(first.registry<string>("own"), firstRegistry);
});

test("namespace sharing is order-independent: a child-first request still shares the root's cell", () => {
  const root = new Context();
  const child = root.fork("child");
  const fromChild = child.registry<string>("ns");
  fromChild.set("k", "child");

  const fromRoot = root.registry<string>("ns");

  assert.notEqual(fromRoot, fromChild);
  assert.equal(fromRoot.get("k"), "child");
  fromRoot.set("p", "parent");
  assert.equal(fromChild.get("p"), "parent");
});

test("interleaved writes revert correctly no matter the disposal order", async () => {
  const root = new Context();
  const a = root.fork("a");
  const b = root.fork("b");
  const handle = root.registry<number>("ns");

  a.registry<number>("ns").set("k", 1);
  b.registry<number>("ns").set("k", 2);
  assert.equal(handle.get("k"), 2);

  // A reverting first must not resurrect its own superseded value.
  await a.dispose();
  assert.equal(handle.get("k"), 2);

  await b.dispose();
  assert.equal(handle.has("k"), false);
});

test("overwrites revert to a base registration before being removed", async () => {
  const root = new Context();
  const a = root.fork("a");
  const b = root.fork("b");
  const base = root.registry<number>("ns");
  base.set("k", 100);

  a.registry<number>("ns").set("k", 1);
  b.registry<number>("ns").set("k", 2);

  await a.dispose();
  assert.equal(base.get("k"), 2);

  await b.dispose();
  assert.equal(base.get("k"), 100);
});

test("an explicit delete makes a pending revert a no-op", async () => {
  const root = new Context();
  const child = root.fork("child");
  const owner = root.registry<number>("ns");
  const childHandle = child.registry<number>("ns");
  childHandle.set("k", 1);

  owner.delete("k");
  assert.equal(owner.has("k"), false);

  await child.dispose();
  assert.equal(owner.has("k"), false);
});

test("a child sees registrations from an ancestor and from its siblings", () => {
  const root = new Context();
  const left = root.fork("left");
  const right = root.fork("right");
  // The common ancestor owns the cell, so all descendants share one store.
  root.registry<string>("ns").set("root", "R");

  left.registry<string>("ns").set("left", "L");
  right.registry<string>("ns").set("right", "Y");

  const fromRight = right.registry<string>("ns");
  assert.equal(fromRight.get("root"), "R");
  assert.equal(fromRight.get("left"), "L");
  assert.equal(left.registry<string>("ns").get("right"), "Y");
  assert.equal(root.registry<string>("ns").get("left"), "L");
});

test("disposing a child reverts only its own keys and restores overwritten values", async () => {
  const root = new Context();
  const child = root.fork("child");
  const ancestor = root.registry<number>("ns");
  ancestor.set("shared", 1);
  ancestor.set("kept", 10);

  const childHandle = child.registry<number>("ns");
  childHandle.set("shared", 2);
  childHandle.set("childOnly", 9);

  await child.dispose();

  assert.equal(ancestor.get("shared"), 1);
  assert.equal(ancestor.get("kept"), 10);
  assert.equal(ancestor.has("childOnly"), false);
  assert.deepEqual(ancestor.entries(), [
    ["shared", 1],
    ["kept", 10]
  ]);
});

test("a child's revert does not clobber a later write from another handle", async () => {
  const root = new Context();
  const child = root.fork("child");
  const ancestor = root.registry<number>("ns");
  const childHandle = child.registry<number>("ns");

  childHandle.set("k", 1);
  ancestor.set("k", 2);

  await child.dispose();

  assert.equal(ancestor.get("k"), 2);
});

test("disposing the cell owner clears the shared store for every handle", async () => {
  const root = new Context();
  const child = root.fork("child");
  const ancestor = root.registry<number>("ns");
  ancestor.set("a", 1);
  const childHandle = child.registry<number>("ns");
  childHandle.set("b", 2);
  assert.equal(childHandle.size, 2);

  await root.dispose();

  assert.equal(ancestor.size, 0);
  assert.equal(ancestor.has("a"), false);
  assert.deepEqual(childHandle.keys(), []);
});

test("onChange fires for set, delete, and revert through any handle", async () => {
  const root = new Context();
  const child = root.fork("child");
  const ancestor = root.registry<number>("ns");
  const childHandle = child.registry<number>("ns");
  let changes = 0;
  ancestor.onChange(() => changes++);

  childHandle.set("a", 1);
  assert.equal(changes, 1);

  ancestor.delete("a");
  assert.equal(changes, 2);

  childHandle.set("b", 2);
  assert.equal(changes, 3);

  await child.dispose();
  assert.equal(changes, 4);
});

test("ServiceScope.onChange fires on provide and removal, and detaches with the listening context", async () => {
  const scope = new ServiceScope();
  const ctx = new Context();
  let changes = 0;
  // Tying the listener to the context's stack makes it revoke automatically on disposal.
  ctx.effect(() => scope.onChange(() => changes++));

  scope.provide("a", 1);
  assert.equal(changes, 1);

  scope.clear();
  assert.equal(changes, 2);

  scope.provide("b", 2);
  assert.equal(changes, 3);

  await ctx.dispose();
  scope.provide("c", 3);
  assert.equal(changes, 3);

  // An explicit disposer detaches just one listener, leaving later changes unobserved.
  const detached = scope.onChange(() => changes++);
  detached();
  scope.provide("d", 4);
  assert.equal(changes, 3);

  const attached = scope.onChange(() => changes++);
  scope.provide("e", 5);
  assert.equal(changes, 4);
  attached();
  scope.provide("f", 6);
  assert.equal(changes, 4);
});
