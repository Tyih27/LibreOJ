import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadPatchFile, loadProfileFile } from "./profile";

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-profile-"));
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

test("expands a profiles/active file, following extends with the base first", () => {
  const file = writeTemp(
    "profile.yaml",
    [
      "active: web",
      "profiles:",
      "  base:",
      "    name: base",
      "    bundles: ['@a']",
      "  mid:",
      "    extends: base",
      "    name: mid",
      "    plugins: ['./local']",
      "  web:",
      "    extends: mid",
      "    name: web",
      "    config:",
      "      '@a':",
      "        port: 8080",
      ""
    ].join("\n")
  );

  const layers = loadProfileFile(file);

  assert.equal(layers.length, 3);
  assert.deepEqual(
    layers.map(layer => layer.name),
    ["base", "mid", "web"]
  );
  assert.deepEqual(layers[0].bundles, ["@a"]);
  assert.deepEqual(layers[1].plugins, ["./local"]);
  assert.deepEqual(layers[2].config, { "@a": { port: 8080 } });
  // `extends` is a profile-only key and must not leak into the resolved layers.
  assert.ok(!("extends" in layers[0]));
});

test("treats a file without a profiles mapping as a single profile layer", () => {
  const file = writeTemp("solo.yaml", ["name: solo", "bundles: ['@a', '@b']", ""].join("\n"));

  assert.deepEqual(loadProfileFile(file), [{ name: "solo", bundles: ["@a", "@b"] }]);
});

test("loads a patch overlay file into a ConfigLayer", () => {
  const file = writeTemp(
    "patch.yaml",
    ["name: site", "patch:", "  '@a':", "    disabled: true", "config:", "  '@b':", "    x: 1", ""].join("\n")
  );

  assert.deepEqual(loadPatchFile(file), {
    name: "site",
    patch: { "@a": { disabled: true } },
    config: { "@b": { x: 1 } }
  });
});

test("throws a clear error when the profile file does not exist", () => {
  const missing = path.join(tmpdir(), "plugin-core-does-not-exist", "profile.yaml");
  assert.throws(() => loadProfileFile(missing), /Cannot read .*profile\.yaml/);
});

test("throws a clear error on invalid YAML", () => {
  const file = writeTemp("broken.yaml", "key: [1, 2\n");
  assert.throws(() => loadProfileFile(file), /Invalid YAML .*broken\.yaml/);
});

test("throws when an active profile is not defined", () => {
  const file = writeTemp("profile.yaml", "active: ghost\nprofiles:\n  real:\n    name: real\n");
  assert.throws(() => loadProfileFile(file), /Active profile "ghost".*not defined/);
});

test("throws when a profiles file omits active", () => {
  const file = writeTemp("profile.yaml", "profiles:\n  real:\n    name: real\n");
  assert.throws(() => loadProfileFile(file), /must define a non-empty "active"/);
});

test("throws when a profile extends an unknown profile", () => {
  const file = writeTemp(
    "profile.yaml",
    ["active: top", "profiles:", "  top:", "    extends: ghost", "    name: top", ""].join("\n")
  );
  assert.throws(() => loadProfileFile(file), /Unknown profile "ghost"/);
});

test("throws when a named profile is not a mapping", () => {
  for (const value of ["hello", "['a', 'b']", "null", "42"]) {
    const file = writeTemp("profile.yaml", `active: a\nprofiles:\n  a: ${value}\n`);
    assert.throws(() => loadProfileFile(file), /Profile "a".*must be a mapping/);
  }
});

test("throws when a named profile field has the wrong type", () => {
  const bundles = writeTemp("profile.yaml", "active: a\nprofiles:\n  a:\n    bundles: '@x'\n");
  assert.throws(() => loadProfileFile(bundles), /Profile "a".*"bundles" must be an array of strings/);

  const plugins = writeTemp("profile.yaml", "active: a\nprofiles:\n  a:\n    plugins: [1, 2]\n");
  assert.throws(() => loadProfileFile(plugins), /Profile "a".*"plugins" must be an array of strings/);

  const config = writeTemp("profile.yaml", "active: a\nprofiles:\n  a:\n    config: 3\n");
  assert.throws(() => loadProfileFile(config), /Profile "a".*"config" must be a mapping/);

  const patch = writeTemp("profile.yaml", "active: a\nprofiles:\n  a:\n    patch: [1]\n");
  assert.throws(() => loadProfileFile(patch), /Profile "a".*"patch" must be a mapping/);

  const name = writeTemp("profile.yaml", "active: a\nprofiles:\n  a:\n    name: 7\n");
  assert.throws(() => loadProfileFile(name), /Profile "a".*"name" must be a string/);

  const ext = writeTemp("profile.yaml", "active: a\nprofiles:\n  a:\n    extends: 7\n");
  assert.throws(() => loadProfileFile(ext), /Profile "a".*"extends" must be a string/);
});

test("throws when a single-profile field has the wrong type", () => {
  const file = writeTemp("solo.yaml", "name: solo\nbundles: '@a'\n");
  assert.throws(() => loadProfileFile(file), /Profile file .*"bundles" must be an array of strings/);
});

test("throws when active is missing or not a string", () => {
  const missing = writeTemp("profile.yaml", "profiles:\n  a:\n    name: a\n");
  assert.throws(() => loadProfileFile(missing), /must define a non-empty "active"/);

  const numeric = writeTemp("profile.yaml", "active: 7\nprofiles:\n  a:\n    name: a\n");
  assert.throws(() => loadProfileFile(numeric), /must define a non-empty "active"/);

  const array = writeTemp("profile.yaml", "active: [a]\nprofiles:\n  a:\n    name: a\n");
  assert.throws(() => loadProfileFile(array), /must define a non-empty "active"/);
});

test("throws when a patch file is not a mapping", () => {
  const file = writeTemp("patch.yaml", "- a\n- b\n");
  assert.throws(() => loadPatchFile(file), /Patch file .*patch\.yaml.*must contain a YAML mapping/);
});

test("throws when a patch file field has the wrong type", () => {
  const bundles = writeTemp("patch.yaml", "bundles: '@a'\n");
  assert.throws(() => loadPatchFile(bundles), /Patch file .*"bundles" must be an array of strings/);

  const config = writeTemp("patch.yaml", "config: [1]\n");
  assert.throws(() => loadPatchFile(config), /Patch file .*"config" must be a mapping/);
});
