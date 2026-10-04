import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Context, ServiceScope } from "./index";

test("a rejected duplicate provide leaves the scope untouched and the original disposer still frees the name", () => {
  const scope = new ServiceScope();
  const dispose = scope.provide("x", 1);

  assert.throws(() => scope.provide("x", 2), /already provided/);

  // The failed second provide must not have overwritten or registered anything.
  assert.equal(scope.get("x"), 1);
  assert.equal(scope.has("x"), true);

  dispose();
  assert.equal(scope.has("x"), false);
});

test("a throwing listener does not make provide throw, keeps the service, and does not block other listeners", () => {
  const scope = new ServiceScope();
  const calls: string[] = [];
  scope.onChange(() => calls.push("before"));
  scope.onChange(() => {
    throw new Error("listener boom");
  });
  scope.onChange(() => calls.push("after"));

  let dispose: () => void = () => {};
  assert.doesNotThrow(() => {
    dispose = scope.provide("x", 1);
  });

  // The service is registered, visible, and its disposer still removes it despite the throwing listener.
  assert.equal(scope.has("x"), true);
  assert.equal(scope.get("x"), 1);
  assert.deepEqual(calls, ["before", "after"]);

  calls.length = 0;
  assert.doesNotThrow(() => dispose());
  assert.equal(scope.has("x"), false);
  assert.deepEqual(calls, ["before", "after"]);
});

test("a throwing listener does not make clear throw or stop the remaining listeners", () => {
  const scope = new ServiceScope();
  scope.provide("x", 1);
  const calls: string[] = [];
  scope.onChange(() => calls.push("before"));
  scope.onChange(() => {
    throw new Error("listener boom");
  });
  scope.onChange(() => calls.push("after"));

  assert.doesNotThrow(() => scope.clear());

  assert.equal(scope.has("x"), false);
  assert.deepEqual(calls, ["before", "after"]);
});

test("Context.provide and Context.dispose drive the tree's ServiceScope notifications", async () => {
  const root = new Context();
  // The shared scope is internal to Context; observe it through the controlled subscription API.
  const changes: number[] = [];
  root.onServiceChange(() => changes.push(1));

  root.provide("svc", 1);
  assert.equal(root.has("svc"), true);
  assert.equal(changes.length, 1);

  await root.dispose();

  // Disposal revokes the binding (removal notification) before detaching the observer.
  assert.equal(changes.length, 2);

  // The subscription is gone with the context, so later changes are not observed.
  const other = new Context();
  other.provide("svc", 1);
  assert.equal(changes.length, 2);
});
