import { test } from "node:test";
import assert from "node:assert/strict";

import { validateMetaAndSubtasks } from "../src/problem-type/common/meta-and-subtasks";

const options = {
  enableTimeMemoryLimit: false,
  enableFileIo: false,
  enableInputFile: false,
  enableOutputFile: false,
  enableUserOutputFilename: false
};

// A fresh judge info per call: `validateMetaAndSubtasks` mutates its argument (it strips properties).
const makeJudgeInfo = (outputLimit?: number) => ({
  ...(outputLimit !== undefined ? { outputLimit } : {}),
  subtasks: [
    {
      scoringType: "Sum" as const,
      testcases: [{ inputFile: "1.in", outputFile: "1.out" }]
    }
  ]
});

const validate = (outputLimit?: number) =>
  validateMetaAndSubtasks(makeJudgeInfo(outputLimit) as any, [], options as any);

test("validateMetaAndSubtasks allows a positive integer outputLimit", () => {
  assert.doesNotThrow(() => validate(64));
});

test("validateMetaAndSubtasks allows an absent outputLimit", () => {
  assert.doesNotThrow(() => validate());
});

test("validateMetaAndSubtasks rejects a non-positive or non-integer outputLimit", () => {
  for (const outputLimit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => validate(outputLimit),
      err => {
        assert.deepEqual(err, ["INVALID_OUTPUT_LIMIT"]);
        return true;
      },
      `outputLimit ${outputLimit} should be rejected`
    );
  }
});
