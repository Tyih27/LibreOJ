import { Logger } from "@nestjs/common";

import yaml from "js-yaml";

import { getLanguageAndOptions } from "./legacy-language-options";
import type { ImportContext, ProblemDataImporter, ProblemDataImportResult, ProblemDataSubtask } from "./importer";

import { isValidFilename } from "../common/validators";
import type { CodeLanguage } from "../code-language/code-language.type";
import type { ProblemFileEntity } from "../problem/problem-file.entity";

/**
 * The UOJ-style problem data configuration importer.
 *
 * It recognizes the config files a UOJ testdata directory may carry -- `subtasks.json` (JSON) or `data.yml` /
 * `data.yaml` (UOJ's original YAML format) -- and turns them into a complete {@link ProblemDataImportResult}:
 * subtasks, a custom checker, an interactor and extra source files. Because a configuration file is explicit, this
 * importer is authoritative: its result overrides the judge info it is merged into.
 */

/** Config filenames recognized by this importer, compared case-insensitively. */
export const PROBLEM_DATA_CONFIG_FILENAMES = ["subtasks.json", "data.yml", "data.yaml"];

interface UojConfigTestcase {
  /** An explicit testcase may carry an id so `#` templates in its filenames can be expanded. */
  caseId?: string | number;
  id?: string | number;
  inputFile?: string;
  outputFile?: string;
  userOutput?: string;
  points?: number;
  timeLimit?: number;
  memoryLimit?: number;
}

interface UojConfigSubtask {
  score?: number;
  type?: string;
  cases?: (string | number)[];
  testcases?: UojConfigTestcase[];
  timeLimit?: number;
  memoryLimit?: number;
  dependencies?: number[];
}

interface UojConfig {
  subtasks?: UojConfigSubtask[];
  inputFile?: string;
  outputFile?: string;
  userOutput?: string;
  specialJudge?: { language: string; fileName: string; interface?: string };
  interactor?: { language: string; fileName: string; interface?: "stdio" | "shm" };
  extraSourceFiles?: { language: string; files: { name: string; dest: string }[] }[];
}

function findConfigFile(testData: ProblemFileEntity[]): ProblemFileEntity | undefined {
  return testData.find(file => PROBLEM_DATA_CONFIG_FILENAMES.includes(file.filename.toLowerCase()));
}

function parseConfigFile(file: ProblemFileEntity): UojConfig {
  const { content } = file;
  if (typeof content !== "string")
    throw new Error(`Testdata file "${file.filename}" has no content to parse as a problem data config`);

  const name = file.filename.toLowerCase();
  let parsed: unknown;
  if (name.endsWith(".json")) {
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      throw new Error(`Failed to parse problem data config "${file.filename}" as JSON: ${(e as Error).message}`);
    }
  } else {
    try {
      parsed = yaml.load(content);
    } catch (e) {
      throw new Error(`Failed to parse problem data config "${file.filename}" as YAML: ${(e as Error).message}`);
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`Problem data config "${file.filename}" must be an object`);
  return parsed as UojConfig;
}

function scoringTypeOf(type: string | undefined): ProblemDataSubtask["scoringType"] {
  switch (type) {
    case undefined:
    case "sum":
      return "Sum";
    case "mul":
      return "GroupMul";
    case "min":
      return "GroupMin";
    default:
      throw new Error(`Unsupported subtask type ${JSON.stringify(type)} in problem data config`);
  }
}

/** Expands a `#` filename template with a case id, leaving it untouched when there is no template. */
function applyTemplate(template: string | undefined, caseId: string | number): string | undefined {
  return typeof template === "string" ? template.replace("#", String(caseId)) : undefined;
}

function makeTestcase(values: {
  inputFile?: string;
  outputFile?: string;
  userOutputFilename?: string;
  points?: number;
  timeLimit?: number;
  memoryLimit?: number;
}): ProblemDataSubtask["testcases"][number] {
  const testcase: ProblemDataSubtask["testcases"][number] = {
    inputFile: values.inputFile,
    outputFile: values.outputFile
  };
  if (values.userOutputFilename !== undefined) testcase.userOutputFilename = values.userOutputFilename;
  if (values.points !== undefined) testcase.points = values.points;
  if (values.timeLimit !== undefined) testcase.timeLimit = values.timeLimit;
  if (values.memoryLimit !== undefined) testcase.memoryLimit = values.memoryLimit;
  return testcase;
}

function buildSubtasks(config: UojConfig, filename: string): ProblemDataSubtask[] {
  return config.subtasks.map((subtask, index) => {
    let testcases: ProblemDataSubtask["testcases"];
    if (Array.isArray(subtask.testcases)) {
      testcases = subtask.testcases.map(testcase => {
        const caseId = testcase.caseId ?? testcase.id;
        const expand = (value: string | undefined) => (caseId != null ? applyTemplate(value, caseId) : value);
        return makeTestcase({
          inputFile: expand(testcase.inputFile),
          outputFile: expand(testcase.outputFile),
          userOutputFilename: expand(testcase.userOutput),
          points: testcase.points,
          timeLimit: testcase.timeLimit,
          memoryLimit: testcase.memoryLimit
        });
      });
    } else if (Array.isArray(subtask.cases)) {
      testcases = subtask.cases.map(caseId =>
        makeTestcase({
          inputFile: applyTemplate(config.inputFile, caseId),
          outputFile: applyTemplate(config.outputFile, caseId),
          userOutputFilename: applyTemplate(config.userOutput, caseId)
        })
      );
    } else {
      throw new Error(`Subtask ${index + 1} in "${filename}" must define "cases" or "testcases"`);
    }

    if (testcases.length === 0) throw new Error(`Subtask ${index + 1} in "${filename}" has no testcases`);

    const result: ProblemDataSubtask = { scoringType: scoringTypeOf(subtask.type), testcases };
    if (subtask.score !== undefined) result.points = subtask.score;
    if (subtask.timeLimit !== undefined) result.timeLimit = subtask.timeLimit;
    if (subtask.memoryLimit !== undefined) result.memoryLimit = subtask.memoryLimit;
    if (Array.isArray(subtask.dependencies)) result.dependencies = subtask.dependencies;
    return result;
  });
}

/**
 * Detects the special judge interface from its source when the config omits an explicit `interface`.
 *
 * Mirrors the legacy migration (`migration/migrations/problem.ts`): a C++ source that includes `testlib.h` uses the
 * `testlib` interface, anything else (or a non-C++ language) uses `legacy`. If the source content has not been loaded
 * -- e.g. the file is unreadable -- it keeps the historical default of `testlib`.
 */
function detectCheckerInterface(
  specialJudge: { language: string; fileName: string },
  testData: ProblemFileEntity[]
): string {
  const content = testData.find(file => file.filename === specialJudge.fileName)?.content;
  if (typeof content !== "string") return "testlib";
  const useTestlib = specialJudge.language.startsWith("cpp") && content.includes("testlib.h");
  return useTestlib ? "testlib" : "legacy";
}

function buildChecker(config: UojConfig, filename: string, testData: ProblemFileEntity[]) {
  const { specialJudge } = config;
  if (!specialJudge) return undefined;
  if (typeof specialJudge.fileName !== "string" || !specialJudge.fileName)
    throw new Error(`"specialJudge.fileName" must be a non-empty string in "${filename}"`);

  const iface = specialJudge.interface ?? detectCheckerInterface(specialJudge, testData);
  return {
    type: "custom" as const,
    interface: iface,
    filename: specialJudge.fileName,
    ...getLanguageAndOptions(specialJudge.language, `problem data config "${filename}"`, true, iface === "testlib")
  };
}

function buildInteractor(config: UojConfig, filename: string) {
  const { interactor } = config;
  if (!interactor)
    throw new Error(`Problem data config "${filename}" must define an "interactor" for interaction problems`);
  if (typeof interactor.fileName !== "string" || !interactor.fileName)
    throw new Error(`"interactor.fileName" must be a non-empty string in "${filename}"`);

  return {
    interface: interactor.interface ?? "stdio",
    filename: interactor.fileName,
    ...getLanguageAndOptions(interactor.language, `problem data config "${filename}"`, true, true)
  };
}

function buildExtraSourceFiles(config: UojConfig, filename: string) {
  if (!Array.isArray(config.extraSourceFiles)) return undefined;

  const result: Partial<Record<CodeLanguage, Record<string, string>>> = {};
  for (const entry of config.extraSourceFiles) {
    const { language } = getLanguageAndOptions(entry.language, `problem data config "${filename}"`) || {};
    if (!language || language in result) continue;

    const files: Record<string, string> = {};
    for (const { name, dest } of entry.files) {
      // Mirror the legacy migration: an invalid destination is skipped with a warning rather than failing the import.
      if (!isValidFilename(dest)) {
        Logger.warn(`Ignoring invalid extra source file destination ${JSON.stringify(dest)} in "${filename}"`);
        continue;
      }
      files[dest] = name;
    }
    result[language] = files;
  }
  return result;
}

function importConfig(testData: ProblemFileEntity[], context: ImportContext): ProblemDataImportResult {
  const file = findConfigFile(testData);
  if (!file) throw new Error("No problem data config file found in testdata");

  const config = parseConfigFile(file);
  if (!Array.isArray(config.subtasks) || config.subtasks.length === 0)
    throw new Error(`Problem data config "${file.filename}" must define a non-empty "subtasks" array`);

  const { problemType } = context;
  const subtasks = buildSubtasks(config, file.filename);

  // Reference validation: every filename the config points at must exist in the testdata. Whether an input / output
  // file is mandatory depends on the problem type; interaction problems have no output file, submit-answer problems
  // have no required input file.
  const present = new Set(testData.map(testDataFile => testDataFile.filename));
  const missing: string[] = [];
  const inputRequired = problemType !== "submit-answer";
  const outputRequired = problemType !== "interaction";

  subtasks.forEach((subtask, i) => {
    subtask.testcases.forEach((testcase, j) => {
      if (testcase.inputFile == null) {
        if (inputRequired)
          throw new Error(
            `Subtask ${i + 1} testcase ${j + 1} in "${
              file.filename
            }" has no input file (required for ${problemType} problems)`
          );
      } else if (!present.has(testcase.inputFile)) {
        missing.push(testcase.inputFile);
      }

      if (testcase.outputFile == null) {
        if (outputRequired)
          throw new Error(
            `Subtask ${i + 1} testcase ${j + 1} in "${
              file.filename
            }" has no output file (required for ${problemType} problems)`
          );
      } else if (!present.has(testcase.outputFile)) {
        missing.push(testcase.outputFile);
      }
    });
  });

  if (problemType === "traditional" || problemType === "submit-answer") {
    if (config.specialJudge && !present.has(config.specialJudge.fileName)) missing.push(config.specialJudge.fileName);
  }
  if (problemType === "interaction" && config.interactor && !present.has(config.interactor.fileName))
    missing.push(config.interactor.fileName);

  if (missing.length > 0)
    throw new Error(`Testdata files referenced by "${file.filename}" are missing: ${missing.join(", ")}`);

  const result: ProblemDataImportResult = { subtasks };

  if (problemType === "traditional" || problemType === "submit-answer") {
    const checker = buildChecker(config, file.filename, testData);
    if (checker) result.checker = checker;
  }
  if (problemType === "interaction") result.interactor = buildInteractor(config, file.filename);
  if (problemType === "traditional" || problemType === "interaction") {
    const extraSourceFiles = buildExtraSourceFiles(config, file.filename);
    if (extraSourceFiles) result.extraSourceFiles = extraSourceFiles;
  }

  return result;
}

export const uojConfigImporter: ProblemDataImporter = {
  name: "uoj-data-config",
  priority: 100,
  authoritative: true,
  detect(testData: ProblemFileEntity[]): boolean {
    const file = findConfigFile(testData);
    // Require readable content: without it the config cannot be parsed, and the importer must not shadow the fallback.
    return !!file && typeof file.content === "string";
  },
  import(testData: ProblemFileEntity[], context: ImportContext): ProblemDataImportResult {
    return importConfig(testData, context);
  },
  contentFilenames(testData: ProblemFileEntity[]): string[] {
    const configFile = findConfigFile(testData);
    if (!configFile || typeof configFile.content !== "string") return [];
    let config: UojConfig;
    try {
      config = parseConfigFile(configFile);
    } catch {
      // A broken config is reported by `import()`; there is nothing extra to load here.
      return [];
    }
    const { specialJudge } = config;
    if (!specialJudge || specialJudge.interface != null) return [];
    const { fileName } = specialJudge;
    return typeof fileName === "string" && testData.some(file => file.filename === fileName) ? [fileName] : [];
  }
};
