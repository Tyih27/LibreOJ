import { test } from "node:test";
import * as assert from "node:assert/strict";
import { DisposableStack } from "./index";

test("runs disposers in reverse registration order", () => {
  const stack = new DisposableStack();
  const order: string[] = [];
  stack.add(() => order.push("first"));
  stack.add(() => order.push("second"));
  stack.add(() => order.push("third"));

  stack.run();

  assert.deepEqual(order, ["third", "second", "first"]);
});

test("run is idempotent and never re-runs a disposer", () => {
  const stack = new DisposableStack();
  let runs = 0;
  stack.add(() => runs++);

  stack.run();
  stack.run();

  assert.equal(runs, 1);
  assert.equal(stack.disposed, true);
});

test("the disposer returned by add unregisters and runs the entry exactly once", () => {
  const stack = new DisposableStack();
  const order: string[] = [];
  const remove = stack.add(() => order.push("registered"));
  stack.add(() => order.push("other"));

  remove();
  remove();
  stack.run();

  // The remover runs its disposer eagerly; run() must not invoke it a second time.
  assert.deepEqual(order, ["registered", "other"]);
});

test("rejects new disposers after run", () => {
  const stack = new DisposableStack();
  stack.run();

  assert.throws(() => stack.add(() => {}));
});

test("keeps running remaining disposers when one throws, then rethrows the first failure", () => {
  const stack = new DisposableStack();
  const order: string[] = [];
  stack.add(() => order.push("first"));
  stack.add(() => {
    throw new Error("boom");
  });
  stack.add(() => order.push("third"));

  assert.throws(() => stack.run(), /boom/);
  assert.deepEqual(order, ["third", "first"]);
});
