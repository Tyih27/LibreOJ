import { LANGUAGE_REGISTRY, type LanguageRegistry } from "@libreoj/plugin-api";

import { CompilationConfig } from "../compile";
import { FileDescriptor } from "../posixUtils";
import { TaskIndependentSandboxConfig } from "../sandbox";
import { getPluginHost } from "../plugin/plugin-host";

export interface LanguageConfig<T> {
  /**
   * The name of the langauge e.g. "cpp".
   */
  name: string;

  getMetaOptions: (compileAndRunOptions: T) => {
    /**
     * The user submitted source file will be named with the name e.g. "main.cpp"
     */
    sourceFilename: string;
    /**
     * The maximum binary size allowed (for the entire binary directory), will report a CompileError on exceeding
     */
    binarySizeLimit: number;
  };

  /**
   * Return the options for running the compiler in the sandbox.
   */
  compile: (options: {
    /**
     * The directory of the saved source code file
     */
    sourceDirectoryInside: string;
    /**
     * The path of the saved source code file
     */
    sourcePathInside: string;
    /**
     * The directory for the compiled binary file
     */
    binaryDirectoryInside: string;
    /**
     * Custom options passed by user
     */
    compileAndRunOptions: T;
  }) => CompilationConfig;

  /**
   * Return the options for running the compiled program in the sandbox.
   *
   * @note Remember to use `merge` if you want to override environments.
   */
  run: (options: {
    /**
     * The directory of the compiled binary
     */
    binaryDirectoryInside: string;
    /**
     * The working directory for the user's program, also for the input / output files
     */
    workingDirectoryInside: string;
    /**
     * Custom options passed by user
     */
    compileAndRunOptions: T;
    /**
     * The time limit by the problem
     */
    time: number;
    /**
     * The memory limit by the problem
     */
    memory: number;
    stdinFile?: string | FileDescriptor;
    stdoutFile?: string | FileDescriptor;
    stderrFile?: string | FileDescriptor;
    /**
     * The parameters passed by command line, mainly used by custom checkers
     */
    parameters?: string[];
    /**
     * The content of extra info file from compilation
     */
    compileResultExtraInfo?: string;
  }) => TaskIndependentSandboxConfig;
}

const languageList = [
  "cpp",
  "c",
  "java",
  "kotlin",
  "pascal",
  "python",
  "rust",
  "swift",
  "go",
  "haskell",
  "csharp",
  "fsharp"
];

/* eslint-disable import/no-dynamic-require */
/* eslint-disable @typescript-eslint/no-var-requires */
const langauges: Record<string, LanguageConfig<unknown>> = Object.fromEntries(
  (languageList.map(name => require(`./${name}`).languageConfig) as LanguageConfig<unknown>[]).map(language => [
    language.name,
    language
  ])
);
/* eslint-enable import/no-dynamic-require */
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Internal lookup over the loaded language configs. The language-registry provider is backed by this function, so it
 * reads the judge's own `LanguageConfig` objects without going through the seam (which would be circular: `getLanguage`
 * below resolves the registry from it).
 */
export function getLanguageConfig(language: string): LanguageConfig<unknown> {
  const languageConfig = langauges[language];
  if (!languageConfig) {
    throw new Error(`Unsupported code language: ${language}`);
  }
  return languageConfig;
}

/** The supported language names, as a copy so the internal list cannot be mutated through the registry seam. */
export function getLanguageNames(): string[] {
  return [...languageList];
}

/**
 * Resolves a language through the `languageRegistry` seam. The provider registered by the languages plugin is backed by
 * {@link getLanguageConfig}, so this keeps the existing lookup behavior and error message while making the registry the
 * single source of truth.
 */
export default function getLanguage(language: string): LanguageConfig<unknown> {
  const registry = getPluginHost().root.get<LanguageRegistry>(LANGUAGE_REGISTRY);
  // The provider hands back this module's own `LanguageConfig` objects; the seam re-declares the same shape in a
  // separate workspace, so the judge-side type is recovered for the existing call sites.
  return registry.getLanguage(language) as LanguageConfig<unknown>;
}
