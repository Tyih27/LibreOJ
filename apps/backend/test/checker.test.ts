import { test } from "node:test";
import assert from "node:assert/strict";

import { validateChecker } from "../src/problem-type/common/checker";

const noOptions = {
  validateCompileAndRunOptions: () => true
};

test("validateChecker accepts a built-in testlib checker with a known name", () => {
  const judgeInfo = { checker: { type: "testlib", name: "ncmp" } };
  assert.doesNotThrow(() => validateChecker(judgeInfo as any, [], noOptions));
  assert.deepEqual(judgeInfo.checker, { type: "testlib", name: "ncmp" });
});

test("validateChecker rejects a built-in testlib checker with an unknown name", () => {
  const judgeInfo = { checker: { type: "testlib", name: "not-a-checker" } };
  assert.throws(
    () => validateChecker(judgeInfo as any, [], noOptions),
    err => {
      assert.deepEqual(err, ["INVALID_CHECKER_OPTIONS"]);
      return true;
    }
  );
});

test("validateChecker strips extra properties from a built-in testlib checker", () => {
  const judgeInfo = { checker: { type: "testlib", name: "ncmp", precision: 4 } };
  assert.doesNotThrow(() => validateChecker(judgeInfo as any, [], noOptions));
  assert.deepEqual(judgeInfo.checker, { type: "testlib", name: "ncmp" });
});
