export interface ProblemJudgeInfo {
  /*
   * The maximum size (in MiB) of a testcase's output. If not set, the global limit configured on the judge is used.
   */
  outputLimit?: number;
}
