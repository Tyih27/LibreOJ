import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHECKER_REGISTRY,
  LANGUAGE_REGISTRY,
  type CheckerRegistry,
  type CheckerTypeCustom,
  type CustomChecker,
  type LanguageConfig,
  type LanguageRegistry
} from "./index";

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

test("CHECKER_REGISTRY names the judge checker service", () => {
  assert.equal(CHECKER_REGISTRY, "checkerRegistry");
});

test("CheckerRegistry shape accepts a minimal custom checker", () => {
  const checker: CheckerTypeCustom = {
    type: "custom",
    interface: "testlib",
    language: "cpp",
    compileAndRunOptions: {},
    filename: "checker.cpp"
  };

  const custom: CustomChecker = {
    validate(c) {
      return c.language === "cpp" ? "" : "testlib checkers must be written in C++";
    },
    async runChecker(_c, _input, _output, _answer, _code, _workingDirectory, runSandboxForCustomChecker) {
      const result = await runSandboxForCustomChecker("", "", "");
      return { score: result.status === 0 ? 100 : 0 };
    }
  };

  const registry: CheckerRegistry = {
    interfaces: ["testlib"],
    getCustomChecker(name) {
      if (name !== "testlib") throw new Error(`Unsupported checker interface: ${name}`);
      return custom;
    }
  };

  assert.deepEqual(registry.interfaces, ["testlib"]);
  assert.equal(registry.getCustomChecker("testlib"), custom);
  assert.throws(() => registry.getCustomChecker("nope"), /Unsupported checker interface: nope/);
  assert.equal(registry.getCustomChecker("testlib").validate?.(checker), "");
});
