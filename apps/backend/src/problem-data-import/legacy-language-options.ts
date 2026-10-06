import { Logger } from "@nestjs/common";

import { CodeLanguage } from "../code-language/code-language.type";

/**
 * Maps an old (pre-import) language name to the current {@link CodeLanguage} and its compile-and-run options.
 *
 * Moved verbatim out of `migration/migrations/problem.ts` so both the legacy migration and the UOJ data config
 * importer can share it. Its behaviour must not change: it is the source of truth for migrating old language names.
 */
export function getLanguageAndOptions(
  oldLanguageName: string,
  errorObjectDescription: string,
  onUnknownReturnDefault = true,
  ensureCppAtLeast11 = false
): { language: CodeLanguage; compileAndRunOptions: unknown } {
  oldLanguageName = oldLanguageName || "";

  switch (oldLanguageName) {
    case "cpp":
      return {
        language: CodeLanguage.Cpp,
        compileAndRunOptions: {
          compiler: "g++",
          std: ensureCppAtLeast11 ? "c++11" : "c++03",
          O: "2",
          m: "x32"
        }
      };
    case "cpp11":
      return {
        language: CodeLanguage.Cpp,
        compileAndRunOptions: {
          compiler: "g++",
          std: "c++11",
          O: "2",
          m: "x32"
        }
      };
    case "cpp17":
      return {
        language: CodeLanguage.Cpp,
        compileAndRunOptions: {
          compiler: "g++",
          std: "c++17",
          O: "2",
          m: "x32"
        }
      };
    case "cpp-noilinux":
      return {
        language: CodeLanguage.Cpp,
        compileAndRunOptions: {
          compiler: "g++",
          std: "c++03",
          O: "2",
          m: "32"
        }
      };
    case "cpp11-noilinux":
      return {
        language: CodeLanguage.Cpp,
        compileAndRunOptions: {
          compiler: "g++",
          std: "c++11",
          O: "2",
          m: "32"
        }
      };
    case "cpp11-clang":
      return {
        language: CodeLanguage.Cpp,
        compileAndRunOptions: {
          compiler: "clang++",
          std: "c++11",
          O: "2",
          m: "x32"
        }
      };
    case "cpp17-clang":
      return {
        language: CodeLanguage.Cpp,
        compileAndRunOptions: {
          compiler: "clang++",
          std: "c++17",
          O: "2",
          m: "x32"
        }
      };
    case "c":
      return {
        language: CodeLanguage.C,
        compileAndRunOptions: {
          compiler: "clang",
          std: "c99",
          O: "2",
          m: "x32"
        }
      };
    case "c-noilinux":
      return {
        language: CodeLanguage.C,
        compileAndRunOptions: {
          compiler: "clang",
          std: "c99",
          O: "2",
          m: "32"
        }
      };
    case "csharp":
      return {
        language: CodeLanguage.CSharp,
        compileAndRunOptions: {
          version: "7.3"
        }
      };
    case "java":
      return {
        language: CodeLanguage.Java,
        compileAndRunOptions: {}
      };
    case "pascal":
      return {
        language: CodeLanguage.Pascal,
        compileAndRunOptions: {
          optimize: "2"
        }
      };
    case "python2":
      return {
        language: CodeLanguage.Python,
        compileAndRunOptions: {
          version: "2.7"
        }
      };
    case "python3":
      return {
        language: CodeLanguage.Python,
        compileAndRunOptions: {
          version: "3.6"
        }
      };
    case "haskell":
      return {
        language: CodeLanguage.Haskell,
        compileAndRunOptions: {
          version: "2010"
        }
      };
    case "nodejs":
    case "ruby":
    case "lua":
    case "luajit":
    case "vala":
    case "ocaml":
    case "vbnet":
    // no default
  }

  if (!onUnknownReturnDefault) return null;

  Logger.warn(`Unsupported language "${oldLanguageName}" while processing ${errorObjectDescription}. Default to C++.`);
  return {
    language: CodeLanguage.Cpp,
    compileAndRunOptions: {
      compiler: "g++",
      std: "c++20",
      O: "2",
      m: "64"
    }
  };
}
