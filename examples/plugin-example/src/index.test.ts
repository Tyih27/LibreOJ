import * as assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

import { NodeResolver, PluginHost, composeLayers } from "@libreoj/plugin-core";

// The profile lives in the package root, and the resolver resolves the profile's `"."` entry from this base directory.
const baseDir = path.join(__dirname, "..");

test("loads the package through the resolver and applies the profile override", async () => {
  const host = new PluginHost({ resolver: new NodeResolver({ baseDir }) });

  try {
    await host.load(composeLayers({ profile: path.join(baseDir, "profile.example.yaml") }));

    assert.equal(host.root.get("exampleGreeting"), "hello from the profile");
  } finally {
    await host.dispose();
  }
});

test("falls back to the manifest/default greeting when the profile does not override it", async () => {
  const host = new PluginHost({ resolver: new NodeResolver({ baseDir }) });

  try {
    await host.load([{ plugins: ["."] }]);

    assert.equal(host.root.get("exampleGreeting"), "hello from libreoj-plugin-example");
  } finally {
    await host.dispose();
  }
});
