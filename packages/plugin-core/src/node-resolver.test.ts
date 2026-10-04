import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { NodeResolver } from "./node-resolver";

const demoDir = path.join(__dirname, "..", "fixtures", "demo");

function writePlugin(exportsSource: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-resolver-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tmp-plugin", main: "index.js" }));
  writeFileSync(path.join(dir, "index.js"), exportsSource);
  return dir;
}

test("resolves a local plugin by relative path and reads its manifest entry", () => {
  const resolver = new NodeResolver({ baseDir: demoDir });
  const definition = resolver.resolve("./provides");

  assert.equal(definition.name, "@fixture/provides");
  assert.deepEqual(definition.inject?.required, []);
  assert.equal(typeof definition.apply, "function");
});

test("merges package.json libreoj.config below the plugin's own defaults", () => {
  const resolver = new NodeResolver({ baseDir: demoDir });
  const definition = resolver.resolve("./provides");

  // The manifest default is the lower layer: the plugin's own default wins.
  assert.deepEqual(definition.config?.defaults, { greeting: "hello", manifestOnly: true });
});

test("accepts a module exported as `default`", () => {
  const resolver = new NodeResolver({ baseDir: demoDir });
  const definition = resolver.resolve("./consumes");

  assert.equal(definition.name, "@fixture/consumes");
  assert.deepEqual(definition.inject?.required, ["greeting"]);
});

test("accepts an export that is itself a PluginDefinition", () => {
  const dir = writePlugin(`"use strict";\nmodule.exports = { name: "bare", apply() {} };\n`);
  const resolver = new NodeResolver({ baseDir: path.dirname(dir) });

  const definition = resolver.resolve(`./${path.basename(dir)}`);
  assert.equal(definition.name, "bare");
});

test("resolves a package with no libreoj.entry using only its main field", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-resolver-main-"));
  mkdirSync(path.join(dir, "lib"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "main-only", main: "lib/entry.js" }));
  writeFileSync(
    path.join(dir, "lib", "entry.js"),
    `"use strict";\nmodule.exports = { name: "main-only", apply() {} };\n`
  );

  const resolver = new NodeResolver({ baseDir: path.dirname(dir) });
  const definition = resolver.resolve(`./${path.basename(dir)}`);

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
