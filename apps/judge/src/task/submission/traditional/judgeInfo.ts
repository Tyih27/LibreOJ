import objectHash from "object-hash";

import { SubmissionTask, ProblemSample } from "..";
import { Checker, getCheckerMeta } from "../../../checkers";
import { hashData } from "../../../utils";
import { getFile } from "../../../plugin/services";

import { ExtraParametersTraditional, SubmissionContentTraditional, TestcaseResultTraditional } from ".";
import { validateJudgeInfoSubtasks, validateJudgeInfoExtraSourceFiles } from "../common";

export interface TestcaseConfig {
  inputFile?: string;
  outputFile?: string;

  // If one of these is null,
  // the one's default of the subtask if exists, or of problem is used
  timeLimit?: number;
  memoryLimit?: number;

  // The weight of this testcase in the subtask,
  // which should add up to 100 for all testcases of this subtask
  // Auto if not set
  points?: number;
}

export interface JudgeInfoTraditional {
  /*
   * The default time / memory limit
   * One is ignored in a subtask if the it defined its own default
   */
  timeLimit?: number;
  memoryLimit?: number;

  /*
   * The maximum size (in MiB) of a testcase's output.
   * If not set, the global limit configured on the judge is used.
   */
  outputLimit?: number;

  /*
   * Be null if not using file IO
   */
  fileIo?: {
    inputFilename: string;
    outputFilename: string;
  };

  /*
   * If ture, samples in statement will be run before all subtasks
   * If a submission failed on samples, all subtasks will be skipped
   */
  runSamples?: boolean;

  /*
   * There could be multiple subtasks in a problem
   * Each subtask contains some testcases
   */
  subtasks: {
    /*
     * The default time / memory limit
     * One is ignored in a testcase if the it defined its own default
     */
    timeLimit?: number;
    memoryLimit?: number;

    testcases: TestcaseConfig[];

    // Refer to https://cms.readthedocs.io/en/v1.4/Task%20types.html
    scoringType: "Sum" | "GroupMin" | "GroupMul";

    // The weight of this subtask in the problem,
    // which should add up to 100 for all subtasks of this problem
    // Auto if not set
    points?: number;

    // The IDs of subtasks this subtask depends
    // A subtask will be skipped if one of it dependencies fails
    dependencies?: number[];
  }[];

  checker: Checker;

  // The map of files to be copied to the source code directory when compileing for each code language
  extraSourceFiles?: Partial<Record<string, Record<string, string>>>;

  // UOJ-style gate tests run after all subtasks only when the submission is otherwise fully accepted;
  // derived from testdata, uses the problem defaults for time/memory.
  extraTests?: TestcaseConfig[];
}

/* eslint-disable no-throw-literal */
export async function validateJudgeInfo(
  task: SubmissionTask<
    JudgeInfoTraditional,
    SubmissionContentTraditional,
    TestcaseResultTraditional,
    ExtraParametersTraditional
  >
): Promise<void> {
  const { judgeInfo, testData } = task.extraInfo;

  validateJudgeInfoSubtasks(judgeInfo, testData);

  if (judgeInfo.extraTests) {
    judgeInfo.extraTests.forEach(({ inputFile, outputFile }, i) => {
      if (!(inputFile in testData)) throw `Input file ${inputFile} referenced by extra test ${i + 1} doesn't exist.`;
      if (!(outputFile in testData)) throw `Output file ${outputFile} referenced by extra test ${i + 1} doesn't exist.`;
    });
  }

  if (judgeInfo.checker.type === "custom" && !(judgeInfo.checker.filename in testData))
    throw `Custom checker ${judgeInfo.checker.filename} doesn't exist.`;

  validateJudgeInfoExtraSourceFiles(judgeInfo, testData);
}
/* eslint-enable no-throw-literal */

export async function hashSampleTestcase(
  judgeInfo: JudgeInfoTraditional,
  sample: ProblemSample,
  [compileResult, customCheckerCompileResult]: ExtraParametersTraditional
) {
  const [inputDataHash, outputDataHash] = await Promise.all([hashData(sample.inputData), hashData(sample.outputData)]);

  return objectHash({
    fileIo: judgeInfo.fileIo,
    checkerMeta: getCheckerMeta(judgeInfo),
    inputDataHash,
    outputDataHash,
    timeLimit: judgeInfo.timeLimit,
    memoryLimit: judgeInfo.memoryLimit,
    ...(judgeInfo.outputLimit != null ? { outputLimit: judgeInfo.outputLimit } : {}),
    compileTaskHash: compileResult.compileTaskHash,
    customCheckerCompileTaskHash: customCheckerCompileResult?.compileTaskHash
  });
}

export async function hashTestcase(
  judgeInfo: JudgeInfoTraditional,
  subtaskIndex: number,
  testcaseIndex: number,
  testData: Record<string, string>,
  [compileResult, customCheckerCompileResult]: ExtraParametersTraditional
) {
  const testcase = judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex];

  const [inputDataHash, outputDataHash] = await Promise.all([
    getFile().getFileHash(testData[testcase.inputFile]),
    getFile().getFileHash(testData[testcase.outputFile])
  ]);

  return objectHash({
    fileIo: judgeInfo.fileIo,
    checkerMeta: getCheckerMeta(judgeInfo),
    inputDataHash,
    outputDataHash,
    timeLimit: testcase.timeLimit || judgeInfo.subtasks[subtaskIndex].timeLimit || judgeInfo.timeLimit,
    memoryLimit: testcase.memoryLimit || judgeInfo.subtasks[subtaskIndex].memoryLimit || judgeInfo.memoryLimit,
    ...(judgeInfo.outputLimit != null ? { outputLimit: judgeInfo.outputLimit } : {}),
    compileTaskHash: compileResult.compileTaskHash,
    customCheckerCompileTaskHash: customCheckerCompileResult?.compileTaskHash
  });
}

export async function hashExtraTestcase(
  judgeInfo: JudgeInfoTraditional,
  extraTestIndex: number,
  testData: Record<string, string>,
  [compileResult, customCheckerCompileResult]: ExtraParametersTraditional
) {
  const testcase = judgeInfo.extraTests[extraTestIndex];

  const [inputDataHash, outputDataHash] = await Promise.all([
    getFile().getFileHash(testData[testcase.inputFile]),
    getFile().getFileHash(testData[testcase.outputFile])
  ]);

  return objectHash({
    fileIo: judgeInfo.fileIo,
    checkerMeta: getCheckerMeta(judgeInfo),
    inputDataHash,
    outputDataHash,
    timeLimit: testcase.timeLimit || judgeInfo.timeLimit,
    memoryLimit: testcase.memoryLimit || judgeInfo.memoryLimit,
    ...(judgeInfo.outputLimit != null ? { outputLimit: judgeInfo.outputLimit } : {}),
    compileTaskHash: compileResult.compileTaskHash,
    customCheckerCompileTaskHash: customCheckerCompileResult?.compileTaskHash
  });
}
