import { Inject, Injectable } from "@nestjs/common";

import { ProblemTypeServiceInterface } from "./problem-type-service.interface";

import { PROBLEM_TYPE_REGISTRY, type ProblemTypeRegistry } from "../plugin/seam";
import { ProblemJudgeInfo } from "../problem/problem-judge-info.interface";
import { ProblemType } from "../problem/problem.entity";
import { SubmissionContent } from "../submission/submission-content.interface";
import { SubmissionTestcaseResult } from "../submission/submission-progress.interface";

/**
 * Backend-facing adapter over the `problemTypeRegistry` seam. The mapping from a `ProblemType` to its service now lives
 * in the `@libreoj/backend-problem-type-registry` plugin; this service only injects the kernel-provided registry and
 * keeps the existing public signature so every caller is unchanged.
 */
@Injectable()
export class ProblemTypeFactoryService {
  constructor(@Inject(PROBLEM_TYPE_REGISTRY) private readonly registry: ProblemTypeRegistry) {}

  type(
    problemType: ProblemType
  ): ProblemTypeServiceInterface<ProblemJudgeInfo, SubmissionContent, SubmissionTestcaseResult> {
    return this.registry.type(problemType);
  }
}
