import "reflect-metadata";

import assert from "node:assert/strict";
import { test } from "node:test";

import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Min, ValidateNested } from "class-validator";

import type { HttpRequest, HttpResponse, HttpRouteSpec } from "@libreoj/plugin-api";

import {
  executeHttpRoute,
  HttpError,
  mapThrownError,
  type HttpRouteRequest,
  validateDto
} from "../src/plugin/http/pipeline";

// The DTOs are declared locally with explicit class-validator decorators, so they need neither the swagger build
// plugin nor `emitDecoratorMetadata` (which `tsx` does not emit). This mirrors how a migrated route declares its
// contract.

class CreateDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(1)
  count: number;
}

class OptionalDto {
  @IsOptional()
  @IsString()
  note?: string;
}

class InnerDto {
  @IsString()
  value: string;
}

class OuterDto {
  @ValidateNested()
  @Type(() => InnerDto)
  inner: InnerDto;
}

function context(body: unknown, session?: unknown): { request: HttpRequest; response: HttpResponse } {
  return {
    request: {
      method: "POST",
      path: "/example",
      headers: {},
      query: {},
      params: {},
      body,
      raw: { session }
    },
    response: { status: 200, headers: {} }
  };
}

test("transforms a payload into a validated DTO instance", async () => {
  const result = await validateDto<CreateDto>(CreateDto, { name: "libreoj", count: 2 });

  assert.ok(result instanceof CreateDto);
  assert.equal(result.name, "libreoj");
  assert.equal(result.count, 2);
});

test("forbidNonWhitelisted rejects unknown properties with the Nest 400 shape", async () => {
  await assert.rejects(validateDto(CreateDto, { name: "libreoj", count: 2, extra: true }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 400);
    assert.deepEqual(error.body, {
      statusCode: 400,
      message: ["property extra should not exist"],
      error: "Bad Request"
    });
    return true;
  });
});

test("whitelist strips unknown properties when non-whitelisted input is allowed", async () => {
  const result = await validateDto<CreateDto>(CreateDto, { name: "libreoj", count: 2, extra: true }, {
    forbidNonWhitelisted: false
  });

  assert.ok(result instanceof CreateDto);
  assert.equal((result as unknown as Record<string, unknown>).extra, undefined);
  assert.equal(result.name, "libreoj");
});

test("a missing or undefined body still validates instead of crashing", async () => {
  await assert.rejects(validateDto(CreateDto, undefined), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 400);
    const body = error.body as { message: string[] };
    // Empty input satisfies neither required field, so both constraints are reported (not a `plainToInstance` crash).
    assert.ok(body.message.some(message => message.includes("name")));
    assert.ok(body.message.some(message => message.includes("count")));
    return true;
  });
});

test("an undeclared input class is passed through unchanged", async () => {
  const value = { anything: true };
  assert.equal(await validateDto(undefined, value), value);
});

test("nested validation prefixes constraint messages with the parent property path", async () => {
  await assert.rejects(validateDto(OuterDto, { inner: {} }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.deepEqual((error.body as { message: string[] }).message, ["inner.value must be a string"]);
    return true;
  });
});

test("executeHttpRoute validates the declared body and forwards the session", async () => {
  const session = { sessionId: 7 };
  let received: HttpRouteRequest | undefined;
  let responseSeen: HttpResponse | undefined;

  const spec: HttpRouteSpec = {
    method: "POST",
    path: "/example",
    request: { body: CreateDto },
    handler: (request, response) => {
      received = request as HttpRouteRequest;
      responseSeen = response;
      response.body = { ok: true };
    }
  };

  const ctx = context({ name: "libreoj", count: 3 }, session);
  await executeHttpRoute(spec, ctx);

  assert.ok(received?.body instanceof CreateDto);
  assert.equal((received?.body as CreateDto).name, "libreoj");
  assert.equal(received?.session, session);
  assert.equal(received?.raw, ctx.request.raw);
  assert.equal(responseSeen, ctx.response);
  assert.deepEqual(ctx.response.body, { ok: true });
});

test("executeHttpRoute rejects an invalid body before the handler runs", async () => {
  let called = false;
  const spec: HttpRouteSpec = {
    method: "POST",
    path: "/example",
    request: { body: CreateDto },
    handler: () => {
      called = true;
    }
  };

  await assert.rejects(executeHttpRoute(spec, context({ name: 1, count: 0 })), HttpError);
  assert.equal(called, false);
});

test("mapThrownError keeps an HTTP error's status/body and maps anything else to the filter's 500 shape", () => {
  assert.deepEqual(mapThrownError(new HttpError(418, { error: "teapot" })), {
    status: 418,
    body: { error: "teapot" }
  });

  const boom = new Error("boom");
  const mapped = mapThrownError(boom);
  assert.equal(mapped.status, 500);
  assert.deepEqual(mapped.body, { error: "Error: boom", stack: boom.stack });
});
