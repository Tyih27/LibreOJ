import { JudgeTaskProgress } from "../judge/judge-task-progress.interface";

export enum HackProgressType {
  Running = "Running",
  Finished = "Finished"
}

export interface HackProgress extends JudgeTaskProgress {
  progressType: HackProgressType;

  // Only valid when finished
  success?: boolean;
  details?: unknown;
  /** Object-storage uuid of the standard program's output, only present on a successful finished update. */
  stdOutputUuid?: string;
}
