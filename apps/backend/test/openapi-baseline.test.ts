import "reflect-metadata";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * Guards `openapi-baseline.json`, the pre-migration OpenAPI oracle for M7. It deliberately checks structure and the
 * exact route set derived from the compiled controllers rather than hashing the whole file, so a legitimate schema
 * change does not fail the guard but an accidentally dropped or added route does.
 *
 * Like `openapi-builder.test.ts`, it reads `dist`, so the backend must be built first.
 */
const DIST = path.resolve(__dirname, "../dist");
const FIXTURE = path.resolve(__dirname, "fixtures/openapi-baseline.json");

// The metadata key `@nestjs/common`'s `RequestMapping` writes for `@Get`/`@Post`/... (see `METHOD_METADATA`).
const METHOD_METADATA = "method";

/**
 * `auth.controller.ts` imports `appGitRepoInfo` from `../main`, and `main.js` runs `bootstrap()` on load (requiring a
 * `LIBREOJ_CONFIG_FILE`). Seed the module cache with a stub so requiring the compiled controllers does not start the
 * application, exactly as the baseline generator does.
 */
function stubMainModule(): void {
  const ModuleConstructor = require("node:module") as new (id: string, parent: unknown) => {
    filename: string;
    loaded: boolean;
    exports: unknown;
  };
  const mainPath = path.join(DIST, "main.js");
  if (!fs.existsSync(mainPath)) return;
  const stub = new ModuleConstructor(mainPath, null);
  stub.filename = mainPath;
  stub.loaded = true;
  stub.exports = { appGitRepoInfo: { abbreviatedSha: null, committerDate: new Date(0).toISOString() } };
  (require.cache as Record<string, unknown>)[mainPath] = stub;
}

/** Recursively lists compiled controller files, mirroring the baseline generator. */
function findControllerFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...findControllerFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".controller.js")) found.push(full);
  }
  return found;
}

/** Counts the route-decorated methods across every compiled controller. */
function countControllerRoutes(): number {
  stubMainModule();
  let count = 0;
  for (const file of findControllerFiles(DIST)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const moduleExports = require(file);
    for (const value of Object.values(moduleExports)) {
      if (typeof value !== "function" || !(value as { name: string }).name.endsWith("Controller")) continue;
      const prototype = (value as { prototype: Record<string, unknown> }).prototype ?? {};
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === "constructor") continue;
        const method = prototype[name];
        if (typeof method === "function" && Reflect.getMetadata(METHOD_METADATA, method) !== undefined) count += 1;
      }
    }
  }
  return count;
}

const document = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, { responses?: unknown }>>;
  components: { schemas: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
};

test("the baseline document is structurally intact", () => {
  assert.equal(document.openapi, "3.0.0");
  assert.equal(document.info.title, "@libreoj/backend");
  assert.ok(document.info.version.startsWith("v"));
  assert.deepEqual(document.components.securitySchemes, {
    bearer: { scheme: "bearer", bearerFormat: "JWT", type: "http" }
  });
  assert.ok(Object.keys(document.components.schemas).length > 0, "expected DTO schemas");
});

test("the baseline contains every API route the controllers declare", () => {
  const expected = countControllerRoutes();
  const paths = Object.keys(document.paths);

  // The captured pre-migration baseline has 93 routes across the 12 controllers. Pinning both numbers makes a
  // controller added without regenerating the baseline fail loudly.
  assert.equal(expected, 93);
  assert.equal(paths.length, 93);
  assert.equal(paths.length, expected);

  for (const routePath of paths) {
    assert.ok(routePath.startsWith("/api/"), `route is missing the api prefix: ${routePath}`);
    for (const [method, operation] of Object.entries(document.paths[routePath])) {
      assert.ok(operation.responses, `operation has no responses: ${method.toUpperCase()} ${routePath}`);
    }
  }
});

test("the baseline covers all twelve controllers", () => {
  for (const routePath of [
    "/api/runMaintainceTasks", // app
    "/api/auth/login", // auth
    "/api/cors/xdomain.html", // cors
    "/api/discussion/createDiscussion", // discussion
    "/api/group/getGroupMeta", // group
    "/api/hack/createHack", // hack
    "/api/homepage/getHomepage", // homepage
    "/api/judgeClient/listJudgeClients", // judge client
    "/api/migration/migrateUser", // migration
    "/api/problem/queryProblemSet", // problem
    "/api/submission/submit", // submission
    "/api/user/searchUser" // user
  ]) {
    assert.ok(routePath in document.paths, `missing route ${routePath}`);
  }
});
