import { test } from "node:test";
import * as assert from "node:assert/strict";
import { EventBus } from "./index";

test("invokes local listeners in registration order with the emitted arguments", () => {
  const bus = new EventBus();
  const seen: unknown[][] = [];
  bus.on("e", (...args) => {
    seen.push(["first", ...args]);
  });
  bus.on("e", (...args) => {
    seen.push(["second", ...args]);
  });

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

test("before listeners run before on listeners and after listeners, each tier in registration order", () => {
  const bus = new EventBus();
  const order: string[] = [];
  const record = (label: string): void => {
    order.push(label);
  };
  bus.after("e", () => record("after-1"));
  bus.on("e", () => record("on-1"));
  bus.before("e", () => record("before-1"));
  bus.after("e", () => record("after-2"));
  bus.on("e", () => record("on-2"));
  bus.before("e", () => record("before-2"));

  bus.emit("e");

  assert.deepEqual(order, ["before-1", "before-2", "on-1", "on-2", "after-1", "after-2"]);
});

test("a listener returning a non-undefined value bails out and emit returns that value", () => {
  const bus = new EventBus();
  const order: string[] = [];
  bus.before("e", () => {
    order.push("before");
    return "stop";
  });
  bus.on("e", () => {
    order.push("on");
  });
  bus.after("e", () => {
    order.push("after");
  });

  const result = bus.emit("e");

  assert.equal(result, "stop");
  assert.deepEqual(order, ["before"]);
});

test("returning undefined does not bail; the first non-undefined value in a tier wins", () => {
  const bus = new EventBus();
  const order: string[] = [];
  bus.on("e", () => undefined);
  bus.on("e", () => {
    order.push("second");
    return 0;
  });
  bus.on("e", () => {
    order.push("third");
  });

  const result = bus.emit("e");

  assert.equal(result, 0);
  assert.deepEqual(order, ["second"]);
});

test("once runs in the normal tier and fires at most once", () => {
  const bus = new EventBus();
  const order: string[] = [];
  const record = (label: string): void => {
    order.push(label);
  };
  bus.before("e", () => record("before"));
  bus.once("e", () => record("once"));
  bus.after("e", () => record("after"));

  bus.emit("e");
  bus.emit("e");

  assert.deepEqual(order, ["before", "once", "after", "before", "after"]);
});

test("the disposer returned by once removes the listener before it ever fires", () => {
  const bus = new EventBus();
  let fired = 0;
  const off = bus.once("e", () => {
    fired++;
  });

  off();
  off();
  bus.emit("e");

  assert.equal(fired, 0);
});
