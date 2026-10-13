import type { ProblemTypeRegistry } from "./seam";

import type { ProblemJudgeInfo } from "../problem/problem-judge-info.interface";
import type { ProblemType } from "../problem/problem.entity";
import type { ProblemTypeServiceInterface } from "../problem-type/problem-type-service.interface";
import type { SubmissionContent } from "../submission/submission-content.interface";
import type { SubmissionTestcaseResult } from "../submission/submission-progress.interface";

type ProblemTypeService = ProblemTypeServiceInterface<ProblemJudgeInfo, SubmissionContent, SubmissionTestcaseResult>;

/**
 * The registry backing the `problemTypeRegistry` seam. It is a plain map from a {@link ProblemType} to its service.
 *
 * The concrete services are Nest providers (they inject `CodeLanguageService`), so they cannot be constructed here;
 * the `@libreoj/backend-problem-type-registry` plugin resolves them from the Nest application and registers them.
 */
export class ProblemTypeRegistryService implements ProblemTypeRegistry {
  private readonly services = new Map<ProblemType, ProblemTypeService>();

  register(problemType: ProblemType, service: ProblemTypeService): () => void {
    this.services.set(problemType, service);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      // Only remove the entry while it still points at this service, so replacing a type's service keeps the new one.
      if (this.services.get(problemType) === service) this.services.delete(problemType);
    };
  }

  type(problemType: ProblemType): ProblemTypeService {
    const service = this.services.get(problemType);
    if (!service) throw new Error(`No problem type service is registered for problem type "${problemType}"`);
    return service;
  }
}
