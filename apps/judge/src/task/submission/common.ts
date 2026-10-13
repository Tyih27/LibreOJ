import toposort from "toposort";
import winston from "winston";

import { Disposer } from "../../posixUtils";
import { getTaskQueue } from "../../plugin/services";

import { SubmissionTask, ProblemSample, SubmissionStatus } from ".";

// UOJ's ordinary_test() forces tot_score to 100 when every normal test passes, then
// subtracts a -3 penalty for a failing extra test, leaving 97. It is only reached
// when the base score was a full 100.
const EXTRA_TEST_FAILURE_SCORE = 97;

interface TestcaseConfigCommon {
  timeLimit?: number;
  memoryLimit?: number;
  inputFile?: string;
  outputFile?: string;
  points?: number;
}

interface JudgeInfoCommon<TestcaseConfig extends TestcaseConfigCommon> {
  runSamples?: boolean;
  timeLimit?: number;
  memoryLimit?: number;
  subtasks: {
    timeLimit?: number;
    memoryLimit?: number;
    testcases: TestcaseConfig[];
    scoringType: "Sum" | "GroupMin" | "GroupMul";
    points?: number;
    dependencies?: number[];
  }[];
  extraTests?: TestcaseConfigCommon[];
}

interface SubmissionContentCommon {
  skipSamples?: boolean;
}

interface TestcaseResultCommon {
  status: string;
  score: number;
}

function getSubtaskOrder(judgeInfo: JudgeInfoCommon<TestcaseConfigCommon>) {
  return toposort.array(
    [...judgeInfo.subtasks.keys()],
    judgeInfo.subtasks.reduce<[number, number][]>(
      (edges, subtask, i) => edges.concat((subtask.dependencies || []).map(dependency => [dependency, i])),
      []
    )
  );
}

export async function runCommonTask<
  JudgeInfo extends JudgeInfoCommon<TestcaseConfig>,
  TestcaseConfig extends TestcaseConfigCommon,
  SubmissionContent extends SubmissionContentCommon,
  TestcaseResult extends TestcaseResultCommon,
  ExtraParameters
>({
  task,
  extraParameters,
  onTestcase
}: {
  task: SubmissionTask<JudgeInfo, SubmissionContent, TestcaseResult, ExtraParameters>;
  extraParameters: ExtraParameters;
  onTestcase: (
    task: SubmissionTask<JudgeInfo, SubmissionContent, TestcaseResult, ExtraParameters>,
    judgeInfo: JudgeInfo,
    sampleId: number,
    sample: ProblemSample,
    subtaskIndex: number,
    testcaseIndex: number,
    testcase: TestcaseConfig,
    extraParameters: ExtraParameters,
    taskWorkingDirectory: string,
    disposer?: Disposer
  ) => Promise<TestcaseResult>;
}) {
  const { judgeInfo } = task.extraInfo;

  const { samples } = task.extraInfo;

  const sumSpecfiedPercentagePointsForSubtasks = judgeInfo.subtasks
    .map(testcase => testcase.points)
    .filter(x => x != null)
    .reduce((s, x) => s + x, 0);
  const countUnspecfiedPercentagePointsForSubtasks = judgeInfo.subtasks.filter(
    testcase => testcase.points == null
  ).length;
  const defaultPercentagePointsForSubtasks =
    (100 - sumSpecfiedPercentagePointsForSubtasks) / countUnspecfiedPercentagePointsForSubtasks;

  const subtaskFullScores = judgeInfo.subtasks.map(subtask =>
    subtask.points != null ? subtask.points : defaultPercentagePointsForSubtasks
  );

  const runSamples = !!(
    judgeInfo.runSamples &&
    task.extraInfo.samples &&
    !task.extraInfo.submissionContent.skipSamples
  );
  task.events.startedRunning(runSamples && samples.length, subtaskFullScores, judgeInfo.extraTests?.length ?? 0);

  const runTestcaseQueued = async (
    sampleId: number,
    sample: ProblemSample,
    subtaskIndex: number,
    testcaseIndex: number,
    testcase: TestcaseConfig
  ) => {
    const isSample = sampleId != null;

    const existingResult = isSample
      ? await task.events.sampleTestcaseWillEnqueue(sampleId, sample, extraParameters)
      : await task.events.testcaseWillEnqueue(subtaskIndex, testcaseIndex, extraParameters);

    const result =
      existingResult ||
      (await getTaskQueue().runTaskQueued(async (taskWorkingDirectory, disposer) => {
        if (isSample) {
          winston.verbose(`Running sample testcase ${sampleId}`);
          task.events.sampleTestcaseRunning(sampleId);
        } else {
          winston.verbose(`Running testcase ${subtaskIndex}.${testcaseIndex}`);
          task.events.testcaseRunning(subtaskIndex, testcaseIndex);
        }

        return await onTestcase(
          task,
          judgeInfo,
          sampleId,
          sample,
          subtaskIndex,
          testcaseIndex,
          testcase,
          extraParameters,
          taskWorkingDirectory,
          disposer
        );
      }));

    if (isSample) {
      task.events.sampleTestcaseFinished(sampleId, sample, result);
      winston.verbose(`Finished sample testcase ${sampleId}: ${JSON.stringify(result)}`);
    } else {
      task.events.testcaseFinished(subtaskIndex, testcaseIndex, result);
      winston.verbose(`Finished testcase ${subtaskIndex}.${testcaseIndex}: ${JSON.stringify(result)}`);
    }

    return result;
  };

  // Extra tests are UOJ-style gate tests. They have no subtask level, so the
  // problem's default time / memory limits apply when the test doesn't set its own.
  const runExtraTestcaseQueued = async (extraTestIndex: number, testcase: TestcaseConfigCommon) => {
    const existingResult = await task.events.extraTestcaseWillEnqueue(extraTestIndex, extraParameters);

    const result =
      existingResult ||
      (await getTaskQueue().runTaskQueued(async (taskWorkingDirectory, disposer) => {
        winston.verbose(`Running extra testcase ${extraTestIndex}`);
        task.events.extraTestcaseRunning(extraTestIndex);

        return await onTestcase(
          task,
          judgeInfo,
          null,
          null,
          -1,
          extraTestIndex,
          {
            ...testcase,
            timeLimit: testcase.timeLimit || judgeInfo.timeLimit,
            memoryLimit: testcase.memoryLimit || judgeInfo.memoryLimit
          } as TestcaseConfig,
          extraParameters,
          taskWorkingDirectory,
          disposer
        );
      }));

    task.events.extraTestcaseFinished(extraTestIndex, result);
    winston.verbose(`Finished extra testcase ${extraTestIndex}: ${JSON.stringify(result)}`);

    return result;
  };

  let firstNonAcceptedStatus: string = null;

  // Run samples first
  let samplesFailed = false;
  if (runSamples) {
    for (const i of samples.keys()) {
      if (samplesFailed) {
        task.events.sampleTestcaseFinished(i, samples[i], null);
        continue;
      }

      const result = await runTestcaseQueued(i, samples[i], null, null, null);

      if (result.status !== "Accepted") {
        samplesFailed = true;
        firstNonAcceptedStatus = result.status;
      }
    }
  }

  const subtaskOrder = getSubtaskOrder(judgeInfo);
  const subtaskScores: number[] = new Array(subtaskOrder.length);
  let totalScore = 0;
  for (const subtaskIndex of subtaskOrder) {
    const subtask = judgeInfo.subtasks[subtaskIndex];

    // If samples failed, skip all subtasks
    // If any of a subtask's dependencies failed, skip it
    if (
      samplesFailed ||
      (Array.isArray(subtask.dependencies) && subtask.dependencies.some(i => Math.round(subtaskScores[i]) === 0))
    ) {
      // Skip
      task.events.subtaskScoreUpdated(subtaskIndex, 0);
      for (const i of subtask.testcases.keys()) {
        task.events.testcaseFinished(subtaskIndex, i, null);
      }
      subtaskScores[subtaskIndex] = 0;
      continue;
    }

    const sumSpecfiedPercentagePointsForTestcases = subtask.testcases
      .map(testcase => testcase.points)
      .filter(x => x != null)
      .reduce((s, x) => s + x, 0);
    const countUnspecfiedPercentagePointsForTestcases = subtask.testcases.filter(
      testcase => testcase.points == null
    ).length;
    const defaultPercentagePointsForTestcases =
      (100 - sumSpecfiedPercentagePointsForTestcases) / countUnspecfiedPercentagePointsForTestcases;

    const normalizedTestcases = subtask.testcases.map(testcase => ({
      ...testcase,
      points: testcase.points == null ? defaultPercentagePointsForTestcases : testcase.points,
      timeLimit: testcase.timeLimit || subtask.timeLimit || judgeInfo.timeLimit,
      memoryLimit: testcase.memoryLimit || subtask.memoryLimit || judgeInfo.memoryLimit
    }));

    let subtaskScore = 0;
    if (subtask.scoringType !== "Sum") subtaskScore = 100;

    let results: TestcaseResult[];
    if (subtask.scoringType === "Sum") {
      results = await Promise.all(
        normalizedTestcases.map(async (testcase, i) => {
          const result = await runTestcaseQueued(null, null, subtaskIndex, i, testcase);
          subtaskScore += (result.score * normalizedTestcases[i].points) / 100;
          task.events.subtaskScoreUpdated(subtaskIndex, subtaskScore);
          return result;
        })
      );
    } else {
      results = [];
      for (const i of normalizedTestcases.keys()) {
        const testcase = normalizedTestcases[i];

        if (Math.round(subtaskScore) === 0) {
          task.events.testcaseFinished(subtaskIndex, i, null);
        } else {
          const result = await runTestcaseQueued(null, null, subtaskIndex, i, testcase);
          if (subtask.scoringType === "GroupMin") subtaskScore = Math.min(subtaskScore, result.score);
          else subtaskScore = (subtaskScore * result.score) / 100;
          task.events.subtaskScoreUpdated(subtaskIndex, subtaskScore);
          results.push(result);
        }
      }
    }

    if (firstNonAcceptedStatus === null) {
      for (const result of results) {
        if (result.status !== "Accepted") {
          firstNonAcceptedStatus = result.status;
          break;
        }
      }
    }

    subtaskScores[subtaskIndex] = subtaskScore;
    totalScore += (subtaskScore * subtaskFullScores[subtaskIndex]) / 100;
  }

  const roundedScore = totalScore > 100 ? 100 : Math.round(totalScore);

  let extraTestsFailed = false;
  if (Array.isArray(judgeInfo.extraTests) && judgeInfo.extraTests.length > 0) {
    if (firstNonAcceptedStatus === null) {
      // Full pass on the base tests: run the extra tests as a gate.
      for (const i of judgeInfo.extraTests.keys()) {
        const result = await runExtraTestcaseQueued(i, judgeInfo.extraTests[i]);
        if (result.status !== "Accepted") {
          extraTestsFailed = true;
          firstNonAcceptedStatus = result.status;
          // Skip all remaining extra tests
          for (let j = i + 1; j < judgeInfo.extraTests.length; j++) {
            task.events.extraTestcaseFinished(j, null);
          }
          break;
        }
      }
    } else {
      // The base tests already failed, so the extra tests are skipped.
      for (const i of judgeInfo.extraTests.keys()) {
        task.events.extraTestcaseFinished(i, null);
      }
    }
  }

  if (extraTestsFailed) {
    task.events.finished(firstNonAcceptedStatus as unknown as SubmissionStatus, EXTRA_TEST_FAILURE_SCORE);
  } else if (firstNonAcceptedStatus === null && roundedScore !== 100) {
    // This shouldn't happen
    throw new Error("Couldn't determine submission result status");
  } else if (firstNonAcceptedStatus === null) {
    task.events.finished(SubmissionStatus.Accepted, roundedScore);
  } else {
    task.events.finished(firstNonAcceptedStatus as unknown as SubmissionStatus, roundedScore);
  }
}

interface JudgeInfoWithSubtasks {
  subtasks: {
    testcases: {
      inputFile?: string;
      outputFile?: string;
    }[];
  }[];
}

/* eslint-disable no-throw-literal */
export function validateJudgeInfoSubtasks(
  judgeInfo: JudgeInfoWithSubtasks,
  testData: Record<string, string>,
  enableInputFile: boolean | "optional" = true,
  enableOutputFile: boolean | "optional" = true
) {
  if (
    judgeInfo.subtasks.length === 0 ||
    (judgeInfo.subtasks.length === 1 && judgeInfo.subtasks[0].testcases.length === 0)
  )
    throw "No testcases.";
  judgeInfo.subtasks.forEach((subtask, i) => {
    if (subtask.testcases.length === 0) throw `Subtask ${i + 1} has no testcases.`;

    subtask.testcases.forEach(({ inputFile, outputFile }, j) => {
      if (enableInputFile && !(!inputFile && enableInputFile === "optional") && !(inputFile in testData))
        throw `Input file ${inputFile} referenced by subtask ${i + 1}'s testcase ${j + 1} doesn't exist.`;
      if (enableOutputFile && !(!outputFile && enableOutputFile === "optional") && !(outputFile in testData))
        throw `Output file ${outputFile} referenced by subtask ${i + 1}'s testcase ${j + 1} doesn't exist.`;
    });
  });
}
/* eslint-enable no-throw-literal */

interface JudgeInfoWithExtraSourceFiles {
  extraSourceFiles?: Partial<Record<string, Record<string, string>>>;
}

/* eslint-disable no-throw-literal */
export function validateJudgeInfoExtraSourceFiles(
  judgeInfo: JudgeInfoWithExtraSourceFiles,
  testData: Record<string, string>
) {
  if (!judgeInfo.extraSourceFiles) return;

  Object.entries(judgeInfo.extraSourceFiles).forEach(([language, fileMap]) => {
    Object.entries(fileMap).forEach(([dst, src]) => {
      if (!(src in testData))
        throw `Extra source file ${src} (mapped to ${dst}, for language ${language}) doesn't exist.`;
    });
  });
}
/* eslint-enable no-throw-literal */

export function getExtraSourceFiles(
  judgeInfo: JudgeInfoWithExtraSourceFiles,
  testData: Record<string, string>,
  language: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries((judgeInfo.extraSourceFiles || {})[language] || {}).map(([dst, src]) => [dst, testData[src]])
  );
}
