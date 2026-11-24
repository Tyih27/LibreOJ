import "reflect-metadata";

import assert from "node:assert/strict";
import { test } from "node:test";

import { bindManualServiceResolver, bindNestServiceResolver, svc, type BackendServices } from "../src/service-resolver";

// The unbound check must run before any bind; node:test runs a file's top-level tests sequentially in declaration order,
// and each test file is a separate process, so the module-level resolver starts unbound here.
test("svc throws a clear error while no resolver is bound", () => {
  assert.throws(() => svc("userService"), /resolver is not bound/);
});

test("bindManualServiceResolver resolves each key off the given object", () => {
  const userService = { name: "user" };
  const configService = { name: "config" };
  bindManualServiceResolver({ userService, configService } as unknown as BackendServices);

  assert.equal(svc("userService"), userService);
  assert.equal(svc("configService"), configService);
});

test("rebinding swaps the resolver", () => {
  const first = { userService: { name: "first" } };
  const second = { userService: { name: "second" } };

  bindManualServiceResolver(first as unknown as BackendServices);
  assert.deepEqual(svc("userService"), { name: "first" });

  bindManualServiceResolver(second as unknown as BackendServices);
  assert.deepEqual(svc("userService"), { name: "second" });
});

test("bindNestServiceResolver forwards the token with { strict: false }", () => {
  const calls: [unknown, unknown][] = [];
  const nestApp = {
    get(token: unknown, options?: unknown): unknown {
      calls.push([token, options]);
      return { resolvedFrom: token };
    }
  };
  const tokens = { userService: "USER_SERVICE_TOKEN" } as unknown as Record<keyof BackendServices, unknown>;

  bindNestServiceResolver(nestApp, tokens);
  const resolved = svc("userService");

  assert.deepEqual(calls, [["USER_SERVICE_TOKEN", { strict: false }]]);
  assert.deepEqual(resolved, { resolvedFrom: "USER_SERVICE_TOKEN" });
});
