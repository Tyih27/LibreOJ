import { Injectable } from "@nestjs/common";

import { ValidationError } from "class-validator";

import { SubmissionTestcaseResultSubmitAnswer } from "./submission-testcase-result.interface";

import { SubmissionContentSubmitAnswer } from "./submission-content.interface";

import { ProblemJudgeInfoSubmitAnswer } from "./problem-judge-info.interface";

import { ConfigService } from "../../../config/config.service";
import { ProblemFileEntity } from "../../../problem/problem-file.entity";
import { SubmissionProgress } from "../../../submission/submission-progress.interface";
import { CodeLanguageService } from "../../../code-language/code-language.service";
import { validateMetaAndSubtasks } from "../../common/meta-and-subtasks";
import { validateChecker } from "../../common/checker";
import { FileEntity } from "../../../file/file.entity";
import { restrictProperties } from "../../common/restrict-properties";
import type { ImportContext } from "../../../problem-data-import";
import { getProblemDataImporters } from "../../../plugin/services";

import { ProblemTypeServiceInterface } from "../../problem-type-service.interface";

const IMPORT_CONTEXT: ImportContext = { mode: "output-to-input", optional: true, problemType: "submit-answer" };

@Injectable()
export class ProblemTypeSubmitAnswerService
  implements
    ProblemTypeServiceInterface<
      ProblemJudgeInfoSubmitAnswer,
      SubmissionContentSubmitAnswer,
      SubmissionTestcaseResultSubmitAnswer
    >
{
  constructor(private configService: ConfigService, private codeLanguageService: CodeLanguageService) {}

  getDefaultJudgeInfo(): ProblemJudgeInfoSubmitAnswer {
    return {
      subtasks: null,
      checker: {
        type: "lines",
        caseSensitive: false
      }
    };
  }

  shouldUploadAnswerFile(): boolean {
    return true;
  }

  enableStatistics(): boolean {
    return false;
  }

  preprocessJudgeInfo(
    judgeInfo: ProblemJudgeInfoSubmitAnswer,
    testData: ProblemFileEntity[]
  ): ProblemJudgeInfoSubmitAnswer {
    const importer = getProblemDataImporters().resolve(testData, IMPORT_CONTEXT);
    const result = importer.import(testData, IMPORT_CONTEXT);

    const subtasks =
      result.subtasks && (importer.authoritative || !Array.isArray(judgeInfo.subtasks))
        ? (result.subtasks as ProblemJudgeInfoSubmitAnswer["subtasks"])
        : judgeInfo.subtasks;

    return {
      ...judgeInfo,
      subtasks,
      ...(result.checker ? { checker: result.checker } : {})
    };
  }

  validateAndFilterJudgeInfo(
    judgeInfo: ProblemJudgeInfoSubmitAnswer,
    testData: ProblemFileEntity[],
    ignoreLimits: boolean
  ): void {
    validateMetaAndSubtasks(judgeInfo, testData, {
      enableTimeMemoryLimit: false,
      enableFileIo: false,
      enableInputFile: "optional",
      enableOutputFile: true,
      enableUserOutputFilename: true
    });

    validateChecker(judgeInfo, testData, {
      validateCompileAndRunOptions: (language, compileAndRunOptions) =>
        this.codeLanguageService.validateCompileAndRunOptions(language, compileAndRunOptions).length === 0,
      hardTimeLimit: ignoreLimits ? null : this.configService.config.resourceLimit.problemTimeLimit,
      hardMemoryLimit: ignoreLimits ? null : this.configService.config.resourceLimit.problemMemoryLimit
    });

    restrictProperties(judgeInfo, ["subtasks", "outputLimit", "checker"]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async validateSubmissionContent(submissionContent: SubmissionContentSubmitAnswer): Promise<ValidationError[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getCodeLanguageAndAnswerSizeFromSubmissionContentAndFile(
    submissionContent: SubmissionContentSubmitAnswer,
    file: FileEntity
  ) {
    return {
      language: null,
      answerSize: file.size
    };
  }

  getTimeAndMemoryUsedFromFinishedSubmissionProgress(
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    submissionProgress: SubmissionProgress<SubmissionTestcaseResultSubmitAnswer>
  ) {
    return {
      timeUsed: null,
      memoryUsed: null
    };
  }
}
