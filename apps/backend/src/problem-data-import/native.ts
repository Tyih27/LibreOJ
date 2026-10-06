import type { ProblemDataImporter } from "./importer";

import type { ProblemFileEntity } from "../problem/problem-file.entity";
import { autoMatchInputToOutput, autoMatchOutputToInput } from "../problem-type/common/auto-match-input-output";

/**
 * The built-in importer. It wraps the historical {@link autoMatchInputToOutput} / {@link autoMatchOutputToInput}
 * behaviour byte for byte, so auto-detection produces exactly what it did before importers became pluggable.
 *
 * It always matches and carries the lowest priority, making it the fallback when no format-specific importer
 * recognizes the testdata.
 */
export const nativeImporter: ProblemDataImporter = {
  name: "libreoj-native",
  priority: -1000,
  detect(): boolean {
    return true;
  },
  import(testData: ProblemFileEntity[], context): ReturnType<ProblemDataImporter["import"]> {
    return context.mode === "output-to-input"
      ? autoMatchOutputToInput(testData, context.optional)
      : autoMatchInputToOutput(testData, context.optional);
  }
};
