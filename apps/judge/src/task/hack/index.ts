import fs from "fs";

import { v4 as uuid } from "uuid";
import { SandboxStatus } from "simple-sandbox";
import winston from "winston";

import { getExtraSourceFiles } from "../submission/common";
import { SubmissionFile } from "../submission/submissionFile";
import { JudgeInfoTraditional, SubmissionContentTraditional } from "../submission/traditional";

import { Task } from "..";
import { CompileResultSuccess } from "../../compile";
import { getCompile, getFile, getRpc, getSandbox, getTaskQueue } from "../../plugin/services";
import { CpuAffinityStrategy, SANDBOX_INSIDE_PATH_BINARY, SANDBOX_INSIDE_PATH_WORKING } from "../../sandbox";
import getLanguage from "../../languages";
import { serverSideConfig } from "../../config";
import { safelyJoinPath, MappedPath, upload } from "../../utils";
import * as fsNative from "../../fsNative";
import { OmittableString, isOmittableString, prependOmittableString, readFileOmitted } from "../../omittableString";
import { ConfigurationError, CanceledError } from "../../error";
import { runBuiltinChecker } from "../../checkers/builtin";
import { runCustomChecker, validateCustomChecker } from "../../checkers/custom";

/**
 * The judge-side mirror of the protocol's `HackTaskExtraInfo`, with the concrete judge info and submission content
 * shapes a traditional problem uses. The protocol type keeps these fields `unknown` because they cross the
 * Backend-Judge boundary; the judge recovers their real shape here, the way the submission task mirrors
 * `SubmissionTaskExtraInfo`.
 */
export interface HackTaskExtraInfo {
  problemType: string;
  judgeInfo: JudgeInfoTraditional;
  testData: Record<string, string>; // filename -> uuid
  submissionContent: SubmissionContentTraditional;
  submissionFile?: {
    uuid: string;
    url: string;
  };
  hackInput: {
    uuid: string;
    url?: string;
  };
}

export enum HackProgressType {
  Running = "Running",
  Finished = "Finished"
}

/** The name of the input validator, a plain testdata file compiled with the standard program. */
const VALIDATOR_FILENAME = "val.cpp";

/** The name of the standard solution, a plain testdata file. */
const STANDARD_PROGRAM_FILENAME = "std.cpp";

/** The language used to compile `val.cpp` and `std.cpp`. */
const STANDARD_PROGRAM_LANGUAGE = "cpp";

/**
 * UOJ compiles its standard solution and validator with `-std=c++14 -O2` (its `compile_cpp14`). The compiler binary
 * is resolved by the cpp language config from `compiler`, so no compiler path is hardcoded here.
 */
const STANDARD_PROGRAM_COMPILE_AND_RUN_OPTIONS = {
  compiler: "g++",
  std: "c++14",
  O: "2",
  m: "64"
};

interface ValidatorDetails {
  /** Whether the hack input passed `val`. */
  passed: boolean;
  message?: OmittableString;
}

interface ProgramDetails {
  status: string;
  time?: number;
  memory?: number;
  message?: OmittableString;
}

interface CheckerDetails {
  score?: number;
  message?: OmittableString;
}

/** The progress payload persisted by the backend as the hack's `details` column. JSON-serializable by construction. */
export interface HackDetails {
  problemType: string;
  validator: ValidatorDetails;
  standardProgram?: ProgramDetails;
  submission?: ProgramDetails;
  checker?: CheckerDetails;
  reason?: string;
  message?: OmittableString;
}

export interface HackProgress {
  progressType: HackProgressType;
  /** Only present on a `Running` update: the stage the judge is currently in. */
  stage?: string;
  /** Only valid when finished. */
  success?: boolean;
  details?: HackDetails;
  /** Only present on a successful finished update: the uuid of the uploaded standard output. */
  stdOutputUuid?: string;
}

type HackTask = Task<HackTaskExtraInfo, HackProgress>;

interface ProgramRunResult {
  status: SandboxStatus;
  exitCode: number;
  time: number;
  memory: number;
  inputFile: MappedPath;
  outputFile: MappedPath;
  stderrFile: MappedPath;
}

/**
 * Runs one compiled program on the hack input in the sandbox, following the same IO convention as a traditional
 * testcase: when the problem uses file IO the program reads/writes the configured filenames, otherwise the hack input
 * is passed on stdin and the output is captured to a file.
 */
async function runProgram(options: {
  taskId: string;
  compileResult: CompileResultSuccess;
  workingDirectory: MappedPath;
  tempDirectoryOutside: string;
  inputFileOutside: string;
  fileIo: JudgeInfoTraditional["fileIo"];
  language: string;
  compileAndRunOptions: unknown;
  timeLimit: number;
  memoryLimit: number;
}): Promise<ProgramRunResult> {
  const { compileResult, workingDirectory, fileIo } = options;

  const binaryDirectory: MappedPath = {
    outside: compileResult.binaryDirectory,
    inside: SANDBOX_INSIDE_PATH_BINARY
  };

  await fsNative.ensureDir(workingDirectory.outside);

  const inputFile = safelyJoinPath(workingDirectory, fileIo ? fileIo.inputFilename : uuid());
  await fsNative.copy(options.inputFileOutside, inputFile.outside);

  const outputFile = safelyJoinPath(workingDirectory, fileIo ? fileIo.outputFilename : uuid());
  const stderrFile = safelyJoinPath(workingDirectory, uuid());

  const sandboxResult = await getSandbox().runSandbox(options.taskId, {
    ...getLanguage(options.language).run({
      binaryDirectoryInside: binaryDirectory.inside,
      workingDirectoryInside: workingDirectory.inside,
      compileAndRunOptions: options.compileAndRunOptions,
      time: options.timeLimit,
      memory: options.memoryLimit,
      stdinFile: fileIo ? null : inputFile.inside,
      stdoutFile: fileIo ? null : outputFile.inside,
      stderrFile: stderrFile.inside,
      parameters: [],
      compileResultExtraInfo: compileResult.extraInfo
    }),
    time: options.timeLimit,
    memory: options.memoryLimit * 1024 * 1024,
    workingDirectory: workingDirectory.inside,
    tempDirectoryOutside: options.tempDirectoryOutside,
    extraMounts: [
      {
        mappedPath: binaryDirectory,
        readOnly: true
      },
      {
        mappedPath: workingDirectory,
        readOnly: false
      }
    ],
    cpuAffinity: CpuAffinityStrategy.UserProgram
  });

  return {
    status: sandboxResult.status,
    exitCode: sandboxResult.code,
    time: sandboxResult.time / 1e6,
    memory: sandboxResult.memory / 1024,
    inputFile,
    outputFile,
    stderrFile
  };
}

/**
 * Uploads the standard program's output best-effort. Never throws: a failed upload must not change the hack's success.
 *
 * @return The uploaded file's uuid, or `null` if the server offered no upload target or the upload failed.
 */
async function uploadStdOutput(stdOutputPath: string): Promise<string | null> {
  try {
    const request = await getRpc().requestUploadUrl();
    if (!request) return null;

    await upload(request.url, stdOutputPath, "hack standard output");
    return request.uuid;
  } catch (e) {
    winston.warn(`Failed to upload hack standard output: ${e}`);
    return null;
  }
}

/**
 * Judges the hack on one task working directory: runs `val` on the hack input, runs `std` to produce the answer, runs
 * the hacked submission, and compares its output against the answer with the problem's checker.
 *
 * @returns The hack's `success`: a submission that does not pass on the hack input makes the hack succeed. A missing
 * or broken validator / standard program makes the hack invalid and therefore not successful. On success, the
 * uploaded standard output's uuid is returned when available.
 */
async function judgeOnWorkingDirectory(options: {
  task: HackTask;
  taskWorkingDirectory: string;
  judgeInfo: JudgeInfoTraditional;
  submissionContent: SubmissionContentTraditional;
  inputFileOutside: string;
  validatorCompileResult: CompileResultSuccess;
  standardCompileResult: CompileResultSuccess;
  submissionCompileResult: CompileResultSuccess;
  customCheckerCompileResult: CompileResultSuccess;
  reportStage: (stage: string) => void;
  details: HackDetails;
}): Promise<{ success: boolean; stdOutputUuid?: string }> {
  const {
    task,
    taskWorkingDirectory,
    judgeInfo,
    submissionContent,
    inputFileOutside,
    validatorCompileResult,
    standardCompileResult,
    submissionCompileResult,
    customCheckerCompileResult,
    reportStage,
    details
  } = options;

  const { fileIo } = judgeInfo;
  const tempDirectoryOutside = safelyJoinPath(taskWorkingDirectory, "temp");

  const mappedWorkingDirectory = (name: string): MappedPath => ({
    outside: safelyJoinPath(taskWorkingDirectory, name),
    inside: SANDBOX_INSIDE_PATH_WORKING
  });

  const runOn = (name: string, compileResult: CompileResultSuccess, language: string, compileAndRunOptions: unknown) =>
    runProgram({
      taskId: task.taskId,
      compileResult,
      workingDirectory: mappedWorkingDirectory(name),
      tempDirectoryOutside,
      inputFileOutside,
      fileIo,
      language,
      compileAndRunOptions,
      timeLimit: judgeInfo.timeLimit,
      memoryLimit: judgeInfo.memoryLimit
    });

  // 1. Validate the hack input with `val`.
  reportStage("ValidatingInput");
  const validatorRun = await runOn(
    "val",
    validatorCompileResult,
    STANDARD_PROGRAM_LANGUAGE,
    STANDARD_PROGRAM_COMPILE_AND_RUN_OPTIONS
  );

  if (validatorRun.status !== SandboxStatus.OK) {
    details.validator = { passed: false, message: `Validator ${SandboxStatus[validatorRun.status]}` };
    details.reason = "ValidatorFailed";
    return { success: false };
  }
  if (validatorRun.exitCode !== 0) {
    details.validator = {
      passed: false,
      message: await readFileOmitted(validatorRun.stderrFile.outside, serverSideConfig.limit.stderrDisplay)
    };
    details.reason = "InvalidInput";
    return { success: false };
  }
  details.validator = { passed: true };

  // 2. Run the standard solution on the hack input to produce the answer file.
  reportStage("RunningStandardProgram");
  const standardRun = await runOn(
    "std",
    standardCompileResult,
    STANDARD_PROGRAM_LANGUAGE,
    STANDARD_PROGRAM_COMPILE_AND_RUN_OPTIONS
  );
  if (standardRun.status !== SandboxStatus.OK || standardRun.exitCode !== 0) {
    details.standardProgram = {
      status: standardRun.status === SandboxStatus.OK ? "RuntimeError" : SandboxStatus[standardRun.status],
      time: standardRun.time,
      memory: standardRun.memory
    };
    details.reason = "StandardProgramFailed";
    return { success: false };
  }
  details.standardProgram = { status: "OK", time: standardRun.time, memory: standardRun.memory };

  // 3. Run the hacked submission on the hack input.
  reportStage("RunningSubmission");
  const submissionRun = await runOn(
    "pro",
    submissionCompileResult,
    submissionContent.language,
    submissionContent.compileAndRunOptions
  );

  const outputLimit =
    judgeInfo.outputLimit != null ? judgeInfo.outputLimit * 1024 * 1024 : serverSideConfig.limit.outputSize;
  const workingDirectorySize = await fsNative.calcSize(mappedWorkingDirectory("pro").outside);
  const inputFileSize = await fsNative.calcSize(submissionRun.inputFile.outside);

  let submissionStatus: string = null;
  if (workingDirectorySize - inputFileSize > outputLimit) {
    submissionStatus = "OutputLimitExceeded";
  } else if (submissionRun.status === SandboxStatus.TimeLimitExceeded) {
    submissionStatus = "TimeLimitExceeded";
  } else if (submissionRun.status === SandboxStatus.MemoryLimitExceeded) {
    submissionStatus = "MemoryLimitExceeded";
  } else if (submissionRun.status === SandboxStatus.RuntimeError) {
    submissionStatus = "RuntimeError";
  } else if (submissionRun.status !== SandboxStatus.OK) {
    throw new Error(`Corrupt sandbox result: ${JSON.stringify(submissionRun)}`);
  } else if (!(await fsNative.exists(submissionRun.outputFile.outside))) {
    submissionStatus = "FileError";
  }

  details.submission = {
    status: submissionStatus || "Running",
    time: submissionRun.time,
    memory: submissionRun.memory
  };

  if (submissionStatus) {
    // The submission does not fulfill the problem on the hack input, so the hack succeeds.
    const stdOutputUuid = await uploadStdOutput(standardRun.outputFile.outside);
    return { success: true, stdOutputUuid };
  }

  // 4. Compare the submission's output against the answer with the problem's checker.
  reportStage("Checking");

  // The input file may have been modified by the submission; restore it for the checker.
  await fsNative.copy(inputFileOutside, submissionRun.inputFile.outside);

  const answerFile = safelyJoinPath(mappedWorkingDirectory("pro"), uuid());
  await fsNative.copy(standardRun.outputFile.outside, answerFile.outside);

  const checkerResult =
    judgeInfo.checker.type === "custom"
      ? await runCustomChecker(
          task.taskId,
          judgeInfo.checker,
          judgeInfo.checker.timeLimit || judgeInfo.timeLimit,
          judgeInfo.checker.memoryLimit || judgeInfo.memoryLimit,
          customCheckerCompileResult,
          submissionRun.inputFile,
          submissionRun.outputFile,
          answerFile,
          submissionContent.code,
          mappedWorkingDirectory("pro"),
          tempDirectoryOutside
        )
      : await runBuiltinChecker(submissionRun.outputFile.outside, standardRun.outputFile.outside, judgeInfo.checker);

  // A string return means the checker itself failed. That is not a clean full score of the submission, so it does not
  // make the hack fail.
  if (isOmittableString(checkerResult)) {
    details.checker = { message: checkerResult };
    details.submission.status = "JudgementFailed";
    details.reason = "CheckerFailed";
    const stdOutputUuid = await uploadStdOutput(standardRun.outputFile.outside);
    return { success: true, stdOutputUuid };
  }

  details.checker = { score: checkerResult.score, message: checkerResult.checkerMessage };
  if (checkerResult.score == null) {
    details.submission.status = "JudgementFailed";
    details.reason = "CheckerFailed";
    const stdOutputUuid = await uploadStdOutput(standardRun.outputFile.outside);
    return { success: true, stdOutputUuid };
  }

  if (checkerResult.score === 100) details.submission.status = "Accepted";
  else if (checkerResult.score === 0) details.submission.status = "WrongAnswer";
  else details.submission.status = "PartiallyCorrect";

  // The hack succeeds exactly when the hacked submission does not get a full score on the hack input.
  const success = checkerResult.score !== 100;
  const stdOutputUuid = success ? await uploadStdOutput(standardRun.outputFile.outside) : undefined;
  return { success, stdOutputUuid };
}

export async function onHack(task: HackTask): Promise<void> {
  const { problemType, judgeInfo, testData, submissionContent, hackInput } = task.extraInfo;

  const details: HackDetails = {
    problemType,
    validator: { passed: false }
  };

  let finished = false;
  const finish = (success: boolean, finalDetails: HackDetails, stdOutputUuid?: string) => {
    if (finished) return;
    finished = true;
    task.reportProgressRaw({
      progressType: HackProgressType.Finished,
      success,
      details: finalDetails,
      ...(stdOutputUuid ? { stdOutputUuid } : {})
    });
  };
  const reportStage = (stage: string) => {
    if (finished) return;
    task.reportProgressRaw({
      progressType: HackProgressType.Running,
      stage
    });
  };

  const disposables: (CompileResultSuccess | SubmissionFile)[] = [];

  try {
    if (problemType !== "Traditional") {
      throw new ConfigurationError(`Hack is not supported for problem type: ${problemType}`);
    }
    if (!(VALIDATOR_FILENAME in testData))
      throw new ConfigurationError(`The problem provides no input validator (${VALIDATOR_FILENAME}).`);
    if (!(STANDARD_PROGRAM_FILENAME in testData))
      throw new ConfigurationError(`The problem provides no standard program (${STANDARD_PROGRAM_FILENAME}).`);

    // 1. Download the testdata (including `std.cpp` / `val.cpp`), the hack input, and the hacked submission's file.
    reportStage("Preparing");
    await getFile().ensureFiles([...Object.values(testData), hackInput.uuid]);

    if (task.extraInfo.submissionFile) {
      const submissionFile = new SubmissionFile(task.extraInfo.submissionFile);
      disposables.push(submissionFile);
      await submissionFile.waitForDownload();
    }

    // 2. Compile the validator and the standard program.
    reportStage("CompilingValidator");
    const validatorCompileResult = await getCompile().compile({
      language: STANDARD_PROGRAM_LANGUAGE,
      code: await fs.promises.readFile(getFile().getFile(testData[VALIDATOR_FILENAME]), "utf-8"),
      compileAndRunOptions: STANDARD_PROGRAM_COMPILE_AND_RUN_OPTIONS
    });
    if (!(validatorCompileResult instanceof CompileResultSuccess)) {
      details.validator = { passed: false, message: validatorCompileResult.message };
      finish(false, { ...details, reason: "ValidatorCompilationError" });
      return;
    }
    disposables.push(validatorCompileResult);

    reportStage("CompilingStandardProgram");
    const standardCompileResult = await getCompile().compile({
      language: STANDARD_PROGRAM_LANGUAGE,
      code: await fs.promises.readFile(getFile().getFile(testData[STANDARD_PROGRAM_FILENAME]), "utf-8"),
      compileAndRunOptions: STANDARD_PROGRAM_COMPILE_AND_RUN_OPTIONS
    });
    if (!(standardCompileResult instanceof CompileResultSuccess)) {
      details.standardProgram = { status: "CompilationError", message: standardCompileResult.message };
      finish(false, { ...details, reason: "StandardProgramCompilationError" });
      return;
    }
    disposables.push(standardCompileResult);

    let customCheckerCompileResult: CompileResultSuccess;
    if (judgeInfo.checker.type === "custom") {
      validateCustomChecker(judgeInfo.checker);

      const compileResult = await getCompile().compile({
        language: judgeInfo.checker.language,
        code: await fs.promises.readFile(getFile().getFile(testData[judgeInfo.checker.filename]), "utf-8"),
        compileAndRunOptions: judgeInfo.checker.compileAndRunOptions
      });

      if (!(compileResult instanceof CompileResultSuccess)) {
        throw new ConfigurationError(
          prependOmittableString("Failed to compile custom checker:\n\n", compileResult.message, true)
        );
      }

      customCheckerCompileResult = compileResult;
      disposables.push(compileResult);
    }

    // 3. Compile the hacked submission.
    reportStage("CompilingSubmission");
    const submissionCompileResult = await getCompile().compile({
      language: submissionContent.language,
      code: submissionContent.code,
      compileAndRunOptions: submissionContent.compileAndRunOptions,
      extraSourceFiles: getExtraSourceFiles(judgeInfo, testData, submissionContent.language)
    });

    if (!(submissionCompileResult instanceof CompileResultSuccess)) {
      // A submission that does not even compile cannot be accepted on the hack input, so the hack succeeds.
      details.submission = { status: "CompilationError", message: submissionCompileResult.message };
      finish(true, details);
      return;
    }
    disposables.push(submissionCompileResult);

    // 4. Run the validator, the standard program, the submission, and the checker on a task working directory.
    const result = await getTaskQueue().runTaskQueued(taskWorkingDirectory =>
      judgeOnWorkingDirectory({
        task,
        taskWorkingDirectory,
        judgeInfo,
        submissionContent,
        inputFileOutside: getFile().getFile(hackInput.uuid),
        validatorCompileResult,
        standardCompileResult,
        submissionCompileResult,
        customCheckerCompileResult,
        reportStage,
        details
      })
    );
    finish(result.success, details, result.stdOutputUuid);
  } catch (e) {
    if (e instanceof CanceledError) throw e;

    const isConfigurationError = e instanceof ConfigurationError;
    if (!isConfigurationError) winston.error(`Error on hack task ${task.taskId}, ${e.stack || e}`);

    details.reason = isConfigurationError ? "ConfigurationError" : "SystemError";
    details.message = isConfigurationError ? e.originalMessage : e.stack || String(e);
    finish(false, details);
  } finally {
    for (const disposable of disposables) {
      if (disposable instanceof CompileResultSuccess) await disposable.dereference();
      else disposable.dispose();
    }
  }
}

export default onHack;
