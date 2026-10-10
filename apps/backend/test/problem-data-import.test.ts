import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { nativeImporter } from "../src/problem-data-import/native";
import { polygonImporter } from "../src/problem-data-import/polygon";
import { createProblemDataImporterRegistry } from "../src/problem-data-import/registry";
import { uojConfigImporter } from "../src/problem-data-import/uoj-config";
import { buildUojSamples, uojProblemConfImporter } from "../src/problem-data-import/uoj-problem-conf";
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

test("specialJudge without an explicit interface detects testlib from the source including testlib.h", () => {
  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    inputFile: "t#.in",
    outputFile: "t#.out",
    specialJudge: { language: "cpp", fileName: "spj.cpp" }
  };
  const testData = [
    file("subtasks.json", JSON.stringify(config)),
    file("t1.in"),
    file("t1.out"),
    file("spj.cpp", '#include "testlib.h"')
  ];

  const checker = uojConfigImporter.import(testData, TRADITIONAL).checker as unknown as {
    interface: string;
    compileAndRunOptions: { std: string };
  };
  assert.equal(checker.interface, "testlib");
  assert.equal(checker.compileAndRunOptions.std, "c++11");
});

test("specialJudge without an explicit interface falls back to legacy when the source omits testlib.h", () => {
  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    inputFile: "t#.in",
    outputFile: "t#.out",
    specialJudge: { language: "cpp", fileName: "spj.cpp" }
  };
  const testData = [
    file("subtasks.json", JSON.stringify(config)),
    file("t1.in"),
    file("t1.out"),
    file("spj.cpp", "#include <cstdio>\nint main() {}")
  ];

  const checker = uojConfigImporter.import(testData, TRADITIONAL).checker as unknown as {
    interface: string;
    compileAndRunOptions: { std: string };
  };
  assert.equal(checker.interface, "legacy");
  assert.equal(checker.compileAndRunOptions.std, "c++03");
});

test("specialJudge without an explicit interface keeps testlib when the source is not loaded", () => {
  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    inputFile: "t#.in",
    outputFile: "t#.out",
    specialJudge: { language: "cpp", fileName: "spj.cpp" }
  };
  const testData = [file("subtasks.json", JSON.stringify(config)), file("t1.in"), file("t1.out"), file("spj.cpp")];

  const checker = uojConfigImporter.import(testData, TRADITIONAL).checker as unknown as { interface: string };
  assert.equal(checker.interface, "testlib");
});

test("contentFilenames requests the special judge source only when the interface is implicit", () => {
  const implicit = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    specialJudge: { language: "cpp", fileName: "spj.cpp" }
  };
  const implicitData = [file("subtasks.json", JSON.stringify(implicit)), file("spj.cpp", '#include "testlib.h"')];
  assert.deepEqual(uojConfigImporter.contentFilenames?.(implicitData), ["spj.cpp"]);

  const explicit = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    specialJudge: { language: "cpp", fileName: "spj.cpp", interface: "legacy" }
  };
  const explicitData = [file("subtasks.json", JSON.stringify(explicit)), file("spj.cpp", "int main() {}")];
  assert.deepEqual(uojConfigImporter.contentFilenames?.(explicitData), []);

  assert.deepEqual(uojConfigImporter.contentFilenames?.([file("1.in"), file("1.out")]), []);
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

test("polygon detect: recognizes extension-less inputs paired with N.a, only for traditional", () => {
  assert.equal(polygonImporter.detect([file("1"), file("2"), file("1.a"), file("2.a")], TRADITIONAL), true);
  assert.equal(polygonImporter.detect([file("1.in"), file("1.out")], TRADITIONAL), false);
  assert.equal(polygonImporter.detect([file("3.a")], TRADITIONAL), false, "an answer without its input is not paired");
  assert.equal(polygonImporter.detect([file("1"), file("1.a")], INTERACTION), false);
  assert.equal(polygonImporter.detect([file("1"), file("1.a")], SUBMIT_ANSWER), false);
});

test("polygon import: emits one Sum subtask with numerically sorted pairs", () => {
  const testData = [file("2"), file("10"), file("1"), file("1.a"), file("10.a"), file("2.a")];

  const result = polygonImporter.import(testData, TRADITIONAL);
  assert.equal(result.subtasks.length, 1);
  assert.equal(result.subtasks[0].scoringType, "Sum");
  assert.deepEqual(result.subtasks[0].testcases, [
    { inputFile: "1", outputFile: "1.a" },
    { inputFile: "2", outputFile: "2.a" },
    { inputFile: "10", outputFile: "10.a" }
  ]);
});

test("registry orders polygon between the authoritative config and the native fallback", () => {
  const registry = createProblemDataImporterRegistry([uojConfigImporter, polygonImporter, nativeImporter]);

  const polygonData = [file("1"), file("2"), file("1.a"), file("2.a")];
  assert.equal(registry.resolve(polygonData, TRADITIONAL).name, "codeforces-polygon");

  const nativeData = [file("1.in"), file("1.out")];
  assert.equal(registry.resolve(nativeData, TRADITIONAL).name, "libreoj-native");

  const config = {
    subtasks: [{ score: 100, type: "sum", cases: [1] }],
    inputFile: "t#.in",
    outputFile: "t#.out"
  };
  const withConfig = [file("subtasks.json", JSON.stringify(config)), file("t1.in"), file("t1.out")];
  assert.equal(registry.resolve(withConfig, TRADITIONAL).name, "uoj-data-config");
});

function conf(lines: string[]): ProblemFileEntity {
  return file("problem.conf", lines.join("\n"));
}

test("problem.conf detect: recognizes problem.conf and outranks the data config importer", () => {
  assert.equal(uojProblemConfImporter.detect([file("PROBLEM.CONF", "n_tests 1")], TRADITIONAL), true);
  assert.equal(uojProblemConfImporter.detect([file("data.yml", "subtasks: []")], TRADITIONAL), false);

  const registry = createProblemDataImporterRegistry([uojProblemConfImporter, uojConfigImporter, nativeImporter]);
  const both = [
    file("problem.conf", "n_tests 1\nuse_builtin_judger on\nuse_builtin_checker ncmp"),
    file("data.yml", "subtasks: []")
  ];
  assert.equal(registry.resolve(both, TRADITIONAL).name, "uoj-problem-conf");
});

test("problem.conf parses the default filename template, n_tests and the builtin checker", () => {
  const testData = [
    conf(["n_tests 2", "time_limit 1", "memory_limit 256", "use_builtin_judger on", "use_builtin_checker ncmp"]),
    file("input1.txt"),
    file("output1.txt"),
    file("input2.txt"),
    file("output2.txt")
  ];

  const result = uojProblemConfImporter.import(testData, TRADITIONAL);
  assert.deepEqual(result.subtasks, [
    {
      scoringType: "Sum",
      testcases: [
        { inputFile: "input1.txt", outputFile: "output1.txt" },
        { inputFile: "input2.txt", outputFile: "output2.txt" }
      ]
    }
  ]);
  assert.deepEqual(result.checker, { type: "testlib", name: "ncmp" });
});

test("problem.conf honours input_pre/input_suf and output_pre/output_suf", () => {
  const testData = [
    conf([
      "n_tests 1",
      "input_pre dream",
      "input_suf in",
      "output_pre dream",
      "output_suf ans",
      "use_builtin_judger on",
      "use_builtin_checker ncmp"
    ]),
    file("dream1.in"),
    file("dream1.ans")
  ];

  const { subtasks } = uojProblemConfImporter.import(testData, TRADITIONAL);
  assert.deepEqual(subtasks[0].testcases, [{ inputFile: "dream1.in", outputFile: "dream1.ans" }]);
});

test("problem.conf maps n_subtasks/subtask_end_i/subtask_score_i into scored subtasks", () => {
  const testData = [
    conf([
      "n_tests 3",
      "use_builtin_judger on",
      "use_builtin_checker ncmp",
      "n_subtasks 2",
      "subtask_end_1 2",
      "subtask_score_1 40",
      "subtask_end_2 3",
      "subtask_score_2 60"
    ]),
    file("input1.txt"),
    file("output1.txt"),
    file("input2.txt"),
    file("output2.txt"),
    file("input3.txt"),
    file("output3.txt")
  ];

  const { subtasks } = uojProblemConfImporter.import(testData, TRADITIONAL);
  assert.equal(subtasks.length, 2);
  assert.equal(subtasks[0].scoringType, "Sum");
  assert.equal(subtasks[0].points, 40);
  assert.deepEqual(
    subtasks[0].testcases.map(tc => tc.inputFile),
    ["input1.txt", "input2.txt"]
  );
  assert.equal(subtasks[1].points, 60);
  assert.deepEqual(
    subtasks[1].testcases.map(tc => tc.inputFile),
    ["input3.txt"]
  );
});

test("problem.conf without n_subtasks yields one equal-weight Sum subtask", () => {
  const testData = [
    conf(["n_tests 1", "use_builtin_judger on", "use_builtin_checker ncmp"]),
    file("input1.txt"),
    file("output1.txt")
  ];

  const { subtasks } = uojProblemConfImporter.import(testData, TRADITIONAL);
  assert.equal(subtasks.length, 1);
  assert.equal(subtasks[0].scoringType, "Sum");
  assert.equal(subtasks[0].points, undefined);
});

test("problem.conf converts time_limit seconds to milliseconds and carries memory/output limits", () => {
  const testData = [
    conf([
      "n_tests 1",
      "time_limit 2",
      "memory_limit 512",
      "output_limit 64",
      "use_builtin_judger on",
      "use_builtin_checker ncmp"
    ]),
    file("input1.txt"),
    file("output1.txt")
  ];

  const result = uojProblemConfImporter.import(testData, TRADITIONAL);
  assert.equal(result.timeLimit, 2000);
  assert.equal(result.memoryLimit, 512);
  assert.equal(result.outputLimit, 64);
});

test("problem.conf validates extra (sample) tests but does not emit them as testcases", () => {
  const testData = [
    conf(["n_tests 1", "n_ex_tests 1", "n_sample_tests 1", "use_builtin_judger on", "use_builtin_checker ncmp"]),
    file("input1.txt"),
    file("output1.txt"),
    file("ex_input1.txt"),
    file("ex_output1.txt")
  ];

  const { subtasks } = uojProblemConfImporter.import(testData, TRADITIONAL);
  assert.deepEqual(subtasks[0].testcases, [{ inputFile: "input1.txt", outputFile: "output1.txt" }]);

  const missingExtra = [testData[0], file("input1.txt"), file("output1.txt")];
  assert.throws(
    () => uojProblemConfImporter.import(missingExtra, TRADITIONAL),
    /missing: ex_input1\.txt, ex_output1\.txt/
  );
});

test("problem.conf raises clear errors for missing files, a disabled judger, unknown checkers and bad samples", () => {
  const missing = conf(["n_tests 2", "use_builtin_judger on", "use_builtin_checker ncmp"]);
  assert.throws(
    () => uojProblemConfImporter.import([missing, file("input1.txt"), file("output1.txt")], TRADITIONAL),
    /missing: input2\.txt, output2\.txt/
  );

  const disabled = conf(["n_tests 1", "use_builtin_judger off", "use_builtin_checker ncmp"]);
  assert.throws(
    () => uojProblemConfImporter.import([disabled, file("input1.txt"), file("output1.txt")], TRADITIONAL),
    /use_builtin_judger on/
  );

  const unknown = conf(["n_tests 1", "use_builtin_judger on", "use_builtin_checker bogus"]);
  assert.throws(
    () => uojProblemConfImporter.import([unknown, file("input1.txt"), file("output1.txt")], TRADITIONAL),
    /Unsupported builtin checker "bogus"/
  );

  const badSamples = conf([
    "n_tests 1",
    "n_ex_tests 1",
    "n_sample_tests 2",
    "use_builtin_judger on",
    "use_builtin_checker ncmp"
  ]);
  assert.throws(
    () => uojProblemConfImporter.import([badSamples, file("input1.txt"), file("output1.txt")], TRADITIONAL),
    /"n_sample_tests" \(2\) must not exceed "n_ex_tests" \(1\)/
  );

  const interaction = conf(["n_tests 1", "interaction_mode on", "use_builtin_judger on", "use_builtin_checker ncmp"]);
  assert.throws(
    () => uojProblemConfImporter.import([interaction, file("input1.txt"), file("output1.txt")], TRADITIONAL),
    /Interaction problems are not supported yet/
  );
});

test("problem.conf contentFilenames requests problem.conf only when present, and errors without content", () => {
  assert.deepEqual(uojProblemConfImporter.contentFilenames?.([file("problem.conf", "n_tests 1")]), ["problem.conf"]);
  assert.deepEqual(uojProblemConfImporter.contentFilenames?.([file("1.in"), file("1.out")]), []);

  assert.throws(() => uojProblemConfImporter.import([file("problem.conf")], TRADITIONAL), /has no content/);
});

test("buildUojSamples reads every sample with the default filename template", () => {
  const contents = new Map([
    ["ex_input1.txt", "1\n"],
    ["ex_output1.txt", "1\n"],
    ["ex_input2.txt", "2\n"],
    ["ex_output2.txt", "4\n"]
  ]);
  const samples = buildUojSamples(["n_ex_tests 2", "n_sample_tests 2"].join("\n"), name => contents.get(name));

  assert.deepEqual(samples, [
    { inputData: "1\n", outputData: "1\n" },
    { inputData: "2\n", outputData: "4\n" }
  ]);
});

test("buildUojSamples honours input_pre/input_suf and output_pre/output_suf", () => {
  const contents = new Map([
    ["ex_dream1.in", "in\n"],
    ["ex_dream1.ans", "ans\n"]
  ]);
  const conf = [
    "n_ex_tests 1",
    "n_sample_tests 1",
    "input_pre dream",
    "input_suf in",
    "output_pre dream",
    "output_suf ans"
  ].join("\n");
  const samples = buildUojSamples(conf, name => contents.get(name));

  assert.deepEqual(samples, [{ inputData: "in\n", outputData: "ans\n" }]);
});

test("buildUojSamples returns no samples when n_sample_tests is zero or absent", () => {
  assert.deepEqual(buildUojSamples("n_ex_tests 1", () => "x"), []);
  assert.deepEqual(buildUojSamples("n_ex_tests 1\nn_sample_tests 0", () => "x"), []);
});

test("buildUojSamples skips a sample whose input or output content is missing", () => {
  const contents = new Map([
    ["ex_input1.txt", "1\n"],
    // ex_output1.txt is missing -> skipped
    ["ex_input2.txt", "2\n"],
    ["ex_output2.txt", "4\n"]
    // ex_output3.txt is missing -> skipped
  ]);
  contents.set("ex_input3.txt", "3\n");
  const samples = buildUojSamples(["n_ex_tests 3", "n_sample_tests 3"].join("\n"), name => contents.get(name));

  assert.deepEqual(samples, [{ inputData: "2\n", outputData: "4\n" }]);
});

test("buildUojSamples rejects n_sample_tests exceeding n_ex_tests", () => {
  assert.throws(
    () => buildUojSamples("n_ex_tests 1\nn_sample_tests 2", () => "x"),
    /"n_sample_tests" \(2\) must not exceed "n_ex_tests" \(1\)/
  );
});

/** A real UOJ data directory, used to check the sample builder against genuine files when it is present. */
const UOJ_SAMPLE_DATA_DIR = "/home/tyih/HHHOJ/uoj_data/web/data/2";

test(
  "buildUojSamples matches the real UOJ problem.conf package",
  { skip: !fs.existsSync(path.join(UOJ_SAMPLE_DATA_DIR, "problem.conf")) },
  () => {
    const read = (name: string) => {
      const filePath = path.join(UOJ_SAMPLE_DATA_DIR, name);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : undefined;
    };

    const samples = buildUojSamples(read("problem.conf") ?? "", read);

    assert.equal(samples.length, 2);
    assert.equal(samples[0].inputData, read("ex_dream1.in"));
    assert.equal(samples[0].outputData, read("ex_dream1.ans"));
    assert.equal(samples[1].inputData, read("ex_dream2.in"));
    assert.equal(samples[1].outputData, read("ex_dream2.ans"));
  }
);
