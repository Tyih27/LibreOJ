import assert from "node:assert/strict";
import { test } from "node:test";

import { HTTP, type HttpServer } from "@libreoj/plugin-api";
import { InlineResolver, PluginHost, type Context } from "@libreoj/plugin-core";

import { createHttpNestPlugin } from "./plugin";
import { HttpNestServer } from "./server";

test("listen: false prepares the application and lets the caller bind later", async () => {
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
      "@libreoj/plugin-http-nest": createHttpNestPlugin({ port: 0, listen: false }),
      [consumer.name]: consumer
    })
  });

  await host.load([{ bundles: ["@libreoj/plugin-http-nest", consumer.name] }]);
  try {
    const server = host.root.get<HttpNestServer>(HTTP);
    assert.equal(server.listening, false);
    assert.ok(server.application, "the application should be prepared without listening");

    await server.listen();
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
      "@libreoj/plugin-http-nest": createHttpNestPlugin({ port: 0 }),
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
