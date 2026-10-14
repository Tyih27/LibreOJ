import "reflect-metadata";

import assert from "node:assert/strict";
import { test } from "node:test";

import { IsInt, IsString } from "class-validator";

import {
  HTTP,
  HTTP_ROUTES,
  type HttpDisposer,
  type HttpHandler,
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
  type HttpRouteRegistry,
  type HttpRouteSpec,
  type HttpServer
} from "@libreoj/plugin-api";

import { httpRoutesPlugin, HttpRouteRegistryService, withApiPrefix } from "../src/plugin/http-routes.plugin";

class BodyDto {
  @IsString()
  name: string;

  @IsInt()
  count: number;
}

interface Registered {
  method: HttpMethod;
  path: string;
  handler: HttpHandler;
}

/** A minimal in-memory `HttpServer` that records the routes mounted on it. */
class FakeServer {
  readonly routes: Registered[] = [];

  route(method: HttpMethod, path: string, handler: HttpHandler): HttpDisposer {
    const entry: Registered = { method, path, handler };
    this.routes.push(entry);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.routes.indexOf(entry);
      if (index >= 0) this.routes.splice(index, 1);
    };
  }
}

test("withApiPrefix reproduces the public URL of a route", () => {
  assert.equal(withApiPrefix("/homepage/getHomepage"), "/api/homepage/getHomepage");
  assert.equal(withApiPrefix("homepage/getHomepage"), "/api/homepage/getHomepage");
});

test("HttpRouteRegistryService mounts on add and both disposers unregister", () => {
  const mounted: HttpRouteSpec[] = [];
  const registry = new HttpRouteRegistryService(spec => {
    mounted.push(spec);
    return () => {
      const index = mounted.indexOf(spec);
      if (index >= 0) mounted.splice(index, 1);
    };
  });

  const spec: HttpRouteSpec = { method: "GET", path: "/ping", handler: () => undefined };
  const dispose = registry.add(spec);

  assert.deepEqual(registry.list(), [spec]);
  assert.deepEqual(mounted, [spec]);

  dispose();
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(mounted, []);
});

test("httpRoutesPlugin provides the registry and mounts prefixed routes on the http seam", async () => {
  const server = new FakeServer();
  const services = new Map<string, unknown>([[HTTP, server as unknown as HttpServer]]);
  const ctx = {
    get: (name: string): unknown => services.get(name),
    set: (name: string, value: unknown): void => {
      services.set(name, value);
    }
  };

  httpRoutesPlugin.apply(ctx as never, {} as never);

  const registry = services.get(HTTP_ROUTES) as HttpRouteRegistry;
  assert.ok(registry, "the plugin should provide the httpRoutes registry");

  registry.add({ method: "POST", path: "/example", request: { body: BodyDto }, handler: () => undefined });

  assert.equal(server.routes.length, 1);
  assert.equal(server.routes[0].method, "POST");
  assert.equal(server.routes[0].path, "/api/example");

  // The mounted handler validates and maps errors: an invalid body becomes the ValidationPipe's 400 body.
  const response: HttpResponse = { status: 200, headers: {} };
  const request: HttpRequest = {
    method: "POST",
    path: "/api/example",
    headers: {},
    query: {},
    params: {},
    body: { name: 1 }
  };
  await server.routes[0].handler(request, response);

  assert.equal(response.status, 400);
  const body = response.body as { statusCode: number; message: string[]; error: string };
  assert.equal(body.statusCode, 400);
  assert.equal(body.error, "Bad Request");
  assert.ok(body.message.some(message => message.includes("name")));
});
