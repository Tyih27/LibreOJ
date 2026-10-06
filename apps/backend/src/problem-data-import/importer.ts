import type { ProblemFileEntity } from "../problem/problem-file.entity";

/**
 * A subtask produced by a data importer.
 *
 * This mirrors the shape the problem types store in `judgeInfo.subtasks`; keeping it here lets importers be written
 * (and tested) without depending on the per-type judge info interfaces. Subtask handling itself stays bound to the
 * problem types -- only the recognition/parsing of a testdata layout is pluggable.
 */
export interface ProblemDataSubtask {
  scoringType: "Sum" | "GroupMin" | "GroupMul";
  testcases: {
    inputFile: string;
    outputFile: string;
  }[];
}

/** How the testdata files should be paired. */
export interface ImportContext {
  /** Pair inputs to outputs, or outputs to inputs. */
  mode: "input-to-output" | "output-to-input";
  /** Whether a missing counterpart file is tolerated (the corresponding filename is then left undefined). */
  optional: boolean;
}

/**
 * Recognizes one testdata layout and turns it into subtasks.
 *
 * A provider registers its importers under the `problemDataImporters` seam; when a problem's subtasks are auto-detected
 * the registry picks the matching importer instead of the logic being hard-coded per problem type.
 */
export interface ProblemDataImporter {
  /** A stable identifier, e.g. `"libreoj-native"`. */
  readonly name: string;
  /** Higher priority wins when several importers match. The fallback uses a negative priority. */
  readonly priority?: number;
  /** Whether this importer understands the given testdata (and pairing mode). */
  detect(testData: ProblemFileEntity[], context: ImportContext): boolean;
  /** Parses the testdata into subtasks. Only called when {@link detect} returned true. */
  import(testData: ProblemFileEntity[], context: ImportContext): ProblemDataSubtask[];
}

/** The registry of available importers. */
export interface ProblemDataImporterRegistry {
  readonly importers: readonly ProblemDataImporter[];
  /** Returns the highest-priority importer that recognizes the testdata; throws when none does. */
  resolve(testData: ProblemFileEntity[], context: ImportContext): ProblemDataImporter;
}
