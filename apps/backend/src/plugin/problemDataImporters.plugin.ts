import { Logger } from "@nestjs/common";

import type { PluginDefinition } from "@libreoj/plugin-core";

import { PROBLEM_DATA_IMPORTERS } from "./seam";

import { nativeImporter } from "../problem-data-import/native";
import { polygonImporter } from "../problem-data-import/polygon";
import { createProblemDataImporterRegistry } from "../problem-data-import/registry";
import { uojConfigImporter } from "../problem-data-import/uoj-config";
import { uojProblemConfImporter } from "../problem-data-import/uoj-problem-conf";

/**
 * The plugin that provides the problem data importer registry.
 *
 * Applying it publishes a registry holding the built-in importer, which reproduces the historical auto-match behaviour,
 * the UOJ `problem.conf` importer and the UOJ data config importer; format-specific importers are added by extending
 * the list (each one its own plugin/registration). Consumers resolve the registry through `getProblemDataImporters()`.
 */
export const problemDataImportersPlugin: PluginDefinition = {
  name: "@libreoj/backend-problem-data-import",
  provide: [PROBLEM_DATA_IMPORTERS],
  apply(ctx) {
    ctx.set(
      PROBLEM_DATA_IMPORTERS,
      createProblemDataImporterRegistry([uojProblemConfImporter, uojConfigImporter, polygonImporter, nativeImporter])
    );
    Logger.log(
      "problem data importers registered: uoj-problem-conf, uoj-data-config, codeforces-polygon, libreoj-native",
      "Bootstrap"
    );
  }
};
