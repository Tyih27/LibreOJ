import { SubmissionStatus } from "@libreoj/judge-protocol";

/**
 * Errors returned while creating a hack. The controller maps them to the response DTO's error field.
 *
 * A string-literal union is used instead of a `string` enum so that the pure policy module and the response DTO can
 * share these values without a lossy cast.
 */
export type HackCreationError =
  | "NO_SUCH_PROBLEM"
  | "PROBLEM_NOT_HACKABLE"
  | "NO_SUCH_SUBMISSION"
  | "SUBMISSION_NOT_ACCEPTED"
  | "PERMISSION_DENIED";

export const HACK_TASK_ID_PREFIX = "hack-";

/** A hack task ID is stable for a hack so that judge progress can be routed back to it. */
export function makeHackTaskId(hackId: number): string {
  return `${HACK_TASK_ID_PREFIX}${hackId}`;
}

/**
 * @return The hack ID encoded in `taskId`, or `null` if `taskId` does not identify a hack task.
 */
export function parseHackIdFromTaskId(taskId: string): number | null {
  if (typeof taskId !== "string" || !taskId.startsWith(HACK_TASK_ID_PREFIX)) return null;
  const hackId = Number(taskId.slice(HACK_TASK_ID_PREFIX.length));
  return Number.isSafeInteger(hackId) && hackId > 0 ? hackId : null;
}

/**
 * Only an Accepted submission fully passes the problem. A submission must also have a full score, so a partial
 * score reported as Accepted is not treated as passing.
 */
export function isAcceptedFullScoreSubmission(status: SubmissionStatus, score: number): boolean {
  return status === SubmissionStatus.Accepted && score === 100;
}

/**
 * A user may hack a problem if the user is an administrator or has a full-score accepted submission on the problem.
 */
export function hasHackPermission(isAdmin: boolean, hasAcceptedFullScoreSubmission: boolean): boolean {
  return isAdmin || hasAcceptedFullScoreSubmission;
}

/**
 * The pure precondition check for `HackService.createHack`. It is kept free of database access so it can be
 * unit-tested directly.
 *
 * @return `null` when a hack may be created, otherwise the first failing error.
 */
export function checkHackCreationPreconditions(input: {
  problemExists: boolean;
  hackable: boolean;
  submissionExists: boolean;
  submissionAccepted: boolean;
  hasPermission: boolean;
}): HackCreationError {
  if (!input.problemExists) return "NO_SUCH_PROBLEM";
  if (!input.hackable) return "PROBLEM_NOT_HACKABLE";
  if (!input.submissionExists) return "NO_SUCH_SUBMISSION";
  if (!input.submissionAccepted) return "SUBMISSION_NOT_ACCEPTED";
  if (!input.hasPermission) return "PERMISSION_DENIED";
  return null;
}
