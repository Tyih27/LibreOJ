import type { ImportContext, ProblemDataImporter, ProblemDataImporterRegistry } from "./importer";

import type { ProblemFileEntity } from "../problem/problem-file.entity";

/**
 * Builds the importer registry from the registered importers.
 *
 * Importers are ordered by descending priority, so `resolve` simply returns the first one that recognizes the
 * testdata. A fallback importer (e.g. the built-in one) should carry a low priority so it only wins when nothing else
 * matches.
 */
export function createProblemDataImporterRegistry(importers: ProblemDataImporter[]): ProblemDataImporterRegistry {
  const sorted = [...importers].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return {
    importers: Object.freeze(sorted),
    resolve(testData: ProblemFileEntity[], context: ImportContext): ProblemDataImporter {
      const importer = sorted.find(candidate => candidate.detect(testData, context));
      if (!importer) throw new Error("No problem data importer recognizes the given testdata");
      return importer;
    }
  };
}
