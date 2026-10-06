import { test } from "node:test";
import assert from "node:assert/strict";

import { nativeImporter } from "../src/problem-data-import/native";
import { createProblemDataImporterRegistry } from "../src/problem-data-import/registry";
import { uojConfigImporter } from "../src/problem-data-import/uoj-config";
import type { ImportContext } from "../src/problem-data-import/importer";
import { CodeLanguage } from "../src/code-language/code-language.type";
import type { ProblemFileEntity } from "../src/problem/problem-file.entity";

function file(filename: string, content?: string): ProblemFileEntity {
  return { filename, content } as ProblemFileEntity;
}

const TRADITIONAL: ImportContext = { mode: "input-to-output", optional: false, problemType: "traditional" };
const INTERACTION: ImportContext = { mode: "input-to-output", optional: true, problemType: "interaction" };
const SUBMIT_ANSWER: ImportContext = { mode: "output-to-input", optional: true, problemType: "submit-answer" };

test("detect: recognizes config filenames case-insensitively when readable", () => {
  assert.equal(uojConfigImporter.detect([file("SubTasks.JSON", "{}")], TRADITIONAL), true);
  assert.equal(uojConfigImporter.detect([file("DATA.YML", "subtasks: []")], TRADITIONAL), true);
  assert.equal(uojConfigImporter.detect([file("data.yaml", "{}")], TRADITIONAL), true);
  assert.equal(uojConfigImporter.detect([file("data.yml")], TRADITIONAL), false, "no content -> not detected");
  assert.equal(uojConfigImporter.detect([file("1.in"), file("1.out")], TRADITIONAL), false);
});

test("parses subtasks.json, expands # templates and maps type -> scoringType", () => {
  const config = {
    subtasks: [
      { score: 40, type: "sum", cases: [1, 2] },
      { score: 60, type: "min", cases: [3] }
    ],
    inputFile: "test#.in",
    outputFile: "test#.out",
    userOutput: "user#.txt"
  };
  const testData = [
    file("subtasks.json", JSON.stringify(config)),
    file("test1.in"),
    file("test1.out"),
    file("test2.in"),
    file("test2.out"),
    file("test3.in"),
    file("test3.out")
  ];

  const result = uojConfigImporter.import(testData, TRADITIONAL);
  assert.equal(result.subtasks.length, 2);

  const [first, second] = result.subtasks;
  assert.equal(first.scoringType, "Sum");
  assert.equal(first.points, 40);
  assert.deepEqual(
    first.testcases.map(tc => [tc.inputFile, tc.outputFile, tc.userOutputFilename]),
    [
      ["test1.in", "test1.out", "user1.txt"],
      ["test2.in", "test2.out", "user2.txt"]
    ]
  );

  assert.equal(second.scoringType, "GroupMin");
  assert.equal(second.points, 60);
  assert.deepEqual(second.testcases.map(tc => tc.inputFile), ["test3.in"]);
  assert.equal(result.checker, undefined);
});

test("parses data.yml (YAML) and maps mul -> GroupMul", () => {
  const yamlConfig = [
    "subtasks:",
    "  - score: 100",
    "    type: mul",
    "    cases: [5]",
    "inputFile: 'a#.in'",
    "outputFile: 'a#.out'"
  ].join("\n");
  const testData = [file("DATA.YML", yamlConfig), file("a5.in"), file("a5.out")];

  const result = uojConfigImporter.import(testData, TRADITIONAL);
  assert.equal(result.subtasks[0].scoringType, "GroupMul");
  assert.equal(result.subtasks[0].testcases[0].inputFile, "a5.in");
  assert.equal(result.subtasks[0].testcases[0].outputFile, "a5.out");
});

test("explicit testcases use their own fields and expand # with caseId", () => {
  const config = {
    subtasks: [
      {
        score: 100,
        type: "sum",
        testcases: [
          { caseId: 7, inputFile: "x#.in", outputFile: "x#.out", points: 10, timeLimit: 500, memoryLimit: 256 }
        ]
      }
    ]
  };
  const testData = [file("subtasks.json", JSON.stringify(config)), file("x7.in"), file("x7.out")];

  const result = uojConfigImporter.import(testData, TRADITIONAL);
  const testcase = result.subtasks[0].testcases[0];
  assert.equal(testcase.inputFile, "x7.in");
  assert.equal(testcase.outputFile, "x7.out");
  assert.equal(testcase.points, 10);
  assert.equal(testcase.timeLimit, 500);
  assert.equal(testcase.memoryLimit, 256);
});

test("specialJudge becomes a custom checker defaulting to testlib", () => {
  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    inputFile: "t#.in",
    outputFile: "t#.out",
    specialJudge: { language: "cpp11", fileName: "spj_cpp11.cpp" }
  };
  const testData = [
    file("subtasks.json", JSON.stringify(config)),
    file("t1.in"),
    file("t1.out"),
    file("spj_cpp11.cpp")
  ];

  const checker = uojConfigImporter.import(testData, TRADITIONAL).checker as unknown as {
    type: string;
    interface: string;
    filename: string;
    language: string;
    compileAndRunOptions: { std: string };
  };
  assert.equal(checker.type, "custom");
  assert.equal(checker.interface, "testlib");
  assert.equal(checker.filename, "spj_cpp11.cpp");
  assert.equal(checker.language, CodeLanguage.Cpp);
  assert.equal(checker.compileAndRunOptions.std, "c++11");
});

test("specialJudge honours an explicit interface when choosing the C++ standard", () => {
  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    inputFile: "t#.in",
    outputFile: "t#.out",
    specialJudge: { language: "cpp", fileName: "spj.cpp", interface: "legacy" }
  };
  const testData = [file("subtasks.json", JSON.stringify(config)), file("t1.in"), file("t1.out"), file("spj.cpp")];

  const checker = uojConfigImporter.import(testData, TRADITIONAL).checker as unknown as {
    interface: string;
    compileAndRunOptions: { std: string };
  };
  assert.equal(checker.interface, "legacy");
  assert.equal(checker.compileAndRunOptions.std, "c++03");
});

test("interaction produces an interactor and no checker, output file not required", () => {
  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    inputFile: "i#.in",
    interactor: { language: "cpp", fileName: "interactor.cpp" }
  };
  const testData = [file("subtasks.json", JSON.stringify(config)), file("i1.in"), file("interactor.cpp")];

  const result = uojConfigImporter.import(testData, INTERACTION);
  assert.equal(result.interactor.interface, "stdio");
  assert.equal(result.interactor.filename, "interactor.cpp");
  assert.equal(result.interactor.language, CodeLanguage.Cpp);
  assert.equal(result.checker, undefined);
  assert.equal(result.subtasks[0].testcases[0].inputFile, "i1.in");
});

test("extraSourceFiles are grouped by language, skipping duplicates and invalid destinations", () => {
  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    inputFile: "t#.in",
    outputFile: "t#.out",
    extraSourceFiles: [
      { language: "cpp", files: [{ name: "grader.cpp", dest: "grader.cpp" }, { name: "bad.cpp", dest: "a/b" }] },
      { language: "cpp", files: [{ name: "ignored.cpp", dest: "ignored.cpp" }] },
      { language: "python3", files: [{ name: "helper.py", dest: "helper.py" }] }
    ]
  };
  const testData = [file("subtasks.json", JSON.stringify(config)), file("t1.in"), file("t1.out")];

  const { extraSourceFiles } = uojConfigImporter.import(testData, TRADITIONAL);
  assert.deepEqual(extraSourceFiles, {
    [CodeLanguage.Cpp]: { "grader.cpp": "grader.cpp" },
    [CodeLanguage.Python]: { "helper.py": "helper.py" }
  });
});

test("submit-answer needs no input file and does not emit interactor/extraSourceFiles", () => {
  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    outputFile: "ans#.out",
    specialJudge: { language: "cpp11", fileName: "spj.cpp" },
    extraSourceFiles: [{ language: "cpp", files: [{ name: "g.cpp", dest: "g.cpp" }] }]
  };
  const testData = [file("subtasks.json", JSON.stringify(config)), file("ans1.out"), file("spj.cpp")];

  const result = uojConfigImporter.import(testData, SUBMIT_ANSWER);
  assert.equal(result.subtasks[0].testcases[0].inputFile, undefined);
  assert.equal(result.subtasks[0].testcases[0].outputFile, "ans1.out");
  assert.equal(result.checker.type, "custom");
  assert.equal(result.interactor, undefined);
  assert.equal(result.extraSourceFiles, undefined);
});

test("missing referenced files raise a clear error", () => {
  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    inputFile: "t#.in",
    outputFile: "t#.out",
    specialJudge: { language: "cpp11", fileName: "missing_spj.cpp" }
  };
  const testData = [file("subtasks.json", JSON.stringify(config)), file("t1.in"), file("t1.out")];

  assert.throws(() => uojConfigImporter.import(testData, TRADITIONAL), /missing: missing_spj\.cpp/);
});

test("malformed JSON and unsupported subtask types raise clear errors", () => {
  assert.throws(() => uojConfigImporter.import([file("subtasks.json", "{ not json")], TRADITIONAL), /as JSON/);

  const invalidType = { subtasks: [{ score: 100, type: "xor", cases: [1] }], inputFile: "t#.in", outputFile: "t#.out" };
  assert.throws(
    () =>
      uojConfigImporter.import(
        [file("subtasks.json", JSON.stringify(invalidType)), file("t1.in"), file("t1.out")],
        TRADITIONAL
      ),
    /Unsupported subtask type "xor"/
  );
});

test("registry prefers the authoritative config importer and falls back to native", () => {
  const registry = createProblemDataImporterRegistry([uojConfigImporter, nativeImporter]);

  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    inputFile: "t#.in",
    outputFile: "t#.out"
  };
  const withConfig = [file("subtasks.json", JSON.stringify(config)), file("t1.in"), file("t1.out")];
  assert.equal(registry.resolve(withConfig, TRADITIONAL).name, "uoj-data-config");

  const configWithoutContent = [file("subtasks.json"), file("1.in"), file("1.out")];
  assert.equal(registry.resolve(configWithoutContent, TRADITIONAL).name, "libreoj-native");

  const plain = [file("1.in"), file("1.out")];
  assert.equal(registry.resolve(plain, TRADITIONAL).name, "libreoj-native");

  const nativeResult = nativeImporter.import(plain, TRADITIONAL);
  assert.equal(nativeResult.subtasks.length, 1);
  assert.deepEqual(nativeResult.subtasks[0].testcases, [{ inputFile: "1.in", outputFile: "1.out" }]);
});
