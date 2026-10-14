import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "node:path";
import { ChainResolver } from "./chain-resolver";
import { NodeResolver } from "./node-resolver";
import { InlineResolver, type ModuleResolver, type PluginDefinition } from "./plugin";

function definition(name: string): PluginDefinition {
  return { name, apply() {} };
}

/** `src/` -> the `@libreoj/plugin-core` package root, the base for the filesystem fallback test. */
const packageDir = path.join(__dirname, "..");

test("returns the first resolver's result without consulting later resolvers", async () => {
  let fallbackCalled = false;
  const fallback: ModuleResolver = {
    resolve() {
      fallbackCalled = true;
      throw new Error("fallback should not run");
    }
  };
  const chain = new ChainResolver([new InlineResolver({ known: definition("known") }), fallback]);

  const resolved = await chain.resolve("known");

  assert.equal(resolved.name, "known");
  assert.equal(fallbackCalled, false);
});

test("falls through to a later resolver for a name the first does not know", async () => {
  const chain = new ChainResolver([
    new InlineResolver({ known: definition("known") }),
    new InlineResolver({ other: definition("other") })
  ]);

  const resolved = await chain.resolve("other");

  assert.equal(resolved.name, "other");
});

test("accepts a fallback that returns a promise", async () => {
  const miss: ModuleResolver = {
    resolve() {
      throw new Error("miss");
    }
  };
  const asyncHit: ModuleResolver = {
    async resolve(name) {
      return definition(`${name}-async`);
    }
  };
  const chain = new ChainResolver([miss, asyncHit]);

  const resolved = await chain.resolve("remote");

  assert.equal(resolved.name, "remote-async");
});

test("advances past a resolver whose promise rejects", async () => {
  const rejecting: ModuleResolver = {
    resolve: () => Promise.reject(new Error("async miss"))
  };
  const chain = new ChainResolver([rejecting, new InlineResolver({ known: definition("known") })]);

  const resolved = await chain.resolve("known");

  assert.equal(resolved.name, "known");
});

test("rethrows the last error when every resolver fails", async () => {
  const first: ModuleResolver = {
    resolve() {
      throw new Error("first");
    }
  };
  const second: ModuleResolver = {
    resolve: () => Promise.reject(new Error("second"))
  };
  const chain = new ChainResolver([first, second]);

  await assert.rejects(() => chain.resolve("missing"), /second/);
});

test("rejects an empty resolver list", () => {
  assert.throws(() => new ChainResolver([]), /at least one resolver/);
});

test("resolves a name absent from the inline map from the filesystem", async () => {
  const chain = new ChainResolver([
    new InlineResolver({ known: definition("known") }),
    new NodeResolver({ baseDir: packageDir })
  ]);

  const resolved = await chain.resolve("./fixtures/demo/provides");

  assert.equal(resolved.name, "@fixture/provides");
  assert.equal(typeof resolved.apply, "function");
});
