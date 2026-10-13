export enum JudgeTaskType {
  Submission = "Submission",
  Hack = "Hack"
}

export interface JudgeTaskMeta {
  taskId: string;
  type: JudgeTaskType;
}

export interface JudgeTaskPayload<ExtraInfo> extends JudgeTaskMeta {
  priorityType: number;
  priority: number;
  extraInfo: ExtraInfo;
}

/**
 * The judge task type identifier of a hack task. It is the `JudgeTaskType.Hack` member, exported as a standalone
 * type so that consumers can refer to it without repeating the enum access.
 */
export type HackTaskType = JudgeTaskType.Hack;

/**
 * The extra info sent to a judge client for a hack task: a previously accepted submission rejudged against a
 * hacker-provided input.
 */
export interface HackTaskExtraInfo {
  problemType: string;
  judgeInfo: unknown;
  testData: Record<string, string>; // filename -> uuid
  submissionContent: unknown;
  submissionFile?: {
    uuid: string;
    url: string;
  };
  hackInput: {
    uuid: string;
    url?: string;
  };
}

/** A judge-requested direct upload target for a file the judge produced (e.g. a hack's standard output). */
export interface JudgeUploadRequest {
  uuid: string;
  method: "PUT";
  url: string;
}

export type OmittableString =
  | string
  | {
      data: string;
      omittedLength: number;
    };

export enum SubmissionStatus {
  Pending = "Pending",
  ConfigurationError = "ConfigurationError",
  SystemError = "SystemError",
  Canceled = "Canceled",
  CompilationError = "CompilationError",
  FileError = "FileError",
  RuntimeError = "RuntimeError",
  TimeLimitExceeded = "TimeLimitExceeded",
  MemoryLimitExceeded = "MemoryLimitExceeded",
  OutputLimitExceeded = "OutputLimitExceeded",
  PartiallyCorrect = "PartiallyCorrect",
  WrongAnswer = "WrongAnswer",
  Accepted = "Accepted",
  JudgementFailed = "JudgementFailed"
}

export interface JudgeClientSystemInfo {
  os: string;
  kernel: string;
  arch: string;
  cpu: {
    model: string;
    flags: string;
    cache: Record<string, number>;
  };
  memory: {
    size: number;
    description: string;
  };
  languages: Record<
    string,
    {
      name: string;
      version: string;
    }[]
  >;
  extraInfo: string;
}
