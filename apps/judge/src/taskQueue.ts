import Queue from "promise-queue";

import type { Config } from "./config";
import { ensureDirectoryEmpty } from "./utils";
import { Disposer } from "./posixUtils";
import type { TaskQueueService } from "./seam";

/**
 * Builds the task working-directory queue. The queue (and its pool of working directories) is created here, when the
 * plugin is applied, instead of at module import time, so importing this module has no side effect; the module-level
 * singleton is gone.
 *
 * We have limited working directories for tasks, so we couldn't run too many tasks in the same time.
 *
 * The returned `runTaskQueued` accepts a task that requires a working directory, and execute the task when a working
 * directory is available.
 *
 * A `Disposer` is passed to task callback to ensure any POSIX resources could be disposed safely even if
 * there're exceptions.
 */
export function createTaskQueue(config: Config): TaskQueueService {
  const availableWorkingDirectories = config.taskWorkingDirectories;
  const queue = new Queue(Math.min(availableWorkingDirectories.length, config.maxConcurrentTasks));

  async function runTaskQueued<T>(task: (taskWorkingDirectory: string, disposer?: Disposer) => Promise<T>) {
    return await queue.add(async () => {
      const taskWorkingDirectory = availableWorkingDirectories.pop();
      const disposer = new Disposer();
      try {
        await ensureDirectoryEmpty(taskWorkingDirectory);
        return await task(taskWorkingDirectory, disposer);
      } finally {
        availableWorkingDirectories.push(taskWorkingDirectory);
        disposer.dispose();
      }
    });
  }

  return { runTaskQueued };
}
