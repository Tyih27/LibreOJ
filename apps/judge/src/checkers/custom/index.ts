import { CHECKER_REGISTRY, type CheckerRegistry, type CustomChecker as CustomCheckerSeam } from "@libreoj/plugin-api";

import { CpuAffinityStrategy, SANDBOX_INSIDE_PATH_BINARY } from "../../sandbox";
import { CompileResultSuccess } from "../../compile";
import getLanguage from "../../languages";
import { getPluginHost } from "../../plugin/plugin-host";
import { getSandbox } from "../../plugin/services";
import { ConfigurationError } from "../../error";
import { MappedPath } from "../../utils";

import { CheckerTypeCustom } from "..";

/**
 * A custom checker interface. It extends the `checkerRegistry` seam's `CustomChecker` so the compiler enforces the
 * contract a provider must satisfy across the package boundary; the concrete implementations live in the sibling
 * modules below and are unchanged.
 */
export interface CustomChecker extends CustomCheckerSeam {}

/* eslint-disable @typescript-eslint/no-var-requires */
const customCheckerInterfaces: Record<string, CustomChecker> = {
  testlib: require("./testlib").checker,
  legacy: require("./legacy").checker,
  lemon: require("./lemon").checker,
  hustoj: require("./hustoj").checker,
  qduoj: require("./qduoj").checker,
  domjudge: require("./domjudge").checker
};
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Internal lookup over the judge's own custom checkers. The `checkerRegistry` provider is backed by this function, so
 * it reads the concrete implementations without going through the seam (which would be circular: the exports below
 * resolve the registry from it).
 *
 * An unknown name throws. The previous direct `customCheckerInterfaces[name]` lookup also failed on an unknown name,
 * but with an incidental `TypeError` from dereferencing `undefined`; this makes the failure explicit.
 */
export function getCustomCheckerInterface(name: string): CustomChecker {
  const checker = customCheckerInterfaces[name];
  if (!checker) throw new Error(`Unsupported custom checker interface: ${name}`);
  return checker;
}

/** The supported custom checker interface names, frozen so the seam cannot be used to mutate the internal key set. */
export const customCheckerInterfaceNames: readonly string[] = Object.freeze(Object.keys(customCheckerInterfaces));

/**
 * This is called BEFORE compiling the checker to detect some problems that will cause the
 * successfully compiled checker's not usable.
 *
 * e.g. a testlib checker could only be written in the cpp language.
 */
export function validateCustomChecker(checker: CheckerTypeCustom) {
  const registry = getPluginHost().root.get<CheckerRegistry>(CHECKER_REGISTRY);
  const customChecker = registry.getCustomChecker(checker.interface);
  if (customChecker.validate) {
    const error = customChecker.validate(checker);
    if (error) throw new ConfigurationError(`Invalid custom checker config: ${error}`);
  }
}

export async function runCustomChecker(
  taskId: string,
  checker: CheckerTypeCustom,
  timeLimit: number,
  memoryLimit: number,
  checkerCompileResult: CompileResultSuccess,
  inputFile: MappedPath,
  outputFile: MappedPath,
  answerFile: MappedPath,
  code: string,
  workingDirectory: MappedPath,
  tempDirectoryOutside: string
) {
  const registry = getPluginHost().root.get<CheckerRegistry>(CHECKER_REGISTRY);
  const customChecker = registry.getCustomChecker(checker.interface);
  return await customChecker.runChecker(
    checker,
    inputFile,
    outputFile,
    answerFile,
    code,
    workingDirectory,
    async (stdin, stdout, stderr, parameters) =>
      await getSandbox().runSandbox(taskId, {
        ...getLanguage(checker.language).run({
          binaryDirectoryInside: SANDBOX_INSIDE_PATH_BINARY,
          workingDirectoryInside: workingDirectory.inside,
          compileAndRunOptions: checker.compileAndRunOptions,
          time: timeLimit,
          memory: memoryLimit,
          stdinFile: stdin,
          stdoutFile: stdout,
          stderrFile: stderr,
          parameters,
          compileResultExtraInfo: checkerCompileResult.extraInfo
        }),
        time: timeLimit,
        memory: memoryLimit * 1024 * 1024,
        workingDirectory: workingDirectory.inside,
        tempDirectoryOutside,
        extraMounts: [
          {
            mappedPath: {
              outside: checkerCompileResult.binaryDirectory,
              inside: SANDBOX_INSIDE_PATH_BINARY
            },
            readOnly: true
          },
          {
            mappedPath: workingDirectory,
            readOnly: false
          }
        ],
        cpuAffinity: CpuAffinityStrategy.Checker
      })
  );
}
