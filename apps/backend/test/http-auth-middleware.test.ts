import "reflect-metadata";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { HttpRequest, HttpResponse } from "@libreoj/plugin-api";

// The seam auth middleware reuses `AuthMiddleware`'s session resolver, whose module graph reaches TypeORM entities.
// Those throw without `emitDecoratorMetadata` (not emitted by `tsx`), so the middleware and the resolver are loaded
// from the compiled `dist` (the backend must be built first, as for the OpenAPI tests).
const DIST = path.resolve(__dirname, "../dist");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function distModule(relativePath: string): any {
  const fullPath = path.join(DIST, relativePath);
  assert.ok(fs.existsSync(fullPath), `missing compiled artifact ${relativePath}; run the backend build first`);
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  return require(fullPath);
}

const { getCurrentRequest } = distModule("auth/auth.middleware");
const { createSeamAuthMiddleware } = distModule("plugin/http/auth.middleware");
const { bindManualServiceResolver } = distModule("service-resolver");
const { UserPrivilegeType } = distModule("user/user-privilege.entity");

interface RawRequest {
  headers: Record<string, string>;
  session?: {
    sessionKey?: string;
    sessionId?: number;
    user?: unknown;
    userCanSkipRecaptcha: () => Promise<boolean>;
  };
}

const user = { id: 42, isAdmin: false };

/** Binds fake auth services and returns the middleware under test plus the privilege-call log. */
function setup(): { middleware: ReturnType<typeof createSeamAuthMiddleware>; privilegeCalls: [unknown, unknown][] } {
  const privilegeCalls: [unknown, unknown][] = [];
  const authSessionService = {
    accessSession: async (sessionKey: string): Promise<[number | null, unknown]> =>
      sessionKey === "valid-key" ? [7, user] : [null, null]
  };
  const userPrivilegeService = {
    userHasPrivilege: async (target: unknown, privilege: unknown): Promise<boolean> => {
      privilegeCalls.push([target, privilege]);
      return true;
    }
  };

  bindManualServiceResolver({ authSessionService, userPrivilegeService });
  return { middleware: createSeamAuthMiddleware(), privilegeCalls };
}

/** Builds the normalized request and its raw request the way the `http-nest` provider does. */
function makeRequest(authorization?: string): { request: HttpRequest; raw: RawRequest } {
  const headers = authorization ? { authorization } : {};
  const raw: RawRequest = { headers };
  return {
    request: { method: "GET", path: "/example", headers, query: {}, params: {}, body: undefined, raw },
    raw
  };
}

test("a valid bearer key populates the raw session and runs next() in the request context", async () => {
  const { middleware, privilegeCalls } = setup();
  const { request, raw } = makeRequest("Bearer valid-key");
  const response: HttpResponse = { status: 200, headers: {} };

  let nextCalled = false;
  let requestInsideNext: unknown;
  await middleware(request, response, () => {
    nextCalled = true;
    requestInsideNext = getCurrentRequest();
  });

  assert.equal(nextCalled, true);
  assert.equal(raw.session?.sessionKey, "valid-key");
  assert.equal(raw.session?.sessionId, 7);
  assert.equal(raw.session?.user, user);
  assert.equal(await raw.session?.userCanSkipRecaptcha(), true);
  assert.deepEqual(privilegeCalls, [[user, UserPrivilegeType.SkipRecaptcha]]);
  assert.equal(requestInsideNext, raw);
});

test("a missing key proceeds with no session", async () => {
  const { middleware } = setup();
  const { request, raw } = makeRequest();

  let nextCalled = false;
  await middleware(request, { status: 200, headers: {} }, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(raw.session, undefined);
});

test("an invalid key proceeds with no session and does not reject", async () => {
  const { middleware } = setup();
  const { request, raw } = makeRequest("Bearer not-a-session");

  let nextCalled = false;
  await middleware(request, { status: 200, headers: {} }, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(raw.session, undefined);
});

test("a request without a raw request still proceeds", async () => {
  const { middleware } = setup();
  const request: HttpRequest = { method: "GET", path: "/example", headers: {}, query: {}, params: {}, body: undefined };

  let nextCalled = false;
  await middleware(request, { status: 200, headers: {} }, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});
