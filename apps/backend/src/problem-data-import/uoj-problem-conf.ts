import type { ProblemDataImporter, ProblemDataImportResult, ProblemDataSubtask } from "./importer";

import { TESTLIB_CHECKER_NAMES } from "../problem-type/common/checker";
import type { ProblemFileEntity } from "../problem/problem-file.entity";
import type { ProblemSampleData } from "../problem/problem-sample-data.interface";

/**
 * The UOJ `problem.conf` importer.
 *
 * A UOJ testdata directory carries a `problem.conf` holding one `key value` pair per line. It drives a fully
 * data-driven judge: the test file names are templated from `input_pre` / `input_suf` (and the output counterparts),
 * the limits are the problem defaults, the checker is one of UOJ's built-in testlib checkers, and optional
 * `n_subtasks` / `subtask_end_i` / `subtask_score_i` split the tests into scored subtasks. Because the file is
 * explicit, this importer is authoritative: its result overrides the judge info it is merged into.
 *
 * It is registered ahead of the older UOJ data config importer so a directory that happens to carry both a
 * `problem.conf` and a `data.yml` / `subtasks.json` is read as a `problem.conf` problem.
 */

/** The configuration filename recognized by this importer, compared case-insensitively. */
export const UOJ_PROBLEM_CONF_FILENAME = "problem.conf";

/** The prefix marking the extra tests (UOJ's `ex_*` files); the first `n_sample_tests` of them are the samples. */
export const UOJ_EXTRA_TEST_PREFIX = "ex_";

/**
 * Keys that turn a `problem.conf` into a problem type this importer does not handle yet. They are rejected explicitly
 * rather than silently imported as a traditional problem.
 */
const UNSUPPORTED_INTERACTION_KEYS = ["interaction_mode", "interactor"];

function findConfFile(testData: ProblemFileEntity[]): ProblemFileEntity | undefined {
  return testData.find(file => file.filename.toLowerCase() === UOJ_PROBLEM_CONF_FILENAME);
}

/**
 * Parses the `problem.conf` `key value` line format. Values are single whitespace-delimited tokens, matching UOJ's
 * reader. Pure: it works on the content and the filename only for error reporting, so importers and the sample
 * builder share it without touching the filesystem or an entity.
 */
export function parseProblemConfContent(content: string, filename: string): Record<string, string> {
  const conf: Record<string, string> = {};
  content.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;

    const parts = line.split(/\s+/);
    if (parts.length < 2)
      throw new Error(`Malformed line ${index + 1} in "${filename}": expected "key value", got ${JSON.stringify(raw)}`);

    const [key, value] = parts;
    if (key in conf) throw new Error(`Duplicate key ${JSON.stringify(key)} in "${filename}"`);
    conf[key] = value;
  });
  return conf;
}

/** Parses a `problem.conf` entity, requiring its content to have been loaded. */
function parseProblemConf(file: ProblemFileEntity): Record<string, string> {
  const { content } = file;
  if (typeof content !== "string")
    throw new Error(`Testdata file "${file.filename}" has no content to parse as a UOJ problem.conf`);
  return parseProblemConfContent(content, file.filename);
}

function readInt(conf: Record<string, string>, key: string, filename: string, defaultValue?: number): number {
  const raw = conf[key];
  if (raw === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`"${key}" is required in "${filename}"`);
  }
  if (!/^\d+$/.test(raw))
    throw new Error(`"${key}" must be a non-negative integer in "${filename}" (got ${JSON.stringify(raw)})`);
  return Number(raw);
}

function readNumber(conf: Record<string, string>, key: string, filename: string): number | undefined {
  const raw = conf[key];
  if (raw === undefined) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error(`"${key}" must be a number in "${filename}" (got ${JSON.stringify(raw)})`);
  return value;
}

/** The UOJ subtask type names, mirroring the UOJ data config importer. */
function scoringTypeOf(type: string | undefined, filename: string): ProblemDataSubtask["scoringType"] {
  switch (type) {
    case undefined:
    case "sum":
      return "Sum";
    case "mul":
      return "GroupMul";
    case "min":
      return "GroupMin";
    default:
      throw new Error(`Unsupported subtask type ${JSON.stringify(type)} in "${filename}"`);
  }
}

type Testcase = ProblemDataSubtask["testcases"][number];

function buildSubtasks(
  conf: Record<string, string>,
  filename: string,
  nTests: number,
  testcaseOf: (num: number) => Testcase
): ProblemDataSubtask[] {
  if (!("n_subtasks" in conf))
    return [{ scoringType: "Sum", testcases: Array.from({ length: nTests }, (_, i) => testcaseOf(i + 1)) }];

  const nSubtasks = readInt(conf, "n_subtasks", filename);
  if (nSubtasks <= 0) throw new Error(`"n_subtasks" must be a positive integer in "${filename}"`);

  const subtasks: ProblemDataSubtask[] = [];
  let previousEnd = 0;
  let totalPoints = 0;

  for (let i = 1; i <= nSubtasks; i++) {
    const end = readInt(conf, `subtask_end_${i}`, filename);
    const score = readInt(conf, `subtask_score_${i}`, filename);
    if (end <= previousEnd || end > nTests)
      throw new Error(
        `"subtask_end_${i}" (${end}) must be greater than ${previousEnd} and at most "n_tests" (${nTests}) in "${filename}"`
      );

    const testcases: Testcase[] = [];
    for (let num = previousEnd + 1; num <= end; num++) testcases.push(testcaseOf(num));
    totalPoints += score;

    subtasks.push({ scoringType: scoringTypeOf(conf[`subtask_type_${i}`], filename), points: score, testcases });
    previousEnd = end;
  }

  if (totalPoints > 100) throw new Error(`Subtask scores in "${filename}" add up to ${totalPoints}, which exceeds 100`);
  return subtasks;
}

/** The input/output filename templates a `problem.conf` points at, with UOJ's `input`/`output` + `txt` defaults. */
interface TestFilenameTemplates {
  input: (num: number) => string;
  output: (num: number) => string;
}

function testFilenameTemplates(conf: Record<string, string>): TestFilenameTemplates {
  const inputPre = conf.input_pre ?? "input";
  const inputSuf = conf.input_suf ?? "txt";
  const outputPre = conf.output_pre ?? "output";
  const outputSuf = conf.output_suf ?? "txt";
  return {
    input: (num: number) => `${inputPre}${num}.${inputSuf}`,
    output: (num: number) => `${outputPre}${num}.${outputSuf}`
  };
}

function importProblemConf(testData: ProblemFileEntity[]): ProblemDataImportResult {
  const file = findConfFile(testData);
  if (!file) throw new Error("No problem.conf found in testdata");

  const { filename } = file;
  const conf = parseProblemConf(file);

  for (const key of UNSUPPORTED_INTERACTION_KEYS)
    if (key in conf) throw new Error(`Interaction problems are not supported yet: "${key}" found in "${filename}"`);

  const builtinJudger = conf.use_builtin_judger;
  if (builtinJudger !== "on")
    throw new Error(
      `Only "use_builtin_judger on" is supported in "${filename}" (got ${JSON.stringify(builtinJudger ?? "(absent)")})`
    );

  const checkerName = conf.use_builtin_checker;
  if (checkerName === undefined)
    throw new Error(`Custom checkers are not supported yet: "${filename}" must set "use_builtin_checker"`);
  if (!TESTLIB_CHECKER_NAMES.includes(checkerName))
    throw new Error(`Unsupported builtin checker ${JSON.stringify(checkerName)} in "${filename}"`);

  const nTests = readInt(conf, "n_tests", filename, 10);
  if (nTests <= 0) throw new Error(`"n_tests" must be a positive integer in "${filename}"`);

  const { input: inputFilename, output: outputFilename } = testFilenameTemplates(conf);
  const testcaseOf = (num: number): Testcase => ({ inputFile: inputFilename(num), outputFile: outputFilename(num) });

  // Reference validation: every test the config points at must exist in the testdata. The extra (sample) tests are
  // checked for existence but are not turned into testcases here -- that is left to a later stage.
  const present = new Set(testData.map(testDataFile => testDataFile.filename));
  const missing: string[] = [];
  const requireFile = (name: string) => {
    if (!present.has(name)) missing.push(name);
  };

  for (let num = 1; num <= nTests; num++) {
    requireFile(inputFilename(num));
    requireFile(outputFilename(num));
  }

  const nExTests = readInt(conf, "n_ex_tests", filename, 0);
  for (let num = 1; num <= nExTests; num++) {
    requireFile(`${UOJ_EXTRA_TEST_PREFIX}${inputFilename(num)}`);
    requireFile(`${UOJ_EXTRA_TEST_PREFIX}${outputFilename(num)}`);
  }

  const nSampleTests = readInt(conf, "n_sample_tests", filename, 0);
  if (nSampleTests > nExTests)
    throw new Error(`"n_sample_tests" (${nSampleTests}) must not exceed "n_ex_tests" (${nExTests}) in "${filename}"`);

  const subtasks = buildSubtasks(conf, filename, nTests, testcaseOf);

  if (missing.length > 0)
    throw new Error(`Testdata files referenced by "${filename}" are missing: ${missing.join(", ")}`);

  const result: ProblemDataImportResult = { subtasks, checker: { type: "testlib", name: checkerName } };

  const timeLimitSeconds = readNumber(conf, "time_limit", filename);
  if (timeLimitSeconds !== undefined) result.timeLimit = Math.round(timeLimitSeconds * 1000);
  const memoryLimit = readNumber(conf, "memory_limit", filename);
  if (memoryLimit !== undefined) result.memoryLimit = memoryLimit;
  const outputLimit = readNumber(conf, "output_limit", filename);
  if (outputLimit !== undefined) result.outputLimit = outputLimit;

  return result;
}

/**
 * Builds the sample test cases of a UOJ `problem.conf` problem.
 *
 * UOJ keeps sample tests alongside the regular tests as extra tests named with an {@link UOJ_EXTRA_TEST_PREFIX} prefix:
 * `ex_<input_pre><i>.<input_suf>` / `ex_<output_pre><i>.<output_suf>`. The first `n_sample_tests` extra tests are the
 * samples. Content is read through the supplied callback (`undefined` means "not present"); a sample whose input or
 * output is missing is skipped rather than failing the whole import. The returned array preserves the extra-test order.
 *
 * Pure: this never touches the filesystem or an entity, so it can be unit-tested against a plain map of file contents.
 *
 * @throws If `n_sample_tests` exceeds `n_ex_tests` (a sample must be one of the extra tests). Callers treat a thrown
 * error as non-fatal -- the sample import is best-effort and must not break the testdata import.
 */
export function buildUojSamples(
  confContent: string,
  readFileContent: (filename: string) => string | undefined
): ProblemSampleData {
  const conf = parseProblemConfContent(confContent, UOJ_PROBLEM_CONF_FILENAME);

  const nExTests = readInt(conf, "n_ex_tests", UOJ_PROBLEM_CONF_FILENAME, 0);
  const nSampleTests = readInt(conf, "n_sample_tests", UOJ_PROBLEM_CONF_FILENAME, 0);
  if (nSampleTests > nExTests)
    throw new Error(`"n_sample_tests" (${nSampleTests}) must not exceed "n_ex_tests" (${nExTests})`);

  const { input, output } = testFilenameTemplates(conf);
  const samples: ProblemSampleData = [];
  for (let num = 1; num <= nSampleTests; num++) {
    const inputData = readFileContent(`${UOJ_EXTRA_TEST_PREFIX}${input(num)}`);
    const outputData = readFileContent(`${UOJ_EXTRA_TEST_PREFIX}${output(num)}`);
    if (inputData === undefined || outputData === undefined) continue;
    samples.push({ inputData, outputData });
  }
  return samples;
}

export const uojProblemConfImporter: ProblemDataImporter = {
  name: "uoj-problem-conf",
  priority: 200,
  authoritative: true,
  detect(testData: ProblemFileEntity[]): boolean {
    return !!findConfFile(testData);
  },
  import(testData: ProblemFileEntity[]): ProblemDataImportResult {
    return importProblemConf(testData);
  },
  contentFilenames(testData: ProblemFileEntity[]): string[] {
    const confFile = findConfFile(testData);
    return confFile ? [confFile.filename] : [];
  }
};
