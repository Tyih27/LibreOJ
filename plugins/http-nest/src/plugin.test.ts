import "reflect-metadata";

import assert from "node:assert/strict";
import { test } from "node:test";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { HTTP, type HttpServer } from "@libreoj/plugin-api";
import { InlineResolver, PluginHost, type Context } from "@libreoj/plugin-core";

import { createHttpNestPlugin } from "./plugin";
import type { NestApplicationLike, NestFactoryLike } from "./server";

@Module({})
class TestRootModule {}

const nest: NestFactoryLike = {
  create: (module, options) =>
    NestFactory.create(
      module as never,
      (options ?? { logger: false }) as never
    ) as unknown as Promise<NestApplicationLike>
};

test("a plugin contributes a route through the http seam", async () => {
  const consumer = {
    name: "@test/http-consumer",
    inject: { required: [HTTP] },
    apply(ctx: Context): void {
      ctx.get<HttpServer>(HTTP).route("GET", "/hello", (_request, response) => {
        response.body = "world";
      });
    }
  };

  const host = new PluginHost({
    resolver: new InlineResolver({
      "@libreoj/plugin-http-nest": createHttpNestPlugin({ rootModule: TestRootModule, nest, port: 0 }),
      [consumer.name]: consumer
    })
  });

  await host.load([{ bundles: ["@libreoj/plugin-http-nest", consumer.name] }]);
  try {
    const server = host.root.get<HttpServer>(HTTP);
    assert.equal(server.listening, true);

    const address = server.address;
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${address.port}/hello`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "world");
  } finally {
    await host.dispose();
  }
});
