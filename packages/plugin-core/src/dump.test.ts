import { test } from "node:test";
import * as assert from "node:assert/strict";
import { load } from "js-yaml";
import { dumpConfig, resolveConfig } from "./index";

test("serializes the resolved plugin tree to stable, readable YAML", () => {
  const resolved = resolveConfig([
    {
      bundles: ["@libreoj/http-nest", "@libreoj/legacy"],
      plugins: ["@libreoj/local"],
      config: {
        "@libreoj/http-nest": { port: 8080, cors: { origins: ["a", "b"] } },
        "@libreoj/legacy": {}
      }
    },
    {
      patch: { "@libreoj/legacy": { disabled: true } }
    }
  ]);

  const expected = [
    "plugins:",
    "  - name: '@libreoj/http-nest'",
    "    source: bundles",
    "    disabled: false",
    "    config:",
    "      cors:",
    "        origins:",
    "          - a",
    "          - b",
    "      port: 8080",
    "  - name: '@libreoj/legacy'",
    "    source: bundles",
    "    disabled: true",
    "    config: {}",
    "  - name: '@libreoj/local'",
    "    source: plugins",
    "    disabled: false",
    "    config: {}",
    "warnings: []",
    ""
  ].join("\n");

  assert.equal(dumpConfig(resolved), expected);
});

test("dumps disabled entries with their flag and sorted config keys", () => {
  const resolved = resolveConfig([{ bundles: ["@z"] }, { patch: { "@z": { disabled: true, beta: 2, alpha: 1 } } }]);

  const expected = [
    "plugins:",
    "  - name: '@z'",
    "    source: bundles",
    "    disabled: true",
    "    config:",
    "      alpha: 1",
    "      beta: 2",
    "warnings: []",
    ""
  ].join("\n");

  assert.equal(dumpConfig(resolved), expected);
});

test("serializes an empty resolved config", () => {
  assert.equal(dumpConfig(resolveConfig([])), "plugins: []\nwarnings: []\n");
});

test("surfaces resolver warnings in the dumped document", () => {
  const resolved = resolveConfig([{ name: "base", bundles: ["@a"], config: { "@ghost": { x: 1 } } }]);

  const parsed = load(dumpConfig(resolved)) as { warnings: string[] };
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /@ghost/);

  // Warnings are emitted deterministically alongside the plugin tree.
  assert.equal(dumpConfig(resolved), dumpConfig(resolved));
});

test("output is stable across repeated dumps", () => {
  const resolved = resolveConfig([{ bundles: ["@a", "@b"], config: { "@a": { z: 1, a: { y: 2, x: 3 } } } }]);

  assert.equal(dumpConfig(resolved), dumpConfig(resolved));
});

test("dump output parses back into the resolved structure", () => {
  const resolved = resolveConfig([
    { bundles: ["@a"], plugins: ["@b"], config: { "@a": { list: [1, 2], nested: { on: true } } } }
  ]);

  const parsed = load(dumpConfig(resolved)) as {
    plugins: { name: string; source: string; disabled: boolean; config: Record<string, unknown> }[];
  };

  assert.deepEqual(parsed.plugins, [
    { name: "@a", source: "bundles", disabled: false, config: { list: [1, 2], nested: { on: true } } },
    { name: "@b", source: "plugins", disabled: false, config: {} }
  ]);
});
