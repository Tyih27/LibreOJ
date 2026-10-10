import { test } from "node:test";
import assert from "node:assert/strict";

import { planArchiveEntries } from "../src/problem-data-import/archive";

test("strips a single common top-level directory", () => {
  const planned = planArchiveEntries([
    { path: "data/1.in", size: 1 },
    { path: "data/1.out", size: 1 },
    { path: "data/sub/2.in", size: 1 }
  ]);

  assert.deepEqual(
    planned.map(file => file.name),
    ["1.in", "1.out", "sub_2.in"]
  );
  assert.deepEqual(
    planned.map(file => file.entryPath),
    ["data/1.in", "data/1.out", "data/sub/2.in"]
  );
});

test("flattens nested paths with underscores when there is no common top-level directory", () => {
  const planned = planArchiveEntries([
    { path: "a/b/c.in", size: 1 },
    { path: "d/e.out", size: 1 }
  ]);

  assert.deepEqual(
    planned.map(file => file.name),
    ["a_b_c.in", "d_e.out"]
  );
});

test("does not strip when a top-level entry is itself a file", () => {
  const planned = planArchiveEntries([
    { path: "problem/1.in", size: 1 },
    { path: "readme.txt", size: 1 }
  ]);

  assert.deepEqual(
    planned.map(file => file.name),
    ["problem_1.in", "readme.txt"]
  );
});

test("does not strip when top-level directories differ", () => {
  const planned = planArchiveEntries([
    { path: "a/1.in", size: 1 },
    { path: "b/1.out", size: 1 }
  ]);

  assert.deepEqual(
    planned.map(file => file.name),
    ["a_1.in", "b_1.out"]
  );
});

test("ignores empty and '.' path segments", () => {
  const planned = planArchiveEntries([
    { path: "a//./b.in", size: 1 },
    { path: "c/./x.in", size: 1 }
  ]);
  assert.deepEqual(
    planned.map(file => file.name),
    ["a_b.in", "c_x.in"]
  );
});

test("preserves the input order", () => {
  const planned = planArchiveEntries([
    { path: "z/9.in", size: 1 },
    { path: "z/1.in", size: 1 },
    { path: "z/5.in", size: 1 }
  ]);

  assert.deepEqual(
    planned.map(file => file.name),
    ["9.in", "1.in", "5.in"]
  );
});

test("rejects parent directory segments", () => {
  assert.throws(() => planArchiveEntries([{ path: "../evil.in", size: 1 }]), /parent directory/);
  assert.throws(() => planArchiveEntries([{ path: "a/../../b.in", size: 1 }]), /parent directory/);
});

test("rejects entries that map to an empty filename", () => {
  assert.throws(() => planArchiveEntries([{ path: "/", size: 1 }]), /no filename/);
  assert.throws(() => planArchiveEntries([{ path: "a/", size: 1 }, { path: "./", size: 1 }]), /no filename/);
});

test("rejects entries that map to an invalid filename", () => {
  assert.throws(() => planArchiveEntries([{ path: "bad\x00name.in", size: 1 }]), /invalid filename/);
});

test("rejects two entries that flatten to the same filename", () => {
  assert.throws(
    () =>
      planArchiveEntries([
        { path: "a/b.in", size: 1 },
        { path: "a_b.in", size: 1 }
      ]),
    /same filename/
  );

  assert.throws(
    () =>
      planArchiveEntries([
        { path: "d/a_b.in", size: 1 },
        { path: "d/a/b.in", size: 1 }
      ]),
    /same filename/
  );
});

test("an empty archive plans to no files", () => {
  assert.deepEqual(planArchiveEntries([]), []);
});
