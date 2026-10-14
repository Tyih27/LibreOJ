import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import "reflect-metadata";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import type { HttpRouteSpec } from "@libreoj/plugin-api";

import { buildOpenApiDocument, type OpenApiDocument } from "../src/plugin/openapi/build-openapi-document";

// The DTO classes must be the *compiled* ones: `@nestjs/swagger/plugin` (run by `nest build`, see nest-cli.json) is
// what stamps each DTO with its static `_OPENAPI_METADATA_FACTORY()`. Under `tsx` the source has no such factory, so
// schema generation only works against `dist`. `tsx` also does not emit `design:paramtypes`, which is precisely why
// the oracle below reuses the real compiled controller instead of a re-declared fake one.
const DIST = path.resolve(__dirname, "../dist");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function distModule(relativePath: string): any {
  const fullPath = path.join(DIST, relativePath);
  assert.ok(fs.existsSync(fullPath), `missing compiled artifact ${relativePath}; run the backend build first`);
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  return require(fullPath);
}

const TITLE = "LibreOJ";
const DESCRIPTION = "The LibreOJ backend test document";
const VERSION = "v-test";
const DOCUMENT_CONFIG = { title: TITLE, description: DESCRIPTION, version: VERSION };

/** The three homepage routes, declared without any Nest decorator, mirroring `HomepageController`. */
function homepageRoutes(): HttpRouteSpec[] {
  const dto = distModule("homepage/dto");
  return [
    {
      method: "GET",
      path: "/homepage/getHomepage",
      tags: ["Homepage"],
      summary: "Get homepage settings and contents.",
      operationId: "HomepageController_getHomepage",
      auth: true,
      request: { query: dto.GetHomepageRequestDto },
      response: dto.GetHomepageResponseDto,
      handler: () => undefined
    },
    {
      method: "GET",
      path: "/homepage/getHomepageSettings",
      tags: ["Homepage"],
      summary: "Get homepage settings for editing.",
      operationId: "HomepageController_getHomepageSettings",
      auth: true,
      response: dto.GetHomepageSettingsResponseDto,
      handler: () => undefined
    },
    {
      method: "POST",
      path: "/homepage/updateHomepageSettings",
      tags: ["Homepage"],
      summary: "Update homepage settings",
      operationId: "HomepageController_updateHomepageSettings",
      auth: true,
      request: { body: dto.UpdateHomepageSettingsRequestDto },
      response: dto.UpdateHomepageSettingsResponseDto,
      handler: () => undefined
    }
  ];
}

/**
 * Builds the real document with `SwaggerModule.createDocument`, using the production-compiled `HomepageController`
 * and stubbed providers for its constructor dependencies (Nest only needs the tokens; no method is ever called). This
 * is the oracle `buildOpenApiDocument` must match.
 */
async function buildNestOracle(): Promise<OpenApiDocument> {
  const { HomepageController } = distModule("homepage/homepage.controller.js");
  const serviceClasses = [
    distModule("homepage/homepage.service.js").HomepageService,
    distModule("user/user.service.js").UserService,
    distModule("user/user-privilege.service.js").UserPrivilegeService,
    distModule("discussion/discussion.service.js").DiscussionService,
    distModule("problem/problem.service.js").ProblemService,
    distModule("submission/submission.service.js").SubmissionService,
    distModule("audit/audit.service.js").AuditService
  ];

  class OracleModule {}
  Module({
    controllers: [HomepageController],
    providers: serviceClasses.map(service => ({ provide: service, useValue: {} }))
  })(OracleModule);

  const app = await NestFactory.create(OracleModule, { logger: false });
  try {
    app.setGlobalPrefix("api");
    const options = new DocumentBuilder()
      .setTitle(TITLE)
      .setDescription(DESCRIPTION)
      .setVersion(VERSION)
      .addBearerAuth()
      .build();
    return SwaggerModule.createDocument(app, options) as unknown as OpenApiDocument;
  } finally {
    await app.close();
  }
}

/** `/docs-json` serves the document through JSON, which drops function values; compare at that same fidelity. */
function overTheWire(document: unknown): unknown {
  return JSON.parse(JSON.stringify(document));
}

test("builds the homepage DTO schemas", () => {
  const document = buildOpenApiDocument(homepageRoutes(), DOCUMENT_CONFIG);
  const schemas = document.components.schemas;

  // A query DTO is flattened into parameters, so it is intentionally absent from `components.schemas` — exactly as
  // `SwaggerModule` does. (Its enum appears on the operation parameter, asserted in the path-items test.)
  assert.ok(!("GetHomepageRequestDto" in schemas));

  // The response DTO references nested models, including arrays of `$ref`s and an inline enum-valued scalar.
  const responseSchema = schemas.GetHomepageResponseDto as {
    required: string[];
    properties: Record<string, { enum?: unknown[]; items?: { $ref?: string }; $ref?: string }>;
  };
  assert.deepEqual(responseSchema.properties.noticeLocale, {
    enum: Object.values(distModule("common/locale.type.js").Locale),
    type: "string"
  });
  assert.equal(
    responseSchema.properties.latestUpdatedProblems.items?.$ref,
    "#/components/schemas/GetHomepageResponseProblemDto"
  );
  assert.equal(responseSchema.properties.annnouncements.items?.$ref, "#/components/schemas/DiscussionMetaDto");
  assert.equal(responseSchema.properties.topUsers.items?.$ref, "#/components/schemas/UserMetaDto");
  assert.ok(responseSchema.required.includes("latestUpdatedProblems"));
  // Optional properties are excluded from `required`.
  assert.ok(!responseSchema.required.includes("hitokoto"));

  // Recursively discovered models are all present.
  for (const name of [
    "DiscussionMetaDto",
    "UserMetaDto",
    "ProblemMetaDto",
    "SubmissionBasicMetaDto",
    "GetHomepageResponseProblemDto",
    "HomepageSettings",
    "UpdateHomepageSettingsRequestDto",
    "UpdateHomepageSettingsResponseDto",
    "GetHomepageSettingsResponseDto"
  ]) {
    assert.ok(name in schemas, `missing schema ${name}`);
  }
});

test("emits the three homepage path items, including the api prefix", () => {
  const document = buildOpenApiDocument(homepageRoutes(), DOCUMENT_CONFIG);
  const paths = document.paths;

  // The real document includes the global `api` prefix (the frontend generator strips `/api/` from these keys).
  assert.deepEqual(Object.keys(paths).sort(), [
    "/api/homepage/getHomepage",
    "/api/homepage/getHomepageSettings",
    "/api/homepage/updateHomepageSettings"
  ]);

  const getHomepage = paths["/api/homepage/getHomepage"].get;
  assert.equal(getHomepage.operationId, "HomepageController_getHomepage");
  assert.equal(getHomepage.summary, "Get homepage settings and contents.");
  assert.deepEqual(getHomepage.tags, ["Homepage"]);
  assert.deepEqual(getHomepage.security, [{ bearer: [] }]);
  assert.deepEqual(getHomepage.parameters, [
    {
      required: true,
      in: "query",
      name: "locale",
      schema: { enum: Object.values(distModule("common/locale.type.js").Locale), type: "string" }
    }
  ]);
  assert.deepEqual(getHomepage.responses["200"], {
    description: "",
    content: { "application/json": { schema: { $ref: "#/components/schemas/GetHomepageResponseDto" } } }
  });

  const getSettings = paths["/api/homepage/getHomepageSettings"].get;
  assert.deepEqual(getSettings.parameters, []);

  const updateSettings = paths["/api/homepage/updateHomepageSettings"].post;
  assert.deepEqual(updateSettings.requestBody, {
    required: true,
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/UpdateHomepageSettingsRequestDto" } }
    }
  });
  // POST defaults to 201 in Nest, unlike GET's 200.
  assert.ok("201" in updateSettings.responses);
  assert.deepEqual(updateSettings.responses["201"], {
    description: "",
    content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateHomepageSettingsResponseDto" } } }
  });
});

test("matches SwaggerModule.createDocument for the homepage routes", async () => {
  const oracle = await buildNestOracle();
  const actual = buildOpenApiDocument(homepageRoutes(), DOCUMENT_CONFIG);

  assert.deepEqual(overTheWire(actual), overTheWire(oracle));
});

test("honours a custom global prefix", () => {
  const document = buildOpenApiDocument(homepageRoutes(), { ...DOCUMENT_CONFIG, globalPrefix: "" });
  assert.ok("/homepage/getHomepage" in document.paths);
  assert.ok(!("/api/homepage/getHomepage" in document.paths));
});
