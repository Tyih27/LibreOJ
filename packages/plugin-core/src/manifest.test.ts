import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "node:path";
import { readPackageJson } from "./manifest";

const fixturesDir = path.join(__dirname, "..", "fixtures");

test("rejects a package.json whose contents are not a JSON object", () => {
  const packageJsonPath = path.join(fixturesDir, "bad-package-json", "package.json");

  assert.throws(() => readPackageJson(packageJsonPath), /expected a JSON object/);
});
