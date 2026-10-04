import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  resolveConfig,
  resolveProfileChain,
  resolveProfileConfig,
  type ConfigLayer,
  type Profile,
  type ResolvedConfig
} from "./index";

function names(resolved: ResolvedConfig): string[] {
  return resolved.plugins.map(plugin => plugin.name);
}

function plugin(resolved: ResolvedConfig, name: string) {
  const found = resolved.plugins.find(entry => entry.name === name);
  assert.ok(found, `expected resolved plugin "${name}" to exist`);
  return found;
}

test("appends bundles in first-seen order and deep-merges config across layers", () => {
  const base: ConfigLayer = {
    name: "base",
    bundles: ["@a", "@b"],
    config: {
      "@a": { x: 1, nested: { p: 1, q: 2 } },
      "@b": { on: true }
    }
  };
  const web: ConfigLayer = {
    name: "web",
    bundles: ["@b", "@c"],
    config: {
      "@a": { nested: { q: 3, r: 4 }, y: 5 }
    }
  };

  const resolved = resolveConfig([base, web]);

  assert.deepEqual(names(resolved), ["@a", "@b", "@c"]);
  assert.equal(plugin(resolved, "@a").source, "bundles");
  assert.deepEqual(plugin(resolved, "@a").config, { x: 1, nested: { p: 1, q: 3, r: 4 }, y: 5 });
  assert.deepEqual(plugin(resolved, "@b").config, { on: true });
  assert.deepEqual(plugin(resolved, "@c").config, {});
});

test("applies patch on top of config, deep-merging objects", () => {
  const base: ConfigLayer = {
    bundles: ["@a"],
    config: { "@a": { x: 1, nested: { p: 1 } } }
  };
  const web: ConfigLayer = {
    patch: { "@a": { nested: { q: 2 }, y: 3 } }
  };

  const resolved = resolveConfig([base, web]);

  assert.deepEqual(plugin(resolved, "@a").config, { x: 1, nested: { p: 1, q: 2 }, y: 3 });
});

test("marks patched entries as disabled instead of removing them from the resolved tree", () => {
  const base: ConfigLayer = { bundles: ["@a", "@b"] };
  const web: ConfigLayer = { patch: { "@b": { disabled: true } } };

  const resolved = resolveConfig([base, web]);

  assert.deepEqual(names(resolved), ["@a", "@b"]);
  assert.equal(plugin(resolved, "@a").disabled, false);
  assert.equal(plugin(resolved, "@b").disabled, true);
  // "disabled" is a control key, not plugin config.
  assert.deepEqual(plugin(resolved, "@b").config, {});
});

test("keeps sibling patch keys while disabling an entry", () => {
  const resolved = resolveConfig([
    { bundles: ["@b"], config: { "@b": { keep: 1 } } },
    { patch: { "@b": { disabled: true, note: "off" } } }
  ]);

  assert.equal(plugin(resolved, "@b").disabled, true);
  assert.deepEqual(plugin(resolved, "@b").config, { keep: 1, note: "off" });
});

test("patch can explicitly re-enable an entry with disabled: false", () => {
  const resolved = resolveConfig([
    { bundles: ["@a"] },
    { patch: { "@a": { disabled: true } } },
    { patch: { "@a": { disabled: false } } }
  ]);

  assert.equal(plugin(resolved, "@a").disabled, false);
});

test("expands extends chain with the base applied first", () => {
  const profiles: Record<string, Profile> = {
    base: { name: "base", bundles: ["@base"], config: { "@base": { a: 1 } } },
    web: { name: "web", extends: "base", bundles: ["@web"], patch: { "@base": { b: 2 } } }
  };

  const chain = resolveProfileChain("web", profiles);
  assert.deepEqual(
    chain.map(layer => layer.name),
    ["base", "web"]
  );

  const resolved = resolveProfileConfig("web", profiles);
  assert.deepEqual(names(resolved), ["@base", "@web"]);
  assert.deepEqual(plugin(resolved, "@base").config, { a: 1, b: 2 });
});

test("expands a multi-level extends chain transitively", () => {
  const profiles: Record<string, Profile> = {
    base: { name: "base", bundles: ["@base"] },
    mid: { name: "mid", extends: "base", bundles: ["@mid"] },
    leaf: { name: "leaf", extends: "mid", bundles: ["@leaf"] }
  };

  assert.deepEqual(
    resolveProfileChain("leaf", profiles).map(layer => layer.name),
    ["base", "mid", "leaf"]
  );
  assert.deepEqual(names(resolveProfileConfig("leaf", profiles)), ["@base", "@mid", "@leaf"]);
});

test("replaces arrays wholesale instead of concatenating them", () => {
  const resolved = resolveConfig([
    { bundles: ["@a"], config: { "@a": { list: [1, 2, 3], nested: { list: [1, 2] } } } },
    { config: { "@a": { list: [9], nested: { list: [3] } } } }
  ]);

  assert.deepEqual(plugin(resolved, "@a").config, { list: [9], nested: { list: [3] } });
});

test("deduplicates names across bundles and plugins, keeping the first occurrence", () => {
  const resolved = resolveConfig([{ bundles: ["@a", "@a", "@b"], plugins: ["@b", "@c"] }]);

  assert.deepEqual(names(resolved), ["@a", "@b", "@c"]);
  assert.equal(plugin(resolved, "@a").source, "bundles");
  assert.equal(plugin(resolved, "@b").source, "bundles");
  assert.equal(plugin(resolved, "@c").source, "plugins");
});

test("records plugins source for entries introduced through plugins", () => {
  const resolved = resolveConfig([{ plugins: ["@p"] }]);

  assert.deepEqual(names(resolved), ["@p"]);
  assert.equal(plugin(resolved, "@p").source, "plugins");
});

test("keeps the first source when a name appears in plugins before bundles", () => {
  const resolved = resolveConfig([{ plugins: ["@a"] }, { bundles: ["@a"] }]);

  assert.deepEqual(names(resolved), ["@a"]);
  assert.equal(plugin(resolved, "@a").source, "plugins");
});

test("applies forward references to plugins registered by a later layer", () => {
  const resolved = resolveConfig([
    { name: "early", config: { "@late": { from: "early" } } },
    { name: "late", bundles: ["@late"], patch: { "@late": { added: true } } }
  ]);

  assert.deepEqual(names(resolved), ["@late"]);
  assert.deepEqual(plugin(resolved, "@late").config, { from: "early", added: true });
  assert.deepEqual(resolved.warnings, []);
});

test("warns about config and patch entries for plugins that are never registered", () => {
  const resolved = resolveConfig([
    { name: "base", bundles: ["@a"], config: { "@ghost": { x: 1 } }, patch: { "@ghost": { disabled: true } } }
  ]);

  assert.deepEqual(names(resolved), ["@a"]);
  assert.equal(resolved.warnings.length, 2);
  assert.match(resolved.warnings[0], /config/);
  assert.match(resolved.warnings[0], /@ghost/);
  assert.match(resolved.warnings[0], /base/);
  assert.match(resolved.warnings[1], /patch/);
  assert.match(resolved.warnings[1], /@ghost/);
});

test("warns when a config or patch value is not a plain object", () => {
  const resolved = resolveConfig([{ name: "base", bundles: ["@a"], config: { "@a": 42 }, patch: { "@a": ["nope"] } }]);

  assert.deepEqual(plugin(resolved, "@a").config, {});
  assert.equal(resolved.warnings.length, 2);
  assert.match(resolved.warnings[0], /not a plain object/);
  assert.match(resolved.warnings[1], /not a plain object/);
});

test("does not mutate the layer inputs", () => {
  const base: ConfigLayer = {
    bundles: ["@a"],
    config: { "@a": { nested: { p: 1 }, list: [1, 2] } }
  };
  const web: ConfigLayer = { patch: { "@a": { nested: { q: 2 }, list: [3] } } };
  const snapshot = JSON.parse(JSON.stringify([base, web])) as unknown[];

  const resolved = resolveConfig([base, web]);
  // Mutating the result must not leak back into the inputs either.
  plugin(resolved, "@a").config.nested = { touched: true };
  (plugin(resolved, "@a").config.list as number[]).push(99);

  assert.deepEqual([base, web], snapshot);
});

test("throws on a cyclic extends chain", () => {
  const profiles: Record<string, Profile> = {
    a: { extends: "b" },
    b: { extends: "a" }
  };

  assert.throws(() => resolveProfileChain("a", profiles), /cyclic/i);
});

test("throws on a self-referential extends chain", () => {
  assert.throws(() => resolveProfileChain("a", { a: { extends: "a" } }), /cyclic/i);
});

test("throws on an unknown profile and an unknown extends target", () => {
  assert.throws(() => resolveProfileChain("missing", {}), /unknown profile/i);
  assert.throws(() => resolveProfileChain("x", { x: { extends: "nope" } }), /unknown profile/i);
});

test("resolveConfig with no layers yields an empty plugin list and no warnings", () => {
  assert.deepEqual(resolveConfig([]), { plugins: [], warnings: [] });
});
