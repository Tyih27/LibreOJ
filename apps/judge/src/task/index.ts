import { JudgeTaskPayload, JudgeTaskType } from "@libreoj/judge-protocol";

import onSubmission from "./submission";

export type Task<TaskExtraInfo, Progress> = JudgeTaskPayload<TaskExtraInfo> & {
  reportProgressRaw: (progress: Progress) => void;
};

export type TaskHandler<T> = (task: Task<T, unknown>) => Promise<void>;

const taskHandlers: Record<JudgeTaskType, TaskHandler<unknown>> = {
  [JudgeTaskType.Submission]: onSubmission,
  // TODO(U4a-2): implement the hack task handler. Until then, fail loudly instead of silently skipping the task.
  [JudgeTaskType.Hack]: async () => {
    throw new Error("Hack tasks are not supported by this judge client yet");
  }
};

export default async function taskHandler(task: Task<unknown, unknown>) {
  await taskHandlers[task.type](task);
}
