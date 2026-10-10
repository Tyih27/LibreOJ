import { JudgeTaskPayload, JudgeTaskType } from "@libreoj/judge-protocol";

import onSubmission from "./submission";
import { onHack } from "./hack";

export type Task<TaskExtraInfo, Progress> = JudgeTaskPayload<TaskExtraInfo> & {
  reportProgressRaw: (progress: Progress) => void;
};

export type TaskHandler<T> = (task: Task<T, unknown>) => Promise<void>;

const taskHandlers: Record<JudgeTaskType, TaskHandler<unknown>> = {
  [JudgeTaskType.Submission]: onSubmission,
  [JudgeTaskType.Hack]: onHack
};

export default async function taskHandler(task: Task<unknown, unknown>) {
  await taskHandlers[task.type](task);
}
