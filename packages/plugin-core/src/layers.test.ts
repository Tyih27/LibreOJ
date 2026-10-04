import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { resolveConfig, type ConfigLayer } from "./config";
import { composeLayers } from "./layers";
import { loadProfileFile } from "./profile";

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-core-layers-"));
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

function valueOf(layers: ConfigLayer[]): unknown {
  return resolveConfig(layers).plugins.find(plugin => plugin.name === "@a")?.config.value;
}

test("composes layers in dsh order: profile < home patch < first --patch < second --patch", () => {
  const profile = writeTemp(
    "profile.yaml",
    ["name: profile", "bundles: ['@a']", "config:", "  '@a':", "    value: profile", "    fromProfile: true", ""].join(
      "\n"
    )
  );
  const home = writeTemp("home.yaml", "config:\n  '@a':\n    value: home\n    fromHome: true\n");
  const first = writeTemp("first.yaml", "config:\n  '@a':\n    value: first\n    fromFirst: true\n");
  const second = writeTemp("second.yaml", "config:\n  '@a':\n    value: second\n    fromSecond: true\n");

  const config = resolveConfig(composeLayers({ profile, homePatchFile: home, patches: [first, second] })).plugins.find(
    plugin => plugin.name === "@a"
  )?.config as Record<string, unknown>;

  // The last layer wins for a shared key, while every layer's own key survives.
  assert.equal(config.value, "second");
  assert.equal(config.fromProfile, true);
  assert.equal(config.fromHome, true);
  assert.equal(config.fromFirst, true);
  assert.equal(config.fromSecond, true);
});

test("places the home patch strictly between the profile and the CLI patches", () => {
  const profile = writeTemp("profile.yaml", "name: profile\nbundles: ['@a']\nconfig:\n  '@a':\n    value: profile\n");
  const home = writeTemp("home.yaml", "config:\n  '@a':\n    value: home\n");
  const first = writeTemp("first.yaml", "config:\n  '@a':\n    value: first\n");
  const second = writeTemp("second.yaml", "config:\n  '@a':\n    value: second\n");

  assert.equal(valueOf(composeLayers({ profile })), "profile");
  assert.equal(valueOf(composeLayers({ profile, homePatchFile: home })), "home");
  assert.equal(valueOf(composeLayers({ profile, homePatchFile: home, patches: [first] })), "first");
  assert.equal(valueOf(composeLayers({ profile, homePatchFile: home, patches: [first, second] })), "second");
});

test("applies multiple --patch overlays in given order, later ones winning", () => {
  const profile = writeTemp("profile.yaml", "name: profile\nbundles: ['@a']\nconfig:\n  '@a':\n    value: profile\n");
  const first = writeTemp("first.yaml", "config:\n  '@a':\n    value: first\n");
  const second = writeTemp("second.yaml", "config:\n  '@a':\n    value: second\n");

  assert.equal(valueOf(composeLayers({ profile, patches: [first, second] })), "second");
  assert.equal(valueOf(composeLayers({ profile, patches: [second, first] })), "first");
});

test("returns exactly the profile layers when no home patch or patches are given", () => {
  const profile = writeTemp("profile.yaml", "name: profile\nbundles: ['@a']\nconfig:\n  '@a':\n    value: profile\n");

  assert.deepEqual(composeLayers({ profile }), loadProfileFile(path.resolve(profile)));
});
