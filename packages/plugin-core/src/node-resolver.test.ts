import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { NodeResolver } from "./node-resolver";
import type { PluginDefinition } from "./plugin";

const fixturesDir = path.join(__dirname, "..", "fixtures");
const demoDir = path.join(fixturesDir, "demo");

function writePlugin(exportsSource: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-resolver-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tmp-plugin", main: "index.js" }));
  writeFileSync(path.join(dir, "index.js"), exportsSource);
  return dir;
}

function writeEsmPlugin(source: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-resolver-esm-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tmp-esm", type: "module", main: "index.mjs" }));
  writeFileSync(path.join(dir, "index.mjs"), source);
  return dir;
}

function cjsPlugin(marker: string): string {
  return `"use strict";\nmodule.exports.plugin = { name: "tmp-fresh", config: { defaults: { marker: "${marker}" } }, apply() {} };\n`;
}

test("resolves a local plugin by relative path and reads its manifest entry", async () => {
  const resolver = new NodeResolver({ baseDir: demoDir });
  const definition = await resolver.resolve("./provides");

  assert.equal(definition.name, "@fixture/provides");
  assert.deepEqual(definition.inject?.required, []);
  assert.equal(typeof definition.apply, "function");
});

test("merges package.json libreoj.config below the plugin's own defaults", async () => {
  const resolver = new NodeResolver({ baseDir: demoDir });
  const definition = await resolver.resolve("./provides");

  // The manifest default is the lower layer: the plugin's own default wins.
  assert.deepEqual(definition.config?.defaults, { greeting: "hello", manifestOnly: true });
});

test("accepts a module exported as `default`", async () => {
  const resolver = new NodeResolver({ baseDir: demoDir });
  const definition = await resolver.resolve("./consumes");

  assert.equal(definition.name, "@fixture/consumes");
  assert.deepEqual(definition.inject?.required, ["greeting"]);
});

test("accepts an export that is itself a PluginDefinition", async () => {
  const dir = writePlugin(`"use strict";\nmodule.exports = { name: "bare", apply() {} };\n`);
  const resolver = new NodeResolver({ baseDir: path.dirname(dir) });

  const definition = await resolver.resolve(`./${path.basename(dir)}`);
  assert.equal(definition.name, "bare");
});

test("resolves a package with no libreoj.entry using only its main field", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-resolver-main-"));
  mkdirSync(path.join(dir, "lib"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "main-only", main: "lib/entry.js" }));
  writeFileSync(
    path.join(dir, "lib", "entry.js"),
    `"use strict";\nmodule.exports = { name: "main-only", apply() {} };\n`
  );

  const resolver = new NodeResolver({ baseDir: path.dirname(dir) });
  const definition = await resolver.resolve(`./${path.basename(dir)}`);

  assert.equal(definition.name, "main-only");
  assert.equal(typeof definition.apply, "function");
});

test("throws a clear error when the package cannot be found", () => {
  const resolver = new NodeResolver({ baseDir: demoDir });
  assert.throws(() => resolver.resolve("@fixture/does-not-exist"), /Cannot resolve plugin/);
});

test("throws a clear error when the entry does not export a definition", () => {
  const dir = writePlugin("module.exports = { not: 'a plugin' };\n");
  const resolver = new NodeResolver({ baseDir: path.dirname(dir) });

  assert.throws(() => resolver.resolve(`./${path.basename(dir)}`), /does not export a PluginDefinition/);
});

test("resolves an ESM plugin package and reads its named `plugin` export", async () => {
  const resolver = new NodeResolver({ baseDir: fixturesDir });
  const definition = await resolver.resolve("./esm-plugin");

  assert.equal(definition.name, "@fixture/esm-provides");
  assert.deepEqual(definition.inject?.required, []);
  assert.equal(typeof definition.apply, "function");
});

test("resolves an ESM module whose definition is the `default` export", async () => {
  const dir = writeEsmPlugin(`export default { name: "esm-default", apply() {} };\n`);
  const resolver = new NodeResolver({ baseDir: path.dirname(dir) });

  const definition = await resolver.resolve(`./${path.basename(dir)}`);
  assert.equal(definition.name, "esm-default");
  assert.equal(typeof definition.apply, "function");
});

test("accepts an ESM function export as a plugin", async () => {
  const dir = writeEsmPlugin(`export default function esmFunction(ctx) { ctx.provide("esm.fn", 1); }\n`);
  const resolver = new NodeResolver({ baseDir: path.dirname(dir) });

  const definition = await resolver.resolve(`./${path.basename(dir)}`);
  assert.equal(definition.name, "esmFunction");
  assert.equal(typeof definition.apply, "function");
});

test("fresh resolution re-reads a changed CommonJS entry from disk", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-resolver-fresh-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tmp-fresh", main: "index.js" }));
  writeFileSync(path.join(dir, "index.js"), cjsPlugin("one"));

  const resolver = new NodeResolver({ baseDir: path.dirname(dir) });
  const name = `./${path.basename(dir)}`;

  const first = await resolver.resolve(name);
  assert.equal(first.config?.defaults?.marker, "one");

  writeFileSync(path.join(dir, "index.js"), cjsPlugin("two"));

  // Without `fresh`, the CommonJS cache serves the module evaluated from the first version.
  const cached = (await resolver.resolve(name)) as PluginDefinition;
  assert.equal(cached.config?.defaults?.marker, "one");

  // With `fresh`, the entry (and manifest) are evicted from `require.cache` and the file is re-read.
  const reloaded = (await resolver.resolve(name, { fresh: true })) as PluginDefinition;
  assert.equal(reloaded.config?.defaults?.marker, "two");
});
