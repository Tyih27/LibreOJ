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
}
