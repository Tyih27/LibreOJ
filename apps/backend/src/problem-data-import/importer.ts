import type { ProblemFileEntity } from "../problem/problem-file.entity";
import type { Checker } from "../problem-type/common/checker";
import type { CodeLanguage } from "../code-language/code-language.type";

/**
 * A subtask produced by a data importer.
 *
 * This mirrors the shape the problem types store in `judgeInfo.subtasks`; keeping it here lets importers be written
 * (and tested) without depending on the per-type judge info interfaces. Subtask handling itself stays bound to the
 * problem types -- only the recognition/parsing of a testdata layout is pluggable.
 */
export interface ProblemDataSubtask {
  scoringType: "Sum" | "GroupMin" | "GroupMul";

  /** The weight of this subtask in the problem, when the source layout provides one. */
  points?: number;
  /** The default time / memory limit of this subtask, when the source layout provides one. */
  timeLimit?: number;
  memoryLimit?: number;
  /** The IDs of subtasks this subtask depends on, when the source layout provides them. */
  dependencies?: number[];

  testcases: {
    inputFile?: string;
    outputFile: string;

    points?: number;
    timeLimit?: number;
    memoryLimit?: number;
    userOutputFilename?: string;
  }[];
}

/**
 * What a data importer produces.
 *
 * Only the fields a particular problem type understands should be returned: a traditional (or submit-answer) importer
 * yields `subtasks` / `checker`, an interaction importer yields `subtasks` / `interactor`, and `extraSourceFiles` is
 * shared by traditional and interaction.
 */
export interface ProblemDataImportResult {
  subtasks?: ProblemDataSubtask[];
  /** A custom checker discovered in a configuration file (traditional / submit-answer problems). */
  checker?: Checker;
  /** An interactor discovered in a configuration file (interaction problems). */
  interactor?: {
    interface: "stdio" | "shm";
    filename: string;
    language: CodeLanguage;
    compileAndRunOptions: unknown;
  };
  /** Extra source files discovered in a configuration file, grouped by language then destination filename. */
  extraSourceFiles?: Partial<Record<CodeLanguage, Record<string, string>>>;
}

/** How the testdata files should be paired. */
export interface ImportContext {
  /** Pair inputs to outputs, or outputs to inputs. */
  mode: "input-to-output" | "output-to-input";
  /** Whether a missing counterpart file is tolerated (the corresponding filename is then left undefined). */
  optional: boolean;
  /** The problem type the testdata belongs to; importers use it to emit only the fields that type understands. */
  problemType: "traditional" | "interaction" | "submit-answer";
}

/**
 * Recognizes one testdata layout and turns it into a {@link ProblemDataImportResult}.
 *
 * A provider registers its importers under the `problemDataImporters` seam; when a problem's subtasks are auto-detected
 * the registry picks the matching importer instead of the logic being hard-coded per problem type.
 */
export interface ProblemDataImporter {
  /** A stable identifier, e.g. `"libreoj-native"`. */
  readonly name: string;
  /** Higher priority wins when several importers match. The fallback uses a negative priority. */
  readonly priority?: number;
  /**
   * Whether this importer's result is authoritative (i.e. derived from an explicit configuration file) and therefore
   * overrides the judge info it is merged into. A non-authoritative importer only fills in what the judge info leaves
   * unspecified.
   */
  readonly authoritative?: boolean;
  /** Whether this importer understands the given testdata (and pairing mode). */
  detect(testData: ProblemFileEntity[], context: ImportContext): boolean;
  /** Parses the testdata into a result. Only called when {@link detect} returned true. */
  import(testData: ProblemFileEntity[], context: ImportContext): ProblemDataImportResult;
}

/** The registry of available importers. */
export interface ProblemDataImporterRegistry {
  readonly importers: readonly ProblemDataImporter[];
  /** Returns the highest-priority importer that recognizes the testdata; throws when none does. */
  resolve(testData: ProblemFileEntity[], context: ImportContext): ProblemDataImporter;
}
