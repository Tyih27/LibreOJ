import "reflect-metadata";

import assert from "node:assert/strict";
import { test } from "node:test";

import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { HttpNestServer, type NestApplicationLike, type NestFactoryLike } from "./server";

@Module({})
class TestRootModule {}

/** The caller's Nest runtime, injected so the provider shares a single @nestjs/core instance. */
const nest: NestFactoryLike = {
  create: (module, options) =>
    NestFactory.create(
      module as never,
      (options ?? { logger: false }) as never
    ) as unknown as Promise<NestApplicationLike>
  // The cast above is only because Nest's own `INestApplication` is structurally wider than the minimal view here.
};

function createServer(): HttpNestServer {
  return new HttpNestServer({ rootModule: TestRootModule, nest, port: 0 });
}

function url(server: HttpNestServer, path: string): string {
  const address = server.address;
  assert.ok(address, "server should be listening");
  return `http://127.0.0.1:${address.port}${path}`;
}

test("serves a route registered before listen and stops on close", async () => {
  const server = createServer();
  server.route("GET", "/ping", (_request, response) => {
    response.body = { pong: true };
  });

  await server.listen();
  try {
    assert.equal(server.listening, true);
    const response = await fetch(url(server, "/ping"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { pong: true });
  } finally {
    await server.close();
  }

  assert.equal(server.listening, false);
  assert.equal(server.address, null);
});

test("honors async handlers, status, headers and string bodies", async () => {
  const server = createServer();
  server.route("GET", "/teapot", async (_request, response) => {
    await Promise.resolve();
    response.status = 418;
    response.headers["x-tea"] = "pot";
    response.body = "short and stout";
  });

  await server.listen();
  try {
    const response = await fetch(url(server, "/teapot"));
    assert.equal(response.status, 418);
    assert.equal(response.headers.get("x-tea"), "pot");
    assert.equal(await response.text(), "short and stout");
  } finally {
    await server.close();
  }
});

test("middleware can short-circuit or pass through, sharing headers", async () => {
  const server = createServer();
  server.use((request, response, next) => {
    if (request.path === "/blocked") {
      response.status = 403;
      response.body = "no";
      return;
    }
    response.headers["x-seen"] = "1";
    return next();
  });
  server.route("GET", "/ok", (_request, response) => {
    response.body = "ok";
  });
  server.route("GET", "/blocked", (_request, response) => {
    response.body = "should not run";
  });

  await server.listen();
  try {
    const blocked = await fetch(url(server, "/blocked"));
    assert.equal(blocked.status, 403);
    assert.equal(await blocked.text(), "no");

    const ok = await fetch(url(server, "/ok"));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("x-seen"), "1");
    assert.equal(await ok.text(), "ok");
  } finally {
    await server.close();
  }
});

test("rejects registering routes after listen", async () => {
  const server = createServer();
  await server.listen();
  try {
    assert.throws(() => server.route("GET", "/late", () => undefined), /after HttpServer\.listen/);
  } finally {
    await server.close();
  }
});

test("a registered route can be disposed before listen", async () => {
  const server = createServer();
  const dispose = server.route("GET", "/gone", (_request, response) => {
    response.body = "gone";
  });
  dispose();

  await server.listen();
  try {
    const response = await fetch(url(server, "/gone"));
    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});

test("prepare() creates and configures the application without binding", async () => {
  let configured = false;
  const server = new HttpNestServer({
    rootModule: TestRootModule,
    nest,
    port: 0,
    listen: false,
    configureApp: app => {
      configured = true;
      // The application is usable for configuration, exactly as a directly created one.
      (app as unknown as INestApplication).setGlobalPrefix("api");
    }
  });

  await server.prepare();
  assert.equal(configured, true);
  assert.ok(server.application, "application should be available after prepare");
  assert.equal(server.listening, false, "prepare must not bind a port");

  await server.close();
});
