import * as assert from "node:assert/strict";
import { test } from "node:test";

import { CODE_LANGUAGE_REGISTRY, CodeLanguage, type CodeLanguageRegistry } from "./index";

test("CODE_LANGUAGE_REGISTRY names the code-language service", () => {
  assert.equal(CODE_LANGUAGE_REGISTRY, "codeLanguageRegistry");
});

test("CodeLanguage enumerates the backend language set", () => {
  assert.deepEqual(Object.values(CodeLanguage), [
    "cpp",
    "c",
    "java",
    "kotlin",
    "pascal",
    "python",
    "swift",
    "rust",
    "go",
    "haskell",
    "csharp",
    "fsharp"
  ]);
});

test("CodeLanguageRegistry shape accepts a validating provider", () => {
  const registry: CodeLanguageRegistry = {
    validateCompileAndRunOptions(language, compileAndRunOptions) {
      assert.ok(Object.values(CodeLanguage).includes(language));
      assert.equal(typeof compileAndRunOptions, "object");
      return [];
    }
  };

  assert.deepEqual(registry.validateCompileAndRunOptions(CodeLanguage.Cpp, {}), []);
});
