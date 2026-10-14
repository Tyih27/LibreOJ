import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "node:path";
import { validatePlugin } from "./validate";

const packageDir = path.join(__dirname, "..");

test("validates a healthy CommonJS package and reports its manifest", async () => {
  const result = await validatePlugin("./fixtures/demo/provides", { baseDir: packageDir });

  assert.equal(result.ok, true);
  assert.equal(result.requested, "./fixtures/demo/provides");
  assert.equal(result.definitionName, "@fixture/provides");
  assert.equal(result.moduleKind, "cjs");
  assert.equal(result.manifestEntry, "index.js");
  assert.equal(result.manifestConfig, true);
  assert.ok(result.entry?.endsWith("index.js"));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("validates an ESM package through the dynamic import path", async () => {
  const result = await validatePlugin("./fixtures/esm-plugin", { baseDir: packageDir });

  assert.equal(result.ok, true);
  assert.equal(result.definitionName, "@fixture/esm-provides");
  assert.equal(result.moduleKind, "esm");
  // The ESM fixture declares no config schema, which is only advisory.
  assert.ok(result.warnings.some(warning => /no config schema/.test(warning)));
  assert.deepEqual(result.errors, []);
});

test("reports an unresolvable package with an actionable error", async () => {
  const result = await validatePlugin("./fixtures/does-not-exist", { baseDir: packageDir });

  assert.equal(result.ok, false);
  assert.equal(result.definitionName, undefined);
  assert.ok(result.errors.some(error => /Cannot resolve plugin/.test(error)));
});

test("reports a package whose entry does not export a definition", async () => {
  const result = await validatePlugin("./fixtures/bad-export", { baseDir: packageDir });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /does not export a PluginDefinition/.test(error)));
});

test("reports malformed definition metadata field by field", async () => {
  const result = await validatePlugin("./fixtures/bad-inject", { baseDir: packageDir });

  assert.equal(result.ok, false);
  assert.equal(result.definitionName, "@fixture/bad-inject");
  const errors = result.errors.join("\n");
  assert.match(errors, /inject\.required must be an array of strings/);
  assert.match(errors, /provide must be an array of strings/);
  assert.match(errors, /config\.defaults must be a plain object/);
  assert.match(errors, /config\.parse must be a function/);
});

test("warns but passes when the package has no libreoj.entry", async () => {
  const result = await validatePlugin("./fixtures/main-only", { baseDir: packageDir });

  assert.equal(result.ok, true);
  assert.equal(result.definitionName, "@fixture/main-only");
  assert.equal(result.manifestEntry, undefined);
  assert.equal(result.manifestConfig, false);
  assert.ok(result.warnings.some(warning => /no libreoj\.entry/.test(warning)));
  assert.deepEqual(result.errors, []);
});

test("rejects a libreoj block that is not an object", async () => {
  const result = await validatePlugin("./fixtures/bad-manifest", { baseDir: packageDir });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /libreoj manifest must be an object/.test(error)));
});

test("rejects a non-string libreoj.entry", async () => {
  const result = await validatePlugin("./fixtures/bad-manifest-entry", { baseDir: packageDir });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /libreoj\.entry must be a string/.test(error)));
});

test("rejects a non-object libreoj.config", async () => {
  const result = await validatePlugin("./fixtures/bad-manifest-config", { baseDir: packageDir });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /libreoj\.config must be an object/.test(error)));
});

test("returns a failed result instead of throwing when package.json is not a JSON object", async () => {
  // Node's directory resolution already rejects a `null` package.json, so point at a file in the package to reach
  // validatePlugin's shared `readPackageJson` step with the malformed manifest.
  const result = await validatePlugin("./fixtures/bad-package-json/package.json", { baseDir: packageDir });

  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.match(result.errors.join("\n"), /expected a JSON object/);
});
