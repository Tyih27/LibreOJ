import "reflect-metadata";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// TypeORM entities use column decorators that throw without `emitDecoratorMetadata`, which `tsx` does not emit, so
// `ALL_ENTITIES` is read from the compiled `dist` (the backend must be built first, as for the OpenAPI tests). The
// `*.entity.ts` files are scanned from source, so drift between the explicit array and the entity set still fails
// loudly without a build.
const DIST = path.resolve(__dirname, "../dist");
const SRC = path.resolve(__dirname, "../src");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function distModule(relativePath: string): any {
  const fullPath = path.join(DIST, relativePath);
  assert.ok(fs.existsSync(fullPath), `missing compiled artifact ${relativePath}; run the backend build first`);
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  return require(fullPath);
}

const ALL_ENTITIES = distModule("database/entities").ALL_ENTITIES as { name: string }[];

/** Recursively lists every `*.entity.ts` source file, the set the current filesystem glob loads. */
function findEntityFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...findEntityFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".entity.ts")) found.push(full);
  }
  return found;
}

/** The names of the classes a file exports with `export class`. */
function exportedClassNames(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const names: string[] = [];
  const pattern = /export class (\w+)/g;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    names.push(match[1]);
    match = pattern.exec(source);
  }
  return names;
}

test("ALL_ENTITIES lists the 29 entity classes", () => {
  // Pinning the count makes an entity added without updating the array fail loudly, which is the point of replacing the
  // depth-dependent `**/*.entity` glob.
  assert.equal(ALL_ENTITIES.length, 29);
});

test("ALL_ENTITIES has no duplicates", () => {
  const names = ALL_ENTITIES.map(entity => entity.name);
  assert.equal(new Set(names).size, names.length);
});

test("ALL_ENTITIES matches the entity classes under src", () => {
  const fromFiles = new Set<string>();
  for (const file of findEntityFiles(SRC)) {
    for (const name of exportedClassNames(file)) fromFiles.add(name);
  }

  const fromList = new Set(ALL_ENTITIES.map(entity => entity.name));

  assert.deepEqual([...fromList].sort(), [...fromFiles].sort());
});
