import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { composeLayers, resolveConfig } from "@libreoj/plugin-core";

import { BACKEND_BUNDLE_NAMES } from "../src/plugin/bundles";

/** `apps/backend/test` -> the profile shipped at the repository root. */
const PROFILE = path.resolve(__dirname, "../../../profiles/backend.yaml");

// `resolveConfig` never resolves a bundle to a plugin definition, so a name the resolver does not know is only caught
// later, at `host.load`, where it aborts boot. This test closes the profile side of that gap; the definition side is
// enforced by the `Record<BackendBundleName, PluginDefinition>` annotation in `main.ts`, which `check-types` validates.
test("the backend profile lists exactly the declared bundles, in load order", () => {
  const { plugins, warnings } = resolveConfig(composeLayers({ profile: PROFILE }));

  assert.deepEqual(warnings, []);
  assert.deepEqual(
    plugins.map(plugin => plugin.name),
    [...BACKEND_BUNDLE_NAMES]
  );

  // A repeated name would be silently collapsed by the profile's first-occurrence dedupe.
  assert.equal(new Set(BACKEND_BUNDLE_NAMES).size, BACKEND_BUNDLE_NAMES.length, "duplicate bundle name");
});
