import * as assert from "node:assert/strict";
import { test } from "node:test";

import { LANGUAGE_REGISTRY, type LanguageConfig, type LanguageRegistry } from "./index";

test("LANGUAGE_REGISTRY names the judge language service", () => {
  assert.equal(LANGUAGE_REGISTRY, "languageRegistry");
});

test("LanguageRegistry shape accepts a minimal judge provider", () => {
  const cpp: LanguageConfig = {
    name: "cpp",
    getMetaOptions: () => ({ sourceFilename: "main.cpp", binarySizeLimit: 5 * 1024 * 1024 }),
    compile: () => ({ parameters: [], process: 20, time: 10000, memory: 1024, workingDirectory: "/sandbox/binary" }),
    run: () => ({ parameters: [], process: 1 })
  };

  const registry: LanguageRegistry = {
    names: ["cpp"],
    getLanguage(name) {
      if (name !== cpp.name) throw new Error(`Unsupported code language: ${name}`);
      return cpp;
    }
  };

  assert.deepEqual(registry.names, ["cpp"]);
  assert.equal(registry.getLanguage("cpp").name, "cpp");
  assert.throws(() => registry.getLanguage("nope"), /Unsupported code language: nope/);
  assert.deepEqual(registry.getLanguage("cpp").getMetaOptions(undefined), {
    sourceFilename: "main.cpp",
    binarySizeLimit: 5 * 1024 * 1024
  });
  assert.deepEqual(
    registry.getLanguage("cpp").run({
      binaryDirectoryInside: "/sandbox/binary",
      workingDirectoryInside: "/sandbox/working",
      compileAndRunOptions: undefined,
      time: 1000,
      memory: 1024
    }),
    { parameters: [], process: 1 }
  );
});
