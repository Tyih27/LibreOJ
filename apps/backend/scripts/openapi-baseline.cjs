#!/usr/bin/env node
"use strict";

/**
 * Regenerates `apps/backend/test/fixtures/openapi-baseline.json`, the OpenAPI oracle for the NestJS-removal migration
 * (M7).
 *
 * It builds a minimal Nest application containing all real controllers, stubs their constructor dependencies with a
 * self-returning `noopProxy` (their methods are never called, only their route metadata is read), and serializes
 * `SwaggerModule.createDocument`'s output. No port is bound and `init`/`listen` are not called.
 *
 * It runs against `dist`, so the backend must be built first (`@nestjs/swagger/plugin` stamps each DTO's
 * `_OPENAPI_METADATA_FACTORY()` at build time). Run from the repository root:
 *
 *   node apps/backend/scripts/openapi-baseline.cjs
 *
 * The fixture is captured before any controller is migrated; later milestones assert a migrated `buildOpenApiDocument`
 * matches it.
 */

require("reflect-metadata");

const fs = require("node:fs");
const path = require("node:path");

const { Module } = require("@nestjs/common");
const {
  SELF_DECLARED_DEPS_METADATA,
  PARAMTYPES_METADATA,
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  PIPES_METADATA,
  EXCEPTION_FILTERS_METADATA
} = require("@nestjs/common/constants");
const { NestFactory } = require("@nestjs/core");
const { DocumentBuilder, SwaggerModule } = require("@nestjs/swagger");

const ENHANCER_METADATA = [GUARDS_METADATA, INTERCEPTORS_METADATA, PIPES_METADATA, EXCEPTION_FILTERS_METADATA];

const BACKEND_ROOT = path.resolve(__dirname, "..");
const DIST = path.join(BACKEND_ROOT, "dist");
const OUTPUT = path.join(BACKEND_ROOT, "test", "fixtures", "openapi-baseline.json");
const packageInfo = require(path.join(BACKEND_ROOT, "package.json"));

/**
 * `auth.controller.ts` imports `appGitRepoInfo` from `../main`, and `main.js` runs `bootstrap()` on load. Pre-seed the
 * module cache with a stub so requiring the controllers does not start the application (and does not require a
 * `LIBREOJ_CONFIG_FILE`). Only the plain `appGitRepoInfo` value is needed; it is read inside handlers, never at load.
 */
function stubMainModule() {
  const ModuleConstructor = require("node:module");
  const mainPath = path.join(DIST, "main.js");
  if (!fs.existsSync(mainPath)) return;
  const stub = new ModuleConstructor(mainPath, null);
  stub.filename = mainPath;
  stub.loaded = true;
  stub.exports = { appGitRepoInfo: { abbreviatedSha: null, committerDate: new Date(0).toISOString() } };
  require.cache[mainPath] = stub;
}

/**
 * A Proxy whose every property read, call and construction returns the proxy itself, so incidental property access
 * inside a stubbed constructor dependency does not throw. `then` is left undefined so the proxy is not treated as a
 * thenable.
 */
function createNoopProxy() {
  const target = function noop() {};
  const handler = {
    get: (_target, property) => {
      // Not a thenable, so a stubbed value is never treated as a promise.
      if (property === "then") return undefined;
      // A controller constructor may coerce a dependency-derived value to a string (e.g. `new RegExp(...)`).
      if (property === Symbol.toPrimitive) return () => "";
      if (property === "toString" || property === "valueOf") return () => "";
      return proxy;
    },
    apply: () => proxy,
    construct: () => proxy
  };
  const proxy = new Proxy(target, handler);
  return proxy;
}

/** Recursively lists compiled controller files, sorted so the generated document is deterministic. */
function findControllerFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...findControllerFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".controller.js")) found.push(full);
  }
  return found.sort();
}

/** Loads the controller class(es) exported by one compiled file. */
function loadControllers(file) {
  const moduleExports = require(file);
  return Object.values(moduleExports).filter(
    value => typeof value === "function" && typeof value.name === "string" && value.name.endsWith("Controller")
  );
}

/**
 * The constructor dependency tokens of a controller, with `@Inject(...)` (including `forwardRef`) declarations overlaid
 * on the `design:paramtypes` metadata, exactly as Nest's injector does. A `forwardRef` token is resolved to its target
 * so the stub provider is keyed the way Nest looks it up.
 */
function dependencyTokens(controller) {
  const paramtypes = Reflect.getMetadata(PARAMTYPES_METADATA, controller) || [];
  const selfParams = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, controller) || [];
  for (const { index, param } of selfParams) paramtypes[index] = param;

  return paramtypes
    .map(param => (param && typeof param === "object" && typeof param.forwardRef === "function" ? param.forwardRef() : param))
    .filter(
      token => token != null && (typeof token === "function" || typeof token === "object" || typeof token === "symbol")
    );
}

/**
 * The enhancer classes a controller references through `@UseGuards`/`@UseInterceptors`/`@UsePipes`/`@UseFilters`
 * (directly or via decorators such as `@Recaptcha()`), at class and method level. Nest instantiates these too, so
 * their constructor dependencies must also be stubbed.
 */
function enhancerClasses(controller) {
  const classes = [];
  const collect = list => {
    for (const value of list || []) if (typeof value === "function") classes.push(value);
  };

  const prototype = controller.prototype || {};
  for (const key of ENHANCER_METADATA) {
    collect(Reflect.getMetadata(key, controller));
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === "constructor") continue;
      const method = prototype[name];
      if (typeof method === "function") collect(Reflect.getMetadata(key, method));
    }
  }

  return classes;
}

async function main() {
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing; run the backend build first`);

  stubMainModule();
  const controllers = findControllerFiles(DIST).flatMap(loadControllers);

  const noop = createNoopProxy();
  const providers = [];
  const seen = new Set();
  const addDependency = token => {
    if (seen.has(token)) return;
    seen.add(token);
    providers.push({ provide: token, useValue: noop });
  };
  for (const controller of controllers) {
    for (const token of dependencyTokens(controller)) addDependency(token);
    for (const enhancer of enhancerClasses(controller)) {
      for (const token of dependencyTokens(enhancer)) addDependency(token);
    }
  }

  class BaselineModule {}
  Module({ controllers, providers })(BaselineModule);

  const app = await NestFactory.create(BaselineModule, { logger: false, abortOnError: false });
  try {
    app.setGlobalPrefix("api");

    const options = new DocumentBuilder()
      .setTitle(packageInfo.name)
      .setDescription(packageInfo.description)
      .setVersion(`v${packageInfo.version}`)
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, options);

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`);

    const paths = Object.keys(document.paths || {});
    const operations = paths.reduce(
      (count, key) => count + Object.keys(document.paths[key]).filter(method => method !== "parameters").length,
      0
    );
    process.stdout.write(`Wrote ${OUTPUT}\n${controllers.length} controllers, ${paths.length} paths, ${operations} operations\n`);
  } finally {
    await app.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
