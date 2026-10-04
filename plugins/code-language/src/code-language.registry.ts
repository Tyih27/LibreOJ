import { plainToClass } from "class-transformer";
import { validateSync } from "class-validator";

import { CodeLanguage, type CodeLanguageRegistry, type CodeLanguageValidationError } from "@libreoj/plugin-api";

import CompileAndRunOptionsCpp from "./compile-and-run-options/cpp";
import CompileAndRunOptionsC from "./compile-and-run-options/c";
import CompileAndRunOptionsJava from "./compile-and-run-options/java";
import CompileAndRunOptionsKotlin from "./compile-and-run-options/kotlin";
import CompileAndRunOptionsPascal from "./compile-and-run-options/pascal";
import CompileAndRunOptionsPython from "./compile-and-run-options/python";
import CompileAndRunOptionsRust from "./compile-and-run-options/rust";
import CompileAndRunOptionsSwift from "./compile-and-run-options/swift";
import CompileAndRunOptionsGo from "./compile-and-run-options/go";
import CompileAndRunOptionsHaskell from "./compile-and-run-options/haskell";
import CompileAndRunOptionsCSharp from "./compile-and-run-options/csharp";
import CompileAndRunOptionsFSharp from "./compile-and-run-options/fsharp";

const CompileAndRunOptionsClasses: Record<CodeLanguage, new () => object> = {
  [CodeLanguage.Cpp]: CompileAndRunOptionsCpp,
  [CodeLanguage.C]: CompileAndRunOptionsC,
  [CodeLanguage.Java]: CompileAndRunOptionsJava,
  [CodeLanguage.Kotlin]: CompileAndRunOptionsKotlin,
  [CodeLanguage.Pascal]: CompileAndRunOptionsPascal,
  [CodeLanguage.Python]: CompileAndRunOptionsPython,
  [CodeLanguage.Rust]: CompileAndRunOptionsRust,
  [CodeLanguage.Swift]: CompileAndRunOptionsSwift,
  [CodeLanguage.Go]: CompileAndRunOptionsGo,
  [CodeLanguage.Haskell]: CompileAndRunOptionsHaskell,
  [CodeLanguage.CSharp]: CompileAndRunOptionsCSharp,
  [CodeLanguage.FSharp]: CompileAndRunOptionsFSharp
};

/**
 * The plugin's `CodeLanguageRegistry` implementation. It reproduces the backend's former `CodeLanguageService`
 * verbatim: subclass the per-language options class and `validateSync` it with `whitelist` and
 * `forbidNonWhitelisted`, so an option object with an unknown property is reported rather than silently stripped.
 *
 * An unknown `language` yields `undefined` from the lookup and therefore the same error `plainToClass` raised in the
 * backend, keeping that edge case behaviour-equivalent.
 */
export class CodeLanguageRegistryService implements CodeLanguageRegistry {
  /** The languages this registry can validate, in declaration order. */
  readonly languages: readonly CodeLanguage[] = Object.values(CodeLanguage);

  validateCompileAndRunOptions(language: CodeLanguage, compileAndRunOptions: unknown): CodeLanguageValidationError[] {
    return validateSync(plainToClass(CompileAndRunOptionsClasses[language], compileAndRunOptions), {
      whitelist: true,
      forbidNonWhitelisted: true
    });
  }
}
