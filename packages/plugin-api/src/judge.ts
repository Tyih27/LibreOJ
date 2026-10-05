/**
 * Service Definition for the `languageRegistry` seam.
 *
 * Mirrors the judge's language registry (`apps/judge/src/languages/index.ts`) without importing it, so a Service
 * Provider (today: the judge's `getLanguage`, later: a plugin) and its Consumers share one contract while remaining
 * in separate workspaces. Only the seam vocabulary is re-declared here; per-language compile/run logic stays in the
 * judge. The sandbox / POSIX types the language contract refers to are mirrored structurally for the same reason.
 */

/** Service name a `LanguageRegistry` provider registers under. */
export const LANGUAGE_REGISTRY = "languageRegistry";

/**
 * Mirror of `OverridableRecord` in `apps/judge/src/utils.ts`. Used by the sandbox environment map, where a value may
 * be a replacement or a reducer applied to the previously set value.
 */
export type OverridableRecord<K extends string | number | symbol, V> = Record<K, V | ((oldValue: V) => V)>;

/**
 * Mirror of the public shape of `FileDescriptor` in `apps/judge/src/posixUtils.ts`. The class also has a constructor
 * and a private disposer, which are irrelevant to the seam: a provider's concrete instance is structurally assignable
 * to this interface.
 */
export interface FileDescriptor {
  fd: number;
  setCloseOnExec(closeOnExec: boolean): void;
  close(): void;
}

/** Mirror of `TaskIndependentSandboxConfig` in `apps/judge/src/sandbox.ts`. */
export interface TaskIndependentSandboxConfig {
  executable?: string;
  script?: string;
  parameters: string[];
  stackSize?: number;
  process: number;
  stdin?: string | FileDescriptor;
  stdout?: string | FileDescriptor;
  stderr?: string | FileDescriptor;
  environments?: OverridableRecord<string, string>;
}

/** Mirror of `SandboxConfigBase` in `apps/judge/src/sandbox.ts`. */
export interface SandboxConfigBase extends TaskIndependentSandboxConfig {
  time: number;
  memory: number;
  workingDirectory: string;
  preservedFileDescriptors?: FileDescriptor[];
}

/** Mirror of `CompilationConfig` in `apps/judge/src/compile.ts`. */
export interface CompilationConfig extends SandboxConfigBase {
  messageFile?: string;
  extraInfoFile?: string;
  workingDirectory: string;
}

/**
 * Mirror of `LanguageConfig<T>` in `apps/judge/src/languages/index.ts`, including its function members. `T` is the
 * per-language compile-and-run option payload; the registry returns it as `LanguageConfig<unknown>` because the raw
 * request payload is narrowed only once a language has been selected.
 */
export interface LanguageConfig<T = unknown> {
  /** The name of the language, e.g. `"cpp"`. */
  name: string;

  getMetaOptions: (compileAndRunOptions: T) => {
    /** The user-submitted source file will be named with this name, e.g. `"main.cpp"`. */
    sourceFilename: string;
    /** The maximum allowed size of the binary directory; exceeding it reports a compile error. */
    binarySizeLimit: number;
  };

  /** Returns the options for running the compiler in the sandbox. */
  compile: (options: {
    sourceDirectoryInside: string;
    sourcePathInside: string;
    binaryDirectoryInside: string;
    compileAndRunOptions: T;
  }) => CompilationConfig;

  /** Returns the options for running the compiled program in the sandbox. */
  run: (options: {
    binaryDirectoryInside: string;
    workingDirectoryInside: string;
    compileAndRunOptions: T;
    time: number;
    memory: number;
    stdinFile?: string | FileDescriptor;
    stdoutFile?: string | FileDescriptor;
    stderrFile?: string | FileDescriptor;
    /** Parameters passed by command line, mainly used by custom checkers. */
    parameters?: string[];
    /** The content of the extra-info file produced by compilation. */
    compileResultExtraInfo?: string;
  }) => TaskIndependentSandboxConfig;
}

/**
 * The `languageRegistry` service. Mirrors the judge's language lookup surface: `getLanguage` returns the matching
 * `LanguageConfig` and throws for an unknown name, and `names` exposes the supported language names.
 */
export interface LanguageRegistry {
  getLanguage(name: string): LanguageConfig;

  readonly names: string[];
}
