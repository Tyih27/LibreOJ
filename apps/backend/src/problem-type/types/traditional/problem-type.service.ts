import { Injectable } from "@nestjs/common";

import { ValidationError, validate } from "class-validator";
import { plainToClass } from "class-transformer";

import { SubmissionTestcaseResultTraditional } from "./submission-testcase-result.interface";

import { SubmissionContentTraditional } from "./submission-content.interface";

import { ProblemJudgeInfoTraditional } from "./problem-judge-info.interface";

import { ConfigService } from "../../../config/config.service";
import { ProblemFileEntity } from "../../../problem/problem-file.entity";
import { SubmissionProgress } from "../../../submission/submission-progress.interface";
import { CodeLanguageService } from "../../../code-language/code-language.service";
import { validateMetaAndSubtasks } from "../../common/meta-and-subtasks";
import { validateChecker } from "../../common/checker";
import { validateExtraSourceFiles } from "../../common/extra-source-files";
import { restrictProperties } from "../../common/restrict-properties";
import type { ImportContext } from "../../../problem-data-import";
import { getProblemDataImporters } from "../../../plugin/services";

import { ProblemTypeServiceInterface } from "../../problem-type-service.interface";

const IMPORT_CONTEXT: ImportContext = { mode: "input-to-output", optional: false, problemType: "traditional" };

@Injectable()
export class ProblemTypeTraditionalService
  implements
    ProblemTypeServiceInterface<
      ProblemJudgeInfoTraditional,
      SubmissionContentTraditional,
      SubmissionTestcaseResultTraditional
    >
{
  constructor(private configService: ConfigService, private codeLanguageService: CodeLanguageService) {}

  getDefaultJudgeInfo(): ProblemJudgeInfoTraditional {
    return {
      timeLimit: Math.min(1000, this.configService.config.resourceLimit.problemTimeLimit),
      memoryLimit: Math.min(512, this.configService.config.resourceLimit.problemTimeLimit),
      runSamples: true,
      subtasks: null,
      checker: {
        type: "lines",
        caseSensitive: false
      }
    };
  }

  shouldUploadAnswerFile(): boolean {
    return false;
  }

  enableStatistics(): boolean {
    return true;
  }

  preprocessJudgeInfo(
    judgeInfo: ProblemJudgeInfoTraditional,
    testData: ProblemFileEntity[]
  ): ProblemJudgeInfoTraditional {
    const importer = getProblemDataImporters().resolve(testData, IMPORT_CONTEXT);
    const result = importer.import(testData, IMPORT_CONTEXT);

    const subtasks =
      result.subtasks && (importer.authoritative || !Array.isArray(judgeInfo.subtasks))
        ? (result.subtasks as ProblemJudgeInfoTraditional["subtasks"])
        : judgeInfo.subtasks;

    return {
      ...judgeInfo,
      subtasks,
      ...(result.timeLimit !== undefined ? { timeLimit: result.timeLimit } : {}),
      ...(result.memoryLimit !== undefined ? { memoryLimit: result.memoryLimit } : {}),
      ...(result.outputLimit !== undefined ? { outputLimit: result.outputLimit } : {}),
      ...(result.checker ? { checker: result.checker } : {}),
      ...(result.extraSourceFiles ? { extraSourceFiles: result.extraSourceFiles } : {})
    };
  }

  validateAndFilterJudgeInfo(
    judgeInfo: ProblemJudgeInfoTraditional,
    testData: ProblemFileEntity[],
    ignoreLimits: boolean
  ): void {
    validateMetaAndSubtasks(judgeInfo, testData, {
      enableTimeMemoryLimit: true,
      enableFileIo: true,
      enableInputFile: true,
      enableOutputFile: true,
      enableUserOutputFilename: false,
      hardTimeLimit: ignoreLimits ? null : this.configService.config.resourceLimit.problemTimeLimit,
      hardMemoryLimit: ignoreLimits ? null : this.configService.config.resourceLimit.problemMemoryLimit,
      testcaseLimit: ignoreLimits ? null : this.configService.config.resourceLimit.problemTestcases
    });

    validateChecker(judgeInfo, testData, {
      validateCompileAndRunOptions: (language, compileAndRunOptions) =>
        this.codeLanguageService.validateCompileAndRunOptions(language, compileAndRunOptions).length === 0,
      hardTimeLimit: ignoreLimits ? null : this.configService.config.resourceLimit.problemTimeLimit,
      hardMemoryLimit: ignoreLimits ? null : this.configService.config.resourceLimit.problemMemoryLimit
    });

    validateExtraSourceFiles(judgeInfo, testData);

    restrictProperties(judgeInfo, [
      "timeLimit",
      "memoryLimit",
      "outputLimit",
      "fileIo",
      "runSamples",
      "subtasks",
      "checker",
      "extraSourceFiles"
    ]);
    restrictProperties(judgeInfo.fileIo, ["inputFilename", "outputFilename"]);
  }

  async validateSubmissionContent(submissionContent: SubmissionContentTraditional): Promise<ValidationError[]> {
    const errors = await validate(plainToClass(SubmissionContentTraditional, submissionContent), {
      whitelist: true,
      forbidNonWhitelisted: true
    });
    if (errors.length > 0) return errors;
    return this.codeLanguageService.validateCompileAndRunOptions(
      submissionContent.language,
      submissionContent.compileAndRunOptions
    );
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  async getCodeLanguageAndAnswerSizeFromSubmissionContentAndFile(submissionContent: SubmissionContentTraditional) {
    return {
      language: submissionContent.language,

      // string.length returns the number of charactars in the string
      // Convert to a buffer to get the number of bytes
      answerSize: Buffer.from(submissionContent.code).length
    };
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  getTimeAndMemoryUsedFromFinishedSubmissionProgress(
    submissionProgress: SubmissionProgress<SubmissionTestcaseResultTraditional>
  ) {
    const result = {
      timeUsed: 0,
      memoryUsed: 0
    };

    if (submissionProgress) {
      if (Array.isArray(submissionProgress.subtasks)) {
        for (const subtask of submissionProgress.subtasks) {
          for (const testcase of subtask.testcases) {
            if (!testcase?.testcaseHash) continue;
            result.timeUsed += submissionProgress.testcaseResult[testcase.testcaseHash].time;
            result.memoryUsed = Math.max(
              result.memoryUsed,
              submissionProgress.testcaseResult[testcase.testcaseHash].memory
            );
          }
        }
      }
    }

    return result;
  }
}
