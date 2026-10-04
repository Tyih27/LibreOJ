import * as assert from "node:assert/strict";
import { test } from "node:test";

import { CODE_LANGUAGE_REGISTRY, CodeLanguage, type CodeLanguageRegistry } from "@libreoj/plugin-api";
import { InlineResolver, PluginHost } from "@libreoj/plugin-core";

import { CodeLanguageRegistryService, codeLanguagePlugin } from "./index";

const registry = new CodeLanguageRegistryService();

/** One valid compile-and-run options object per language. */
const validOptions: Record<CodeLanguage, unknown> = {
  [CodeLanguage.Cpp]: { compiler: "g++", std: "c++17", O: "2", m: "x32" },
  [CodeLanguage.C]: { compiler: "clang", std: "c99", O: "2", m: "32" },
  [CodeLanguage.Java]: {},
  [CodeLanguage.Kotlin]: { version: "1.8", platform: "jvm" },
  [CodeLanguage.Pascal]: { optimize: "2" },
  [CodeLanguage.Python]: { version: "3.9" },
  [CodeLanguage.Swift]: { version: "5", optimize: "O" },
  [CodeLanguage.Rust]: { version: "2021", optimize: "2" },
  [CodeLanguage.Go]: { version: "1.x" },
  [CodeLanguage.Haskell]: { version: "2010" },
  [CodeLanguage.CSharp]: { version: "8" },
  [CodeLanguage.FSharp]: {}
};

test("accepts one valid options object per supported language", () => {
  for (const language of Object.values(CodeLanguage)) {
    assert.deepEqual(registry.validateCompileAndRunOptions(language, validOptions[language]), [], language);
  }
});

test("reports an out-of-range value with a constraint on the property", () => {
  const errors = registry.validateCompileAndRunOptions(CodeLanguage.Cpp, {
    compiler: "g++",
    std: "c++99",
    O: "2",
    m: "x32"
  });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].property, "std");
  assert.ok(errors[0].constraints?.isIn);
});

test("rejects a non-whitelisted property", () => {
  const errors = registry.validateCompileAndRunOptions(CodeLanguage.Python, { version: "3.9", extra: true });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].property, "extra");
  assert.ok(errors[0].constraints?.whitelistValidation);
});

test("rejects a missing required property", () => {
  const errors = registry.validateCompileAndRunOptions(CodeLanguage.Cpp, {});

  assert.deepEqual(errors.map(error => error.property).sort(), ["O", "compiler", "m", "std"]);
});

test("skips per-language constraints for an unknown language, matching the backend", () => {
  // The backend indexed its class map with the language and passed the (possibly undefined) class straight into
  // plainToClass, so an unknown language simply has no per-language constraints instead of being rejected.
  assert.deepEqual(registry.validateCompileAndRunOptions("brainfuck" as CodeLanguage, {}), []);

  const errors = registry.validateCompileAndRunOptions("brainfuck" as CodeLanguage, { compiler: "g++" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].property, "compiler");
  assert.ok(errors[0].constraints?.whitelistValidation);
});

test("enumerates the supported languages", () => {
  assert.deepEqual(registry.languages, Object.values(CodeLanguage));
});

test("registers the registry under CODE_LANGUAGE_REGISTRY on a host context", async () => {
  const host = new PluginHost({
    resolver: new InlineResolver({ "@libreoj/plugin-code-language": codeLanguagePlugin })
  });

  try {
    await host.load([{ bundles: ["@libreoj/plugin-code-language"] }]);

    const fromContext = host.root.get<CodeLanguageRegistry>(CODE_LANGUAGE_REGISTRY);
    assert.equal(typeof fromContext.validateCompileAndRunOptions, "function");
    assert.deepEqual(
      fromContext.validateCompileAndRunOptions(CodeLanguage.Rust, { version: "2018", optimize: "1" }),
      []
    );
  } finally {
    await host.dispose();
  }
});
