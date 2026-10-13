import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { composeLayers, resolveConfig } from "@libreoj/plugin-core";

/** `apps/backend/test` -> the profile shipped at the repository root. */
const PROFILE = path.resolve(__dirname, "../../../profiles/backend.yaml");

test("backend profile lists the bundles in load order", () => {
  const { plugins, warnings } = resolveConfig(composeLayers({ profile: PROFILE }));

  assert.deepEqual(warnings, []);
  assert.deepEqual(
    plugins.map(plugin => plugin.name),
    [
      "@libreoj/backend-domain-modules",
      "@libreoj/plugin-http-nest",
      "@libreoj/backend-infra",
      "@libreoj/backend-problem-data-import",
      "@libreoj/plugin-code-language",
      "@libreoj/backend-domain-homepage",
      "@libreoj/backend-domain-audit",
      "@libreoj/backend-domain-file",
      "@libreoj/backend-domain-mail",
      "@libreoj/backend-domain-metrics",
      "@libreoj/backend-domain-settings",
      "@libreoj/backend-domain-cluster",
      "@libreoj/backend-domain-config",
      "@libreoj/backend-domain-cors",
      "@libreoj/backend-domain-event-report",
      "@libreoj/backend-domain-localized-content",
      "@libreoj/backend-domain-permission",
      "@libreoj/backend-domain-group",
      "@libreoj/backend-problem-type-registry",
      "@libreoj/backend-domain-problem-type"
    ]
  );
});
