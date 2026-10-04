import { test } from "node:test";
import * as assert from "node:assert/strict";
import { EventBus } from "./index";

test("invokes local listeners in registration order with the emitted arguments", () => {
  const bus = new EventBus();
  const seen: unknown[][] = [];
  bus.on("e", (...args) => seen.push(["first", ...args]));
  bus.on("e", (...args) => seen.push(["second", ...args]));

  bus.emit("e", 1, "two");

  assert.deepEqual(seen, [
    ["first", 1, "two"],
    ["second", 1, "two"]
  ]);
});

test("the disposer returned by on removes only its own listener", () => {
  const bus = new EventBus();
  let first = 0;
  let second = 0;
  const off = bus.on("e", () => first++);
  bus.on("e", () => second++);

  off();
  off();
  bus.emit("e");

  assert.equal(first, 0);
  assert.equal(second, 1);
});

test("emitting an unknown event is a no-op and clear drops every listener", () => {
  const bus = new EventBus();
  let fired = 0;
  bus.on("e", () => fired++);

  bus.emit("other");
  assert.equal(fired, 0);

  bus.clear();
  bus.emit("e");
  assert.equal(fired, 0);
});
